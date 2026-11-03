#!/usr/bin/env node
/**
 * seed-admin.mjs — crea la empresa y su primer usuario ADMIN en el schema del cliente.
 *
 *   node scripts/seed-admin.mjs --schema erp_republica --ssh zentra-app \
 *     --empresa "Ferretería República S.A." --email admin@republica.com.py --nombre "Juan Pérez" [--password ...]
 *     [--rubro comercio|gastronomia] [--ocultar-rubro si]
 *
 * 1. Cuenta de acceso en Supabase Auth (con SUPABASE_SERVICE_ROLE_KEY de .env.local). Si el email ya
 *    tiene cuenta (el Auth es compartido por la flota) se usa esa, sin tocarle la contraseña.
 * 2. En el schema: la empresa (sus perfiles, primera sucursal, depósito, caja y catálogo de gastos
 *    los crea la base sola) y el usuario ADMIN con el perfil Administrador.
 * 3. El rubro (Configuración › Rubro y funciones): Comercio, todo lo de cocina apagado (default);
 *    Gastronomía, Mesas y QR, Cocina y Recetas prendidas y dadas a Cajero y Supervisor (receta 113).
 *    --ocultar-rubro si: el cliente no ve esa pantalla (solo Neura lo cambia, por SQL).
 * Idempotente: si la empresa o el usuario ya están, no los duplica.
 */
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { errorRemoto, psqlRemoto } from "./remoto.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const falla = (m) => { console.error(m); process.exit(1); };

const schema = (args.schema ?? "").trim().toLowerCase();
const empresa = (args.empresa ?? "").trim();
const email = (args.email ?? "").trim().toLowerCase();
const nombre = (args.nombre ?? "").trim();
if (!/^[a-z][a-z0-9_]{1,62}$/.test(schema)) falla("Falta --schema erp_cliente");
if (!empresa || !nombre || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) falla("Faltan --empresa, --nombre o un --email válido");
if (!args.ssh && !args.db) falla("Falta --ssh <servidor> o --db <postgres://...>");
const rubro = (args.rubro ?? "comercio").trim().toLowerCase();
if (!["comercio", "gastronomia"].includes(rubro)) falla("--rubro tiene que ser comercio o gastronomia");
const gastro = rubro === "gastronomia";
const ocultarRubro = ["si", "sí", "true", "1"].includes(String(args["ocultar-rubro"] ?? "").toLowerCase());

const env = existsSync(join(raiz, ".env.local")) ? readFileSync(join(raiz, ".env.local"), "utf8") : "";
const leer = (k) => process.env[k] ?? new RegExp(`^${k}=(.*)$`, "m").exec(env)?.[1]?.trim();
const url = leer("NEXT_PUBLIC_SUPABASE_URL");
const service = leer("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !service) falla("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local (corré setup.mjs primero)");
if (leer("APP_DB_SCHEMA") && leer("APP_DB_SCHEMA") !== schema) falla(`.env.local dice APP_DB_SCHEMA=${leer("APP_DB_SCHEMA")} y pediste ${schema}: revisá cuál es`);

const auth = (ruta, init = {}) => fetch(`${url}/auth/v1${ruta}`, { ...init, headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json", ...init.headers } });

// 1. Cuenta de acceso
let authId;
let password = null;
for (let pagina = 1; !authId; pagina++) {
  const r = await auth(`/admin/users?page=${pagina}&per_page=200`);
  if (!r.ok) falla(`No pude leer las cuentas de Auth (${r.status}). ¿La SERVICE_ROLE_KEY es la correcta?`);
  const { users = [] } = await r.json();
  authId = users.find((u) => u.email?.toLowerCase() === email)?.id;
  if (users.length < 200) break;
}
if (authId) {
  console.log(`El email ya tiene cuenta: se usa la misma (no se cambia su contraseña).`);
} else {
  password = args.password || randomBytes(12).toString("base64url");
  const r = await auth("/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { nombre } }) });
  const j = await r.json();
  if (!r.ok || !j.id) falla(`No pude crear la cuenta: ${j.msg ?? j.message ?? r.status}`);
  authId = j.id;
}

// 2. Empresa y usuario (dos sentencias: los perfiles los crea un trigger al terminar la primera)
const sql = `
set search_path to :"schema", public;
insert into empresas (nombre, razon_social)
select :'empresa', :'empresa' where not exists (select 1 from empresas);
insert into usuarios (empresa_id, auth_user_id, nombre, nombres, email, rol, activo)
select e.id, :'auth'::uuid, :'nombre', :'nombre', :'email', 'ADMIN', true
  from (select id from empresas order by creado_at limit 1) e
 where not exists (select 1 from usuarios where auth_user_id = :'auth'::uuid);
insert into empresa_funciones (empresa_id, mesas, cocina, recetas, pedidos, funciones_ocultas)
select id, :'gastro'::boolean, :'gastro'::boolean, :'gastro'::boolean, true, :'ocultas'::boolean from (select id from empresas order by creado_at limit 1) e
on conflict (empresa_id) do update set mesas = excluded.mesas, cocina = excluded.cocina, recetas = excluded.recetas,
  funciones_ocultas = excluded.funciones_ocultas, updated_at = now();
select rubro_dar_pantallas(id, :'gastro'::boolean, :'gastro'::boolean) from (select id from empresas order by creado_at limit 1) e where :'gastro'::boolean;
select 'empresa=' || (select nombre from empresas order by creado_at limit 1) || ' perfil=' || coalesce((select p.nombre from usuarios u join perfiles p on p.id = u.perfil_id where u.auth_user_id = :'auth'::uuid), 'NINGUNO')
  || ' rubro=' || (select case when mesas and cocina and recetas then 'Gastronomía' when not (mesas or cocina or recetas) then 'Comercio' else 'personalizado' end || case when funciones_ocultas then ' (oculto al cliente)' else '' end from empresa_funciones order by updated_at desc limit 1);
`;
const valores = { empresa, nombre, email, auth: authId, gastro, ocultas: ocultarRubro };
const r = args.ssh
  ? psqlRemoto(args.ssh, sql, { salida: "At", schema, vars: valores })
  : spawnSync("psql", [args.db, "-v", "ON_ERROR_STOP=1", "-At", "-v", `schema=${schema}`, ...Object.entries(valores).flatMap(([k, v]) => ["-v", `${k}=${v}`]), "-f", "-"], { input: sql, encoding: "utf8" });
if (r.status !== 0) falla(`No pude crear la empresa o el usuario:\n${args.ssh ? errorRemoto(r, args.ssh) : r.stderr || r.stdout}`);
console.log((r.stdout.trim().split("\n").pop() ?? "").replace(/^/, "  "));
console.log(`Listo. Admin: ${email}${password ? `\n  Contraseña inicial: ${password}  (pasásela al cliente por un canal seguro y que la cambie)` : ""}`);
