#!/usr/bin/env node
/**
 * verify-rls.mjs — revisa que el schema de un cliente esté cerrado. Solo lee.
 *
 *   node scripts/verify-rls.mjs --schema erp_republica --ssh zentra-app
 *
 * Falla si: una tabla no tiene RLS, anon puede leer o escribir una tabla, o anon puede ejecutar
 * una función del schema. Avisa (sin fallar) las tablas con RLS pero sin ninguna política: nadie
 * las lee directo, solo las funciones (es lo buscado en las tablas de plata).
 */
import { spawnSync } from "node:child_process";
import { errorRemoto, psqlRemoto } from "./remoto.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const schema = (args.schema ?? "").trim().toLowerCase();
if (!/^[a-z][a-z0-9_]{1,62}$/.test(schema)) { console.error("Falta --schema erp_cliente"); process.exit(1); }
if (!args.ssh && !args.db) { console.error("Falta --ssh <servidor> o --db <postgres://...>"); process.exit(1); }

const sql = `
select 'sin_rls|' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = :'schema' and c.relkind in ('r', 'p') and not c.relrowsecurity;
select 'anon_tabla|' || table_name || ' ' || string_agg(privilege_type, ',') from information_schema.role_table_grants
 where table_schema = :'schema' and grantee in ('anon', 'PUBLIC') group by table_name;
select 'anon_funcion|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = :'schema' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
   and p.prorettype <> 'trigger'::regtype;
select 'sin_politica|' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = :'schema' and c.relkind = 'r' and c.relrowsecurity and not exists (select 1 from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname);
select 'tablas|' || count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = :'schema' and c.relkind = 'r';
`;
const r = args.ssh
  ? psqlRemoto(args.ssh, sql, { salida: "At", schema })
  : spawnSync("psql", [args.db, "-v", "ON_ERROR_STOP=1", "-At", "-v", `schema=${schema}`, "-f", "-"], { input: sql, encoding: "utf8" });
if (r.status !== 0) { console.error(args.ssh ? errorRemoto(r, args.ssh) : r.stderr || r.stdout); process.exit(2); }

// Públicas a propósito: entran con el token del QR de la mesa o del link del presupuesto.
const PUBLICAS = new Set(["mesa_qr_activo", "mesa_menu_publico", "mesa_pedido_publico_crear", "mesa_pedidos_publico_estado", "mesa_publico_cuenta",
  "mesa_publico_dividir", "mesa_publico_pedir_cuenta", "mesa_publico_buscar_ruc", "mesa_publico_facturacion",
  "presupuesto_publico", "presupuesto_publico_visto", "presupuesto_publico_responder"]);

const filas = r.stdout.trim().split("\n").filter(Boolean).map((l) => l.split("|"));
const de = (k) => filas.filter((f) => f[0] === k).map((f) => f[1]);
const tablas = de("tablas")[0] ?? "0";
if (tablas === "0") { console.error(`El schema "${schema}" no tiene tablas: ¿está aprovisionado?`); process.exit(2); }
const errores = [
  ...de("sin_rls").map((t) => `Tabla sin RLS: ${t}`),
  ...de("anon_tabla").map((t) => `anon tiene permisos sobre la tabla ${t}`),
  ...de("anon_funcion").filter((f) => !PUBLICAS.has(f.split("(")[0])).map((f) => `anon puede ejecutar ${f} (si es pública a propósito, sumala a PUBLICAS)`),
];
for (const e of errores) console.log(`  FALLA ${e}`);
const sinPolitica = de("sin_politica");
console.log(`\n${schema}: ${tablas} tablas, ${errores.length} problema(s).${sinPolitica.length ? ` ${sinPolitica.length} tablas solo se usan por funciones (sin políticas): está bien.` : ""}`);
process.exit(errores.length ? 1 : 0);
