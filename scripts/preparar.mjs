#!/usr/bin/env node
/**
 * preparar.mjs — deja la computadora de un programador lista para clonar (docs/PROGRAMADORES.md, paso 1).
 *
 *   npm run preparar -- --ip <IP del servidor> [--nombre juan.perez]
 *
 * Se puede correr las veces que haga falta; cada vez hace solo lo que falta:
 *   1. revisa Node, git y el .env.local de la flota en la raíz del 2.0
 *   2. crea la llave ~/.ssh/neura_zentra si no existe (sin contraseña: la usa el formulario solo)
 *   3. suma "Host neura-erp" (usuario clonador) a ~/.ssh/config si no está
 *   4. prueba la conexión: si el servidor todavía no tiene la llave, muestra la línea para mandarle
 *      al administrador
 * Nunca muestra ni copia la llave privada, ni toca otros Host del ~/.ssh/config.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { psqlRemoto, errorRemoto } from "./remoto.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const HOST = "neura-erp";
const dirSsh = join(homedir(), ".ssh");
const llave = join(dirSsh, "neura_zentra");
const config = join(dirSsh, "config");

const ok = (t) => console.log(`  ✓ ${t}`);
const mal = (t) => console.log(`  ✗ ${t}`);
const pendientes = [];

const slug = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9._-]+/g, ".").replace(/^\.+|\.+$/g, "");
const nombre = slug(args.nombre) || slug(spawnSync("git", ["config", "user.name"], { encoding: "utf8" }).stdout.trim()) || slug(userInfo().username) || "programador";

console.log("\nPreparando esta computadora para clonar el ERP 2.0\n");

// 1. Herramientas y claves de la flota
const mayor = Number(process.versions.node.split(".")[0]);
if (mayor >= 22) ok(`Node ${process.versions.node}`); else { mal(`Node ${process.versions.node}: hace falta 22 o más`); pendientes.push("Instalá Node 22 o más nuevo (https://nodejs.org)."); }
if (spawnSync("git", ["--version"]).status === 0) ok("git"); else { mal("git no está instalado"); pendientes.push("Instalá git (https://git-scm.com)."); }
if (spawnSync("ssh-keygen", ["-?"], { encoding: "utf8" }).error) { mal("ssh-keygen no está (OpenSSH)"); pendientes.push("Instalá el cliente OpenSSH (en Windows: Configuración › Aplicaciones › Características opcionales › Cliente OpenSSH)."); }

const env = existsSync(join(raiz, ".env.local")) ? readFileSync(join(raiz, ".env.local"), "utf8") : "";
const faltan = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => !new RegExp(`^${k}=.+`, "m").test(env));
if (!faltan.length) ok(".env.local de la flota");
else { mal(`.env.local: falta ${faltan.join(", ")}`); pendientes.push(`Pedile el .env.local de la flota al administrador y ponelo en ${raiz} (al lado de package.json).`); }

// 2. Llave
mkdirSync(dirSsh, { recursive: true });
if (existsSync(llave)) ok(`Llave ${llave} (ya existía)`);
else {
  const r = spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", nombre, "-f", llave], { encoding: "utf8" });
  if (r.status === 0) ok(`Llave nueva ${llave} (${nombre})`); else { mal(`No pude crear la llave: ${(r.stderr || r.error?.message || "").trim()}`); process.exit(1); }
}
const publica = readFileSync(`${llave}.pub`, "utf8").trim();

// 3. ~/.ssh/config
const cfg = existsSync(config) ? readFileSync(config, "utf8") : "";
const bloque = new RegExp(`^Host\\s+${HOST}\\s*$([\\s\\S]*?)(?=^Host\\s|(?![\\s\\S]))`, "m").exec(cfg);
if (bloque) {
  const usuario = /^\s*User\s+(\S+)/m.exec(bloque[1])?.[1];
  ok(`~/.ssh/config ya tiene "Host ${HOST}"${usuario ? ` (usuario ${usuario})` : ""}: no lo toco`);
} else if (!args.ip) {
  mal(`~/.ssh/config no tiene "Host ${HOST}"`);
  pendientes.push("Pedile la IP del servidor al administrador y volvé a correr: npm run preparar -- --ip <IP>");
} else if (!/^[a-z0-9.:-]+$/i.test(args.ip)) {
  mal(`IP inválida: ${args.ip}`);
  process.exit(1);
} else {
  const ruta = llave.replace(/\\/g, "/");
  appendFileSync(config, `${cfg && !cfg.endsWith("\n") ? "\n" : ""}
# ERP 2.0: clonar clientes (scripts/preparar.mjs)
Host ${HOST}
    HostName ${args.ip}
    User clonador
    IdentityFile "${ruta}"
    IdentitiesOnly yes
    StrictHostKeyChecking accept-new
    ServerAliveInterval 60
`);
  ok(`~/.ssh/config: sumé "Host ${HOST}" (usuario clonador)`);
}

// 4. Conexión
if (bloque || args.ip) {
  const r = psqlRemoto(HOST, "select 'ok';", { salida: "At" });
  if (r.status === 0 && r.stdout.trim() === "ok") ok(`Conexión con el servidor: entra y llega a la base`);
  else {
    const e = errorRemoto(r, HOST);
    if (/no acepta tu llave/.test(e)) {
      mal("El servidor todavía no tiene tu llave");
      pendientes.push(`Mandale al administrador ESTA línea (es tu llave pública, no es secreta):\n\n      ${publica}\n\n    Cuando te avise que la agregó, volvé a correr: npm run preparar`);
    } else { mal(`Conexión: ${e}`); pendientes.push("Revisá la IP y tu internet, o pasale este error al administrador."); }
  }
}

console.log(pendientes.length
  ? `\nFalta:\n${pendientes.map((p, i) => `  ${i + 1}. ${p}`).join("\n")}\n`
  : `\nListo: ya podés clonar. Abrí el formulario con  npm run clonar\n`);
process.exit(pendientes.length ? 1 : 0);
