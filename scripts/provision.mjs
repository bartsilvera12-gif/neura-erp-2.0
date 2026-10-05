#!/usr/bin/env node
/**
 * provision.mjs — crea/actualiza el schema de un cliente desde las migraciones
 * canónicas (db/canonical/*.sql), LIMPIO e independiente. Idempotente.
 *
 *   node scripts/provision.mjs --schema erp_clientex --db "postgres://..."
 *
 * No copia ningún schema vivo: cada cliente nace de los .sql canónicos. El nombre de
 * schema es el único parámetro. Requiere `psql` en el PATH (maneja :"schema" seguro).
 */
import { readdirSync } from "node:fs";
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
const db = args.db || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

if (!/^[a-z][a-z0-9_]{1,62}$/.test(schema)) {
  console.error("Schema inválido. Uso: --schema erp_clientex (minúsculas, empieza con letra)");
  process.exit(1);
}
if (!db) {
  console.error("Falta la cadena de conexión. Pasá --db o seteá SUPABASE_DB_URL.");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "db", "canonical");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

console.log(`Aprovisionando schema "${schema}" con ${files.length} archivo(s) canónico(s)...`);
for (const f of files) {
  process.stdout.write(`  ${f} ... `);
  const r = spawnSync(
    "psql",
    [db, "-v", "ON_ERROR_STOP=1", "-v", `schema=${schema}`, "-f", join(dir, f)],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    console.log("ERROR");
    console.error(r.stderr || r.stdout || r.error?.message);
    process.exit(1);
  }
  console.log("ok");
}
// Recargar el cache de PostgREST para que exponga el schema nuevo.
spawnSync("psql", [db, "-c", "NOTIFY pgrst, 'reload schema'"], { encoding: "utf8" });
console.log(`Listo. Schema "${schema}" aprovisionado y expuesto.`);
