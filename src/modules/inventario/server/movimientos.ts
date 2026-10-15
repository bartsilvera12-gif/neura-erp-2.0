/**
 * Consulta del kardex (movimientos_inventario) con filtros — compartida por el listado
 * paginado y la exportación a Excel. Solo servidor.
 */
import type { TenantDb } from "@/lib/api/tenant-db";
import { condicionGrupo } from "@/lib/api/busqueda-servidor";
import { UUID_RE as UUID, faltaFuncion } from "@/modules/inventario/server/ids";

export const COLS_MOV =
  "id, producto_id, producto_nombre, producto_sku, tipo, cantidad, costo_unitario, origen, referencia, proveedor, numero_factura, usuario_nombre, fecha, deposito_id, documento_tipo, documento_id, documento_numero, deposito_contraparte_id";
export const TIPOS_MOV = ["ENTRADA", "SALIDA"];
export const ORIGENES_MOV = [
  "inventario_inicial", "ajuste_manual", "venta", "anulacion_venta", "compra", "anulacion_compra",
  "traslado_salida", "traslado_entrada", "anulacion_traslado", "ajuste", "perdida",
  "anulacion_ajuste", "anulacion_perdida", "apertura",
];
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const limpio = (t: string) => t.replace(/[,()"\\*:]/g, "").trim();

/** origen: uno o varios separados por coma (pestañas del kardex). */
export type FiltrosMov = { q: string; tipo: string; origen: string; desde: string; hasta: string; producto: string; deposito: string; sucursal: string };

export function filtrosDeUrl(sp: URLSearchParams): FiltrosMov {
  return {
    q: limpio(sp.get("q") ?? ""),
    tipo: sp.get("tipo") ?? "",
    origen: sp.get("origen") ?? "",
    desde: sp.get("desde") ?? "",
    hasta: sp.get("hasta") ?? "",
    producto: sp.get("producto") ?? "",
    deposito: sp.get("deposito") ?? "",
    sucursal: sp.get("sucursal") ?? "",
  };
}

const origenes = (f: FiltrosMov) => f.origen.split(",").filter((o) => ORIGENES_MOV.includes(o));

/**
 * Arma la consulta filtrada (más reciente primero). Respaldo si la receta 50 no está
 * aplicada (sin sucursal: eso lo resuelve la función de la base).
 */
export function consultaMovimientos(db: TenantDb, f: FiltrosMov, opts?: { count?: "exact" }, grupos: string[][] = []) {
  let q = db.select("movimientos_inventario", COLS_MOV, opts);
  if (TIPOS_MOV.includes(f.tipo)) q = q.eq("tipo", f.tipo);
  const o = origenes(f);
  if (o.length) q = q.in("origen", o);
  if (UUID.test(f.producto)) q = q.eq("producto_id", f.producto);
  if (UUID.test(f.deposito)) q = q.eq("deposito_id", f.deposito);
  // Fechas en hora de Paraguay (UTC-3).
  if (RE_FECHA.test(f.desde)) q = q.gte("fecha", `${f.desde}T00:00:00-03:00`);
  if (RE_FECHA.test(f.hasta)) q = q.lte("fecha", `${f.hasta}T23:59:59.999-03:00`);
  for (const g of grupos) q = q.or(condicionGrupo(g));
  return q.order("fecha", { ascending: false }).order("id", { ascending: false });
}

/**
 * Kardex en UNA llamada a la base (listar_movimientos, receta 50): búsqueda inteligente,
 * depósito / sucursal, documento y, con un producto, el saldo después de cada movimiento.
 * Devuelve null si la función no está en este schema (usar consultaMovimientos).
 */
export async function listarMovimientosRpc(
  db: TenantDb,
  f: FiltrosMov,
  pag: { limit: number; offset: number; total?: boolean },
): Promise<{ rows: unknown[]; total: number } | null> {
  const o = origenes(f);
  const { data, error } = await db.rpc<{ rows: unknown[] | null; total: number | null }>("listar_movimientos", {
    p_q: f.q || null,
    p_tipo: TIPOS_MOV.includes(f.tipo) ? f.tipo : null,
    p_origen: o.length ? o.join(",") : null,
    p_producto: UUID.test(f.producto) ? f.producto : null,
    p_desde: RE_FECHA.test(f.desde) ? f.desde : null,
    p_hasta: RE_FECHA.test(f.hasta) ? f.hasta : null,
    p_limit: pag.limit,
    p_offset: pag.offset,
    p_total: pag.total ?? true,
    p_deposito: UUID.test(f.deposito) ? f.deposito : null,
    p_sucursal: UUID.test(f.sucursal) ? f.sucursal : null,
  });
  if (error) {
    if (faltaFuncion(error)) return null;
    throw new Error("db");
  }
  return { rows: data?.rows ?? [], total: Number(data?.total) || 0 };
}
