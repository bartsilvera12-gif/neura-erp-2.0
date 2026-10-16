/**
 * Búsqueda inteligente para listados que filtra PostgREST (ventas, compras, órdenes de
 * compra, órdenes de pago, kardex, tickets): cada tabla tiene una columna `busqueda` con su
 * texto ya normalizado (sin tildes, minúsculas, con y sin separadores; ver
 * db/canonical/19_busqueda.sql y 58_busqueda_precisa.sql) y la base sugiere variantes para
 * los errores de tipeo ("yerva" → "yerba"). Cada palabra tiene que aparecer, en cualquier
 * orden, como ella misma o como alguna de sus variantes.
 *
 * Precisión (58): `exactos_busqueda` resuelve en la base el número de documento ("vta 17",
 * "VTA-000017", "17") y el monto ("26000" / "26.000"). Con documento exacto la lista muestra
 * SOLO esos; con monto exacto, esos van primero y después el resto por texto
 * (`paginarConPrimeros`).
 * Solo servidor.
 */
import type { TenantDb } from "@/lib/api/tenant-db";

/** Grupos de variantes por palabra: [["yerva","yerba"], ["1kg"]]. Vacío si no hay búsqueda. */
export async function variantesBusqueda(db: TenantDb, q: string | null | undefined): Promise<string[][]> {
  const texto = (q ?? "").trim();
  if (!texto) return [];
  const { data, error } = await db.rpc<string[][]>("variantes_busqueda", { p_q: texto.slice(0, 200) });
  if (error || !Array.isArray(data)) {
    // Si la base no responde, al menos palabra por palabra sin tildes.
    return texto
      .normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
      .split(/[^a-z0-9]+/).filter(Boolean).slice(0, 8).map((t) => [t]);
  }
  // Solo letras y números (las genera la base así): seguras dentro de un or=(...).
  return data.map((g) => g.filter((v) => /^[a-z0-9]+$/.test(v))).filter((g) => g.length);
}

/**
 * Condición or=(...) de PostgREST para un grupo: la palabra o cualquiera de sus variantes
 * dentro de `columna`, más condiciones extra opcionales (ej. total exacto).
 */
export function condicionGrupo(grupo: string[], columna = "busqueda", extra: string[] = []): string {
  return [...grupo.map((v) => `${columna}.ilike.*${v}*`), ...extra].join(",");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lo que resolvió la base: documentos exactos, montos exactos y si van solos. */
/** `valor`: el total escrito, si hay registros con ese total (se filtra `total = valor`). */
export type Exactos = { doc: string[]; monto: string[]; solo: boolean; valor: number | null };

/** Documento / monto exacto (ver exactos_busqueda en 58). Sin búsqueda o si falla: nada. */
export async function exactosBusqueda(
  db: TenantDb,
  tabla: "ventas" | "compras" | "ordenes_compra" | "pagos_proveedores",
  q: string | null | undefined,
): Promise<Exactos> {
  const texto = (q ?? "").trim();
  const nada: Exactos = { doc: [], monto: [], solo: false, valor: null };
  if (!texto) return nada;
  const { data, error } = await db.rpc<Exactos>("exactos_busqueda", { p_tabla: tabla, p_q: texto.slice(0, 200) });
  if (error || !data) return nada;
  const ids = (l: unknown) => (Array.isArray(l) ? l.filter((x): x is string => typeof x === "string" && UUID_RE.test(x)) : []);
  const valor = Number((data as { valor?: unknown }).valor);
  return { doc: ids(data.doc), monto: ids(data.monto), solo: !!data.solo, valor: Number.isFinite(valor) && ids(data.monto).length ? valor : null };
}

/** Búsqueda ya resuelta para un listado: grupos de palabras + exactos. */
export type Busqueda = { grupos: string[][]; exactos: Exactos };

export async function prepararBusqueda(
  db: TenantDb,
  tabla: "ventas" | "compras" | "ordenes_compra" | "pagos_proveedores",
  q: string | null | undefined,
): Promise<Busqueda> {
  const [grupos, exactos] = await Promise.all([variantesBusqueda(db, q), exactosBusqueda(db, tabla, q)]);
  return { grupos, exactos };
}

/** ¿Hay algo que filtrar? */
export const hayBusqueda = (b: Busqueda) => b.grupos.length > 0 || b.exactos.solo || b.exactos.valor != null;

/** Total que va primero (las de ese monto exacto, antes que el resto por texto). */
export const primerosDe = (b: Busqueda): number | null => (b.exactos.solo ? null : b.exactos.valor);

/** Restricción de `paginarConPrimeros`: solo las del total exacto, o todas menos esas. */
export type Primeros = { soloTotal?: number; sinTotal?: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;

/**
 * Aplica la búsqueda a un builder de PostgREST:
 *   · documento exacto → solo esos ids (o ninguno, si se escribió un número de la serie que no existe)
 *   · si no → cada palabra (o su variante) en `columna`, O el monto exacto
 */
export function aplicarBusqueda(query: Q, b: Busqueda, columna = "busqueda"): Q {
  const { grupos, exactos } = b;
  if (exactos.solo) return query.in("id", exactos.doc.length ? exactos.doc : ["00000000-0000-0000-0000-000000000000"]);
  if (exactos.valor == null) {
    for (const g of grupos) query = query.or(condicionGrupo(g, columna));
    return query;
  }
  // Por valor y no por lista de ids: con muchas ventas del mismo total la URL no entraba.
  const porMonto = `total.eq.${exactos.valor}`;
  if (!grupos.length) return query.or(porMonto);
  const texto = grupos.length === 1
    ? `or(${condicionGrupo(grupos[0], columna)})`
    : `and(${grupos.map((g) => `or(${condicionGrupo(g, columna)})`).join(",")})`;
  return query.or(`${texto},${porMonto}`);
}

/**
 * Página con las coincidencias exactas PRIMERO (aunque la lista ordene por fecha):
 * `armar(r)` devuelve el builder completo (select con count, filtros, búsqueda y orden) y
 * `r` le agrega "solo estos ids" o "sin estos ids". Sin `primeros`, es una página común.
 */
export async function paginarConPrimeros(
  armar: (r: Primeros) => Q,
  primeros: number | null,
  desde: number,
  porPagina: number,
): Promise<{ data: unknown[]; count: number | null; error: { code?: string; message?: string } | null }> {
  if (primeros == null) {
    const r = await armar({}).range(desde, desde + porPagina - 1);
    return { data: r.data ?? [], count: r.count ?? null, error: r.error ?? null };
  }
  // (las exactas son pocas: el detalle las limita a 100)
  const a = await armar({ soloTotal: primeros }).range(0, 99);
  if (a.error) return { data: [], count: null, error: a.error };
  const exactas = (a.data ?? []) as unknown[];
  const nA = a.count ?? exactas.length;
  const deA = exactas.slice(desde, desde + porPagina);
  const faltan = porPagina - deA.length;
  const restoDesde = Math.max(0, desde - nA);
  // aunque no falte ninguna, se pide 1 fila para tener el total del resto
  let b = await armar({ sinTotal: primeros }).range(restoDesde, restoDesde + Math.max(faltan, 1) - 1);
  let resto = faltan > 0 ? ((b.data ?? []) as unknown[]) : [];
  if ((b.error as { code?: string } | null)?.code === "PGRST103") {
    // el resto no llega a esta página: solo hace falta su total
    resto = [];
    b = await armar({ sinTotal: primeros }).range(0, 0);
  }
  if (b.error) return { data: [], count: null, error: b.error };
  return { data: [...deA, ...resto], count: b.count == null ? null : nA + b.count, error: null };
}

/** Agrega al builder la restricción de ids de `paginarConPrimeros`. */
export function restringirIds(query: Q, r: Primeros): Q {
  if (r.soloTotal != null) return query.eq("total", r.soloTotal);
  if (r.sinTotal != null) return query.neq("total", r.sinTotal);
  return query;
}
