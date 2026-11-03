#!/usr/bin/env node
/**
 * provision.mjs — crea/actualiza el schema de un cliente desde las migraciones
 * canónicas (db/canonical/*.sql), LIMPIO e independiente. Idempotente.
 *
 *   node scripts/provision.mjs --schema erp_clientex --db "postgres://..."   (psql local)
 *   node scripts/provision.mjs --schema erp_clientex --ssh zentra-app        (psql del servidor, por SSH)
 *
 * No copia ningún schema vivo: cada cliente nace de los .sql canónicos. El nombre de
 * schema es el único parámetro. Corre con check_function_bodies=off (como pg_restore): una función
 * puede nombrar una columna que agrega una receta posterior. Las recetas van por su número (00, 10, 11, …, 100, 120),
 * no por orden alfabético: "100_" no puede correr antes que "10_".
 */
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);

const schema = (args.schema || "").trim().toLowerCase();
const ssh = args.ssh;
const db = args.db || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
const desde = Number(args.desde ?? 0);

if (!/^[a-z][a-z0-9_]{1,62}$/.test(schema)) {
  console.error("Schema inválido. Uso: --schema erp_clientex (minúsculas, empieza con letra)");
  process.exit(1);
}
if (!ssh && !db) {
  console.error("Falta cómo conectarse: --ssh <host> (psql del servidor) o --db / SUPABASE_DB_URL.");
  process.exit(1);
}

const numero = (f) => Number(/^(\d+)/.exec(f)?.[1] ?? Infinity);
const here = dirname(fileURLToPath(import.meta.url));
const recetas = (sub) => {
  const dir = join(here, "..", "db", sub);
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort((a, b) => numero(a) - numero(b) || a.localeCompare(b)).map((f) => ({ f, ruta: join(dir, f) }));
};
// db/storage es GLOBAL del servidor (un bucket para todos): solo con --storage, una vez por instancia.
const files = args.storage !== undefined ? recetas("storage") : recetas("canonical").filter((x) => numero(x.f) >= desde);

// Las recetas que tocan tablas de Supabase (realtime.messages) lo dicen en su encabezado.
const usuarioDe = (sql) => (/CONECTADO COMO supabase_admin/i.test(sql) ? "supabase_admin" : "postgres");

function correr(sql) {
  const usuario = usuarioDe(sql);
  if (ssh) {
    return spawnSync("ssh", [ssh, `docker exec -i -e PGCLIENTENCODING=UTF8 -e PGOPTIONS=-ccheck_function_bodies=off supabase-db psql -U ${usuario} -v ON_ERROR_STOP=1 -v schema=${schema} -q -f -`], { input: sql, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  }
  return spawnSync("psql", [usuario === "postgres" ? db : db.replace(/\/\/[^:@/]+/, `//${usuario}`), "-v", "ON_ERROR_STOP=1", "-v", `schema=${schema}`, "-q", "-f", "-"], { input: sql, encoding: "utf8", maxBuffer: 50 * 1024 * 1024, env: { ...process.env, PGOPTIONS: "-c check_function_bodies=off" } });
}

console.log(`Aprovisionando schema "${schema}" con ${files.length} receta(s)...`);
for (const { f, ruta } of files) {
  process.stdout.write(`  ${f} ... `);
  const r = correr(readFileSync(ruta, "utf8"));
  if (r.status !== 0) {
    console.log("ERROR");
    console.error(r.stderr || r.stdout || r.error?.message);
    console.error(`\nSe cortó en ${f}. Corregí y volvé a correr con --desde ${numero(f)} (lo anterior ya quedó aplicado).`);
    process.exit(1);
  }
  console.log("ok");
}
// Recargar el cache de PostgREST para que exponga el schema nuevo.
correr("NOTIFY pgrst, 'reload schema';");
console.log(`Listo. Schema "${schema}" aprovisionado.`);
console.log(`Para que la API lo vea, "${schema}" tiene que estar en PGRST_DB_SCHEMAS del servicio rest de Supabase.`);
