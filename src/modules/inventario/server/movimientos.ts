/**
 * Consulta del kardex (movimientos_inventario) con filtros — compartida por el listado
 * paginado y la exportación a Excel. Solo servidor.
 */
import type { TenantDb } from "@/lib/api/tenant-db";
import { condicionGrupo } from "@/lib/api/busqueda-servidor";

export const COLS_MOV =
  "id, producto_id, producto_nombre, producto_sku, tipo, cantidad, costo_unitario, origen, referencia, usuario_nombre, fecha";
export const TIPOS_MOV = ["ENTRADA", "SALIDA"];
export const ORIGENES_MOV = ["inventario_inicial", "ajuste_manual", "venta", "anulacion_venta", "compra"];
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const limpio = (t: string) => t.replace(/[,()"\\*:]/g, "").trim();

export type FiltrosMov = { q: string; tipo: string; origen: string; desde: string; hasta: string; producto: string };

export function filtrosDeUrl(sp: URLSearchParams): FiltrosMov {
  return {
    q: limpio(sp.get("q") ?? ""),
    tipo: sp.get("tipo") ?? "",
    origen: sp.get("origen") ?? "",
    desde: sp.get("desde") ?? "",
    hasta: sp.get("hasta") ?? "",
    producto: sp.get("producto") ?? "",
  };
}

/**
 * Arma la consulta filtrada (más reciente primero). `grupos` = variantesBusqueda(f.q):
 * búsqueda inteligente sobre la columna `busqueda` (producto, SKU, referencia, usuario).
 */
export function consultaMovimientos(db: TenantDb, f: FiltrosMov, opts?: { count?: "exact" }, grupos: string[][] = []) {
  let q = db.select("movimientos_inventario", COLS_MOV, opts);
  if (TIPOS_MOV.includes(f.tipo)) q = q.eq("tipo", f.tipo);
  if (ORIGENES_MOV.includes(f.origen)) q = q.eq("origen", f.origen);
  if (/^[0-9a-f-]{36}$/i.test(f.producto)) q = q.eq("producto_id", f.producto);
  // Fechas en hora de Paraguay (UTC-3).
  if (RE_FECHA.test(f.desde)) q = q.gte("fecha", `${f.desde}T00:00:00-03:00`);
  if (RE_FECHA.test(f.hasta)) q = q.lte("fecha", `${f.hasta}T23:59:59.999-03:00`);
  // Cada palabra (o una variante por error de tipeo) tiene que aparecer, en cualquier orden.
  for (const g of grupos) q = q.or(condicionGrupo(g));
  return q.order("fecha", { ascending: false }).order("id", { ascending: false });
}
