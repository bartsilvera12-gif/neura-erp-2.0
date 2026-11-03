/**
 * psql del servidor por SSH, siempre por la puerta `erp-psql` (scripts/servidor/instalar-clonador.sh).
 * Sirve igual con la llave restringida del usuario `clonador` (solo puede eso) y con la del
 * administrador (`ubuntu`). El SQL va por stdin; el schema se pasa como `\set schema` al principio,
 * así ningún dato del cliente viaja en la línea de comando.
 */
import { spawnSync } from "node:child_process";

/** Valor para `\set nombre '<valor>'` de psql: comillas dobladas, barras escapadas, una sola línea. */
export const valorPsql = (v) => `'${String(v).replace(/[\r\n]+/g, " ").replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;

/**
 * @param {string} ssh   host de ~/.ssh/config (ej. zentra-app)
 * @param {string} sql
 * @param {{ usuario?: "postgres" | "supabase_admin", salida?: "q" | "At" | "qAt", sinCuerpos?: boolean, schema?: string, vars?: Record<string, unknown> }} [o]
 */
export function psqlRemoto(ssh, sql, { usuario = "postgres", salida = "q", sinCuerpos = false, schema, vars = {} } = {}) {
  if (schema !== undefined && !/^[a-z][a-z0-9_]{1,62}$/.test(schema)) throw new Error(`Schema inválido: ${schema}`);
  const pedido = ["/usr/local/bin/erp-psql", usuario, salida, ...(sinCuerpos ? ["sincuerpos"] : [])].join(" ");
  const sets = [...(schema ? [`\\set schema ${schema}`] : []), ...Object.entries(vars).map(([k, v]) => `\\set ${k} ${valorPsql(v)}`)];
  return spawnSync("ssh", [ssh, pedido], { input: (sets.length ? sets.join("\n") + "\n" : "") + sql, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
}

/** Mensaje claro cuando la puerta no está instalada o la llave no entra. */
export function errorRemoto(r, ssh) {
  const t = `${r.stderr || ""}${r.error?.message || ""}`.trim();
  if (/erp-psql: (No such file|not found)|No such file or directory/.test(t) && /erp-psql/.test(t)) return `En ${ssh} falta erp-psql: quien administra el servidor tiene que correr scripts/servidor/instalar-clonador.sh.`;
  if (/Permission denied \(publickey/.test(t)) return `${ssh} no acepta tu llave SSH: pedile al administrador que la agregue (docs/PROGRAMADORES.md, paso 1d).`;
  if (/Could not resolve hostname|Connection (timed out|refused)/.test(t)) return `No llego a ${ssh}: revisá ~/.ssh/config (docs/PROGRAMADORES.md, paso 1e).`;
  return t || r.stdout || "sin respuesta";
}
