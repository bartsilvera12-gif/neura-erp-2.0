/**
 * Fuente ÚNICA del schema del tenant. Ningún nombre de schema se hardcodea en el
 * código: todo sale de APP_DB_SCHEMA. Al clonar para un cliente nuevo, lo único que
 * cambia es esta variable (ver scripts/setup.mjs y scripts/provision.mjs).
 */

const SCHEMA_RE = /^[a-z][a-z0-9_]{1,62}$/; // minúsculas, empieza con letra; sin comillas ni espacios

/** Valida un nombre de schema contra la allowlist de forma (anti-inyección). */
export function assertValidSchemaName(name: string): string {
  const s = (name ?? "").trim().toLowerCase();
  if (!SCHEMA_RE.test(s)) {
    throw new Error(`Nombre de schema inválido: ${JSON.stringify(name)}`);
  }
  return s;
}

/** El schema del tenant de ESTE deploy. Falla claro si falta. */
export function tenantSchema(): string {
  const raw = process.env.APP_DB_SCHEMA?.trim();
  if (!raw) {
    throw new Error(
      "APP_DB_SCHEMA no está seteado. Cada deploy/cliente define su propio schema. " +
        "Revisá .env.local (ver docs/ARQUITECTURA.md §1)."
    );
  }
  return assertValidSchemaName(raw);
}

/** Cita un identificador de Postgres de forma segura (doble comilla). */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** `"schema"."tabla"` seguro: schema por allowlist, tabla sanitizada. */
export function qualified(table: string, schema: string = tenantSchema()): string {
  const s = assertValidSchemaName(schema);
  const t = table.replace(/[^\w]/g, "");
  if (!t) throw new Error("Nombre de tabla inválido");
  return `${quoteIdent(s)}.${quoteIdent(t)}`;
}
