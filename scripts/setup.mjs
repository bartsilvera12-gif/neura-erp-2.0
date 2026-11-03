#!/usr/bin/env node
/**
 * setup.mjs — deja este repo listo para UN cliente: escribe src/cliente.config.ts y .env.local.
 * Es lo único que cambia entre clones (ningún otro archivo conoce al cliente).
 *
 *   node scripts/setup.mjs --cliente "Ferretería República" --schema erp_republica \
 *     --dominio republica.neura.com.py [--color "#1F6F8B"] [--logo ruta/al/logo.webp] \
 *     [--modulos caja,inventario,clientes,...]
 *
 * Las claves de Supabase salen del .env.local que ya exista (o de --supabase-url / --anon-key /
 * --service-role-key). SIFEN_SECRETS_KEY se genera nueva para cada cliente. No imprime claves.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODULOS } from "./modulos.mjs"; // sin --modulos se activan todos

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const falla = (m) => { console.error(m); process.exit(1); };


const cliente = (args.cliente ?? "").trim();
const schema = (args.schema ?? "").trim().toLowerCase();
const dominio = (args.dominio ?? "").trim().toLowerCase();
const color = (args.color ?? "#3F8E91").trim();
if (!cliente) falla("Falta --cliente \"Nombre del cliente\"");
if (!/^[a-z][a-z0-9_]{1,62}$/.test(schema) || schema === "erp_demo") falla("Schema inválido: minúsculas, empieza con letra, sin espacios y distinto de erp_demo (ej. erp_republica)");
if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dominio)) falla("Dominio inválido (ej. republica.neura.com.py)");
if (!/^#[0-9a-f]{6}$/i.test(color)) falla("Color inválido: #RRGGBB");

const modulos = args.modulos ? args.modulos.split(",").map((m) => m.trim()).filter(Boolean) : MODULOS;
const desconocidos = modulos.filter((m) => !MODULOS.includes(m));
if (desconocidos.length) falla(`Módulos que no existen: ${desconocidos.join(", ")}. Los que hay: ${MODULOS.join(", ")}`);
if (!modulos.includes("configuracion")) modulos.push("configuracion");

// Logo: se copia a public/brand con un nombre fijo.
let logo;
if (args.logo) {
  if (!existsSync(args.logo)) falla(`No encuentro el logo: ${args.logo}`);
  const ext = extname(args.logo).toLowerCase();
  if (![".webp", ".png", ".svg", ".jpg", ".jpeg"].includes(ext)) falla("El logo tiene que ser .webp, .png, .svg o .jpg");
  logo = `/brand/logo-cliente${ext}`;
  copyFileSync(args.logo, join(raiz, "public", logo));
}

const esc = (s) => JSON.stringify(s);
writeFileSync(join(raiz, "src", "cliente.config.ts"), `import type { ClienteConfig } from "@/modules/types";

/**
 * Config de ESTE cliente. Es lo único personalizado del clon (lo escribe setup.mjs a
 * partir del formulario). Ningún otro archivo del código conoce al cliente.
 */
export const clienteConfig: ClienteConfig = {
  nombre: ${esc(cliente)},
  dominio: ${esc(dominio)},
  color: ${esc(color)},
  modulos: ${esc(modulos).replace(/","/g, '", "')}, // ids de módulos activos${logo ? `\n  logo: ${esc(logo)},` : ""}
};
`);

// .env.local: se conservan las claves que ya estén; cambian el schema y la clave de SIFEN.
const rutaEnv = join(raiz, ".env.local");
const previo = existsSync(rutaEnv) ? readFileSync(rutaEnv, "utf8") : "";
const leer = (k) => new RegExp(`^${k}=(.*)$`, "m").exec(previo)?.[1]?.trim();
const url = args["supabase-url"] ?? leer("NEXT_PUBLIC_SUPABASE_URL");
const anon = args["anon-key"] ?? leer("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const service = args["service-role-key"] ?? leer("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !anon || !service) falla("Faltan las claves de Supabase: copiá el .env.local de la flota a la raíz del repo o pasá --supabase-url, --anon-key y --service-role-key");
// Volver a correr setup para el MISMO schema conserva la clave: con otra, lo ya cifrado no se lee más.
const claveSifen = leer("APP_DB_SCHEMA") === schema && leer("SIFEN_SECRETS_KEY") ? leer("SIFEN_SECRETS_KEY") : randomBytes(48).toString("base64");

writeFileSync(rutaEnv, `# Generado por scripts/setup.mjs para ${cliente}. NO se versiona.
APP_DB_SCHEMA=${schema}

NEXT_PUBLIC_SUPABASE_URL=${url}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}
SUPABASE_SERVICE_ROLE_KEY=${service}

# Links de invitación, QR de las mesas y presupuestos: con https (detrás del proxy llega http).
APP_URL=https://${dominio}
MENU_PUBLIC_URL=https://${dominio}

# Cifra la contraseña del certificado, el CSC y las claves tributarias. Única de este cliente:
# si se pierde, hay que volver a cargar esos datos.
SIFEN_SECRETS_KEY=${claveSifen}
`);

console.log(`Listo para ${cliente}:
  src/cliente.config.ts  nombre, dominio, color, ${modulos.length} módulos${logo ? ", logo" : " (logo de Zentra)"}
  .env.local             schema ${schema} y una SIFEN_SECRETS_KEY nueva
Sigue: npm run provision -- --schema ${schema} --ssh <servidor>`);
