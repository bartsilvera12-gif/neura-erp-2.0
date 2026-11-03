#!/usr/bin/env node
/**
 * clonar.mjs — formulario para clonar el 2.0 para un cliente nuevo, de punta a punta.
 *
 *   npm run clonar            abre http://localhost:4545 (solo en esta máquina)
 *
 * Con los datos del formulario hace, en orden y frenando en el primer error:
 *   1. revisa los datos (schema libre, carpeta, SSH, claves de la flota)
 *   2. copia el código a una carpeta nueva (el 2.0 queda como remoto "base")
 *   3. setup.mjs        → cliente.config.ts (todos los módulos), logo y .env.local
 *   4. provision.mjs    → el schema desde db/canonical
 *   5. seed-admin.mjs   → empresa, usuario ADMIN y rubro (Comercio / Gastronomía)
 *   6. verify-rls.mjs y pruebas de plata y stock en el schema nuevo
 *   7. erp-habilitar    → schema y dominio en Supabase (en el servidor, con respaldo y registro);
 *                         solo después de que pasaron las pruebas
 *   8. npm ci + build (si se tilda) y commit en el repo del cliente
 *   9. erp-publicar     → repo privado en GitHub, DNS en Cloudflare y app en Coolify (Dockerfile),
 *                         publicada y respondiendo (los tokens quedan en el servidor)
 * Si algo falla, se corrige y se vuelve a tocar "Clonar" con los mismos datos: retoma la misma
 * carpeta (todo es idempotente y la clave de SIFEN se conserva).
 *
 * No muestra claves: la contraseña inicial del admin sale una sola vez, en el resumen final.
 */
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MODULOS } from "./modulos.mjs";
import { errorRemoto, psqlRemoto } from "./remoto.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUERTO = Number(process.env.CLONAR_PUERTO || 4545);

const leerEnv = (texto, k) => new RegExp(`^${k}=(.*)$`, "m").exec(texto)?.[1]?.trim();
const git = (cwd, ...a) => spawnSync("git", a, { cwd, encoding: "utf8" });
const repoBase = git(raiz, "remote", "get-url", "origin").stdout.trim();

// ── Validación (la misma en el navegador y acá) ─────────────────────────────────────────────
function validar(d) {
  const e = [];
  if (!d.nombre?.trim()) e.push("Falta el nombre del negocio.");
  if (!d.razon?.trim()) e.push("Falta la razón social.");
  if (!/^erp_[a-z0-9_]{1,58}$/.test(d.schema ?? "")) e.push("Schema inválido: empieza con erp_, solo minúsculas, números y _.");
  if (["erp_demo", "public", "zentra", "auth", "storage", "realtime"].includes(d.schema)) e.push(`El schema "${d.schema}" no se puede usar.`);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d.dominio ?? "")) e.push("Dominio inválido (ej. republica.neura.com.py).");
  if (!d.adminNombre?.trim()) e.push("Falta el nombre del administrador.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.adminEmail ?? "")) e.push("El correo del administrador no es válido.");
  if (d.adminPassword && d.adminPassword.length < 8) e.push("La contraseña tiene que tener al menos 8 caracteres (o dejala vacía y se genera).");
  if (!/^#[0-9a-f]{6}$/i.test(d.color ?? "")) e.push("Color inválido: #RRGGBB.");
  if (!["comercio", "gastronomia"].includes(d.rubro)) e.push("Elegí el rubro: Comercio o Gastronomía.");
  if (!d.destino?.trim()) e.push("Falta la carpeta del clon.");
  if (!d.ssh?.trim()) e.push("Falta el servidor SSH.");
  if (d.logo && !/^data:image\/(webp|png|svg\+xml|jpeg);base64,/.test(d.logo.data ?? "")) e.push("El logo tiene que ser .webp, .png, .svg o .jpg.");
  return e;
}

/** psql en el servidor (solo lecturas cortas). */
function psql(ssh, sql) {
  const r = psqlRemoto(ssh, sql, { salida: "At" });
  if (r.status !== 0) throw new Error(errorRemoto(r, ssh));
  return r.stdout.trim();
}

// ── Ejecución ───────────────────────────────────────────────────────────────────────────────
function correr(enviar, paso, cmd, args, { cwd, env, ocultar, input } = {}) {
  return new Promise((ok, mal) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, shell: process.platform === "win32" && cmd === "npm" });
    let ultima = "";
    const linea = (buf) => {
      for (let l of buf.toString().split(/\r?\n/)) {
        if (!l.trim()) continue;
        if (ocultar) l = ocultar(l);
        if (l) { ultima = l; enviar({ paso, linea: l }); }
      }
    };
    p.stdout.on("data", linea);
    p.stderr.on("data", linea);
    p.on("error", mal);
    p.on("close", (code) => (code === 0 ? ok() : mal(new Error(`${basename(String(args.find((a) => /\.mjs$/.test(a)) ?? cmd))} terminó con error (código ${code})${ultima ? `: ${ultima}` : ""}`))));
    p.stdin.end(input ?? "");
  });
}

/**
 * Suma el clon a Supabase con erp-habilitar (scripts/servidor/instalar-clonador.sh): lo puede la
 * llave restringida y la del administrador. Devuelve false si el dominio es propio del cliente y la
 * llave no alcanza (queda pendiente para el administrador).
 */
function habilitar(enviar, d) {
  const r = spawnSync("ssh", [d.ssh, `/usr/local/bin/erp-habilitar ${d.schema} ${d.dominio}`], { encoding: "utf8", timeout: 180_000 });
  const salida = `${r.stdout || ""}${r.stderr || ""}`.trim();
  if (r.status === 0) { enviar({ paso: "servidor", linea: salida.split("\n").pop() }); return true; }
  if (/solo se habilitan dominios/.test(salida)) { enviar({ paso: "servidor", linea: `Dominio propio del cliente: lo habilita quien administra el servidor.` }); return false; }
  if (/pedido no permitido|erp-habilitar: (command )?not found|No such file/.test(salida)) throw new Error(`En ${d.ssh} falta erp-habilitar: quien administra el servidor tiene que volver a correr scripts/servidor/instalar-clonador.sh.`);
  throw new Error(errorRemoto(r, d.ssh));
}

/** Espera a que Auth y la API respondan (después de recrear los servicios) y prueba el schema. */
async function esperarApi(enviar, paso, url, anon, schema) {
  for (let i = 0; i < 30; i++) {
    try {
      // La raíz /rest/v1/ la bloquea Kong (RBAC); se pregunta por una tabla. Sin sesión, la
      // respuesta es 200 vacío o 401 por permisos: lo único que importa es que no sea PGRST106
      // (406, "schema no expuesto").
      const [a, r] = await Promise.all([
        fetch(`${url}/auth/v1/health`, { headers: { apikey: anon } }),
        fetch(`${url}/rest/v1/empresas?select=id&limit=1`, { headers: { apikey: anon, "Accept-Profile": schema } }),
      ]);
      if (a.ok && r.status !== 406 && r.status < 500) { enviar({ paso, linea: `La API ya sirve el schema ${schema}.` }); return true; }
      if (a.ok && r.status === 406) enviar({ paso, linea: "La API todavía no ve el schema…" });
    } catch { /* reiniciando */ }
    await new Promise((s) => setTimeout(s, 3000));
  }
  return false;
}

let ocupado = false;

async function clonar(d, enviar) {
  const destino = resolve(d.destino);
  const marca = join(destino, ".git", "clonar.json");
  const retoma = existsSync(marca) && JSON.parse(readFileSync(marca, "utf8")).schema === d.schema;
  const paso = async (id, fn) => {
    enviar({ paso: id, estado: "corre" });
    try { const r = await fn(); enviar({ paso: id, estado: r === "salta" ? "salta" : "ok" }); }
    catch (e) { enviar({ paso: id, estado: "error", linea: String(e?.message ?? e) }); throw e; }
  };
  const node = (id, script, args, extra) => correr(enviar, id, process.execPath, [join(destino, "scripts", script), ...args], { cwd: destino, ...extra });

  await paso("revisar", async () => {
    const errores = validar(d);
    if (errores.length) throw new Error(errores.join(" "));
    const envBase = existsSync(join(raiz, ".env.local")) ? readFileSync(join(raiz, ".env.local"), "utf8") : "";
    for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) if (!leerEnv(envBase, k)) throw new Error(`Falta ${k} en el .env.local del 2.0 (${raiz}).`);
    if (existsSync(destino) && !retoma) throw new Error(`La carpeta ${destino} ya existe y no es un clon de "${d.schema}". Elegí otra.`);
    const existe = psql(d.ssh, `select count(*) from pg_namespace where nspname = '${d.schema}';`);
    enviar({ paso: "revisar", linea: `SSH a ${d.ssh}: ok.` });
    if (existe !== "0" && !retoma) throw new Error(`El schema ${d.schema} ya existe en el servidor. Elegí otro nombre.`);
    if (retoma) enviar({ paso: "revisar", linea: `Se retoma el clon de ${destino}.` });
  });

  await paso("copiar", async () => {
    if (retoma) { enviar({ paso: "copiar", linea: "Ya estaba copiado." }); return "salta"; }
    const sucios = git(raiz, "status", "--porcelain", "--untracked-files=no").stdout.trim();
    if (sucios) enviar({ paso: "copiar", linea: "Ojo: el 2.0 tiene cambios sin commit; se copia lo último commiteado." });
    await correr(enviar, "copiar", "git", ["clone", "--no-hardlinks", "--quiet", raiz, destino]);
    git(destino, "remote", "remove", "origin");
    git(destino, "remote", "add", "base", repoBase || raiz);
    copyFileSync(join(raiz, ".env.local"), join(destino, ".env.local"));
    writeFileSync(marca, JSON.stringify({ schema: d.schema, creado: new Date().toISOString() }));
    enviar({ paso: "copiar", linea: `Código en ${destino} (remoto "base" = el 2.0).` });
  });

  await paso("personalizar", async () => {
    const args = ["--cliente", d.nombre.trim(), "--schema", d.schema, "--dominio", d.dominio, "--color", d.color, "--modulos", MODULOS.join(",")];
    if (d.logo) {
      const ext = { "image/webp": ".webp", "image/png": ".png", "image/svg+xml": ".svg", "image/jpeg": ".jpg" }[d.logo.data.slice(5, d.logo.data.indexOf(";"))];
      const tmp = join(mkdtempSync(join(tmpdir(), "clonar-")), `logo${ext}`);
      writeFileSync(tmp, Buffer.from(d.logo.data.split(",")[1], "base64"));
      args.push("--logo", tmp);
    }
    await node("personalizar", "setup.mjs", args);
  });

  await paso("base", () => node("base", "provision.mjs", ["--schema", d.schema, "--ssh", d.ssh]));

  const envClon = readFileSync(join(destino, ".env.local"), "utf8");
  const url = leerEnv(envClon, "NEXT_PUBLIC_SUPABASE_URL");
  const anon = leerEnv(envClon, "NEXT_PUBLIC_SUPABASE_ANON_KEY");

  let password = null;
  await paso("admin", () => {
    const args = ["--schema", d.schema, "--ssh", d.ssh, "--empresa", d.razon.trim(), "--email", d.adminEmail.trim().toLowerCase(), "--nombre", d.adminNombre.trim()];
    if (d.adminPassword) args.push("--password", d.adminPassword);
    args.push("--rubro", d.rubro, "--ocultar-rubro", d.ocultarRubro ? "si" : "no");
    return node("admin", "seed-admin.mjs", args, {
      ocultar: (l) => {
        const m = /Contraseña inicial: (\S+)/.exec(l);
        if (!m) return l;
        password = m[1];
        return d.adminPassword ? "Contraseña: la que escribiste en el formulario." : "Contraseña inicial generada: se muestra al final.";
      },
    });
  });

  await paso("seguridad", () => node("seguridad", "verify-rls.mjs", ["--schema", d.schema, "--ssh", d.ssh]));
  await paso("pruebas", () => node("pruebas", "pruebas-db.mjs", [], { env: { PRUEBAS_SCHEMA: d.schema, PRUEBAS_SSH: d.ssh } }));

  let habilitado = false;
  await paso("servidor", async () => {
    habilitado = habilitar(enviar, d);
    if (!habilitado) return "salta";
    if (!(await esperarApi(enviar, "servidor", url, anon, d.schema))) throw new Error("La API no respondió con el schema nuevo en 90 s: avisale a quien administra el servidor (servicios rest y auth).");
  });

  await paso("compilar", async () => {
    if (!d.compilar) { enviar({ paso: "compilar", linea: "No tildado." }); return "salta"; }
    await correr(enviar, "compilar", "npm", ["ci", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: destino });
    await correr(enviar, "compilar", "npm", ["run", "build"], { cwd: destino, ocultar: (l) => (/^\s*([├└┌│ƒ○●]|Route \()/.test(l) ? "" : l) });
    enviar({ paso: "compilar", linea: "Compiló sin errores." });
  });

  await paso("git", async () => {
    git(destino, "add", "-A");
    const hay = git(destino, "status", "--porcelain").stdout.trim();
    if (hay) {
      const c = spawnSync("git", ["commit", "-q", "-m", `Cliente ${d.nombre.trim()}: configuración inicial`], { cwd: destino, encoding: "utf8" });
      if (c.status !== 0) throw new Error(`git commit: ${(c.stderr || c.stdout).trim()}`);
      enviar({ paso: "git", linea: "Commit con la configuración del cliente." });
    } else enviar({ paso: "git", linea: "No había nada nuevo para guardar." });
  });

  // Repo privado, DNS y Coolify: lo hace el servidor con sus tokens (erp-publicar); acá solo se
  // sube el código con una llave temporal que el servidor borra después.
  let publicado = null, repoWeb = null;
  await paso("publicar", async () => {
    if (!d.publicar) { enviar({ paso: "publicar", linea: "No tildado." }); return "salta"; }
    if (!habilitado) { enviar({ paso: "publicar", linea: "Falta que el administrador lo habilite (dominio propio)." }); return "salta"; }
    const r = spawnSync("ssh", [d.ssh, `/usr/local/bin/erp-publicar repo ${d.schema}`], { encoding: "utf8", timeout: 120_000 });
    if (r.status !== 0) {
      const t = `${r.stderr || ""}${r.stdout || ""}`.trim();
      throw new Error(/pedido no permitido|not found|No such file/.test(t) ? `En ${d.ssh} falta erp-publicar: quien administra el servidor tiene que volver a correr scripts/servidor/instalar-clonador.sh.` : t.split("\n").pop() || errorRemoto(r, d.ssh));
    }
    const remoto = /^REPO=(\S+)$/m.exec(r.stdout)?.[1];
    repoWeb = /^WEB=(\S+)$/m.exec(r.stdout)?.[1];
    const llave = /-----BEGIN [\s\S]+?-----END [^\n]+-----\n?/.exec(r.stdout)?.[0];
    if (!remoto || !llave) throw new Error("El servidor no devolvió el repo del cliente.");
    git(destino, "remote", "remove", "origin");
    git(destino, "remote", "add", "origin", `${repoWeb}.git`);
    const dirLlave = mkdtempSync(join(tmpdir(), "clonar-llave-"));
    const archivo = join(dirLlave, "llave");
    writeFileSync(archivo, llave, { mode: 0o600 });
    try {
      await correr(enviar, "publicar", "git", ["-c", `core.sshCommand=ssh -i "${archivo.replace(/\\/g, "/")}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`, "push", "--quiet", remoto, "HEAD:main"], { cwd: destino });
    } finally { rmSync(dirLlave, { recursive: true, force: true }); }
    enviar({ paso: "publicar", linea: `Código subido a ${repoWeb}` });
    await correr(enviar, "publicar", "ssh", [d.ssh, `/usr/local/bin/erp-publicar app ${d.schema} ${d.dominio}`], {
      input: readFileSync(join(destino, ".env.local"), "utf8"),
      ocultar: (l) => l.replace(/^· /, "").replace(/^erp-publicar: /, ""),
    });
    publicado = `https://${d.dominio}`;
  });

  enviar({
    fin: true,
    resumen: {
      destino, schema: d.schema, dominio: d.dominio, admin: d.adminEmail.trim().toLowerCase(),
      rubro: d.rubro, password: d.adminPassword ? null : password, servidor: habilitado, compilado: !!d.compilar,
      publicado, repo: repoWeb,
    },
  });
}

// ── Servidor web local ──────────────────────────────────────────────────────────────────────
const html = () => readFileSync(join(raiz, "scripts", "clonar-formulario.html"), "utf8")
  .replace("/*DATOS*/null", JSON.stringify({ padre: dirname(raiz), ssh: process.env.PRUEBAS_SSH || "neura-erp" }));

const srv = http.createServer(async (req, res) => {
  const ruta = (req.url ?? "/").split("?")[0];
  if (req.method === "GET" && (ruta === "/" || ruta === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(html());
  }
  if (req.method === "POST" && ruta === "/clonar") {
    let cuerpo = "";
    for await (const c of req) { cuerpo += c; if (cuerpo.length > 8e6) return res.writeHead(413).end(); }
    res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" });
    const enviar = (ev) => res.write(JSON.stringify(ev) + "\n");
    if (ocupado) { enviar({ error: "Ya hay un clonado en curso." }); return res.end(); }
    ocupado = true;
    try { await clonar(JSON.parse(cuerpo), enviar); }
    catch (e) { enviar({ error: String(e?.message ?? e) }); }
    finally { ocupado = false; res.end(); }
    return;
  }
  res.writeHead(404).end();
});

srv.listen(PUERTO, "127.0.0.1", () => {
  const dir = `http://localhost:${PUERTO}`;
  console.log(`Formulario para clonar el 2.0: ${dir}  (Ctrl+C para cerrar)`);
  if (!process.env.CLONAR_SIN_NAVEGADOR) {
    const abrir = process.platform === "win32" ? ["cmd", ["/c", "start", "", dir]] : process.platform === "darwin" ? ["open", [dir]] : ["xdg-open", [dir]];
    spawn(abrir[0], abrir[1], { stdio: "ignore", detached: true }).unref();
  }
});
