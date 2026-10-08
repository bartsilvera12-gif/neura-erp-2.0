/**
 * Productos en lote (lado servidor): el mismo detalle que GET /api/productos/[id] y el
 * mismo historial de costos que GET /api/productos/[id]/costos, para varios productos en
 * UN request (alta de compra/orden, corregir costos). Solo servidor.
 */
import type { TenantDb } from "@/lib/api/tenant-db";

/** Columnas del detalle de un producto (GET /api/productos/[id] y /api/productos/lote). */
export const COLS_PRODUCTO_DETALLE =
  "id, nombre, sku, costo_promedio, precio_venta, precio_mayorista, precio_distribuidor, descuento_pct, stock_actual, stock_minimo, unidad_medida, tipo_iva, tipo_producto, controla_stock, es_vendible, activo, imagen_url, descripcion, codigo_barras, categoria_principal_id, proveedor_principal_id";

/** Tope de ids por request (la URL hacia la base no puede crecer sin límite). */
export const LOTE_MAX_IDS = 200;
/** historial_costos_producto es una función por producto: de a tantas en paralelo. */
const RPC_EN_PARALELO = 8;

/** Detalle de los productos pedidos (los que no existen o son de otra empresa no vienen). */
export async function productosPorIds(db: TenantDb, ids: string[]) {
  if (!ids.length) return [];
  const { data, error } = await db.select("productos", COLS_PRODUCTO_DETALLE).in("id", ids).limit(ids.length);
  if (error) throw new Error("db");
  return (data ?? []) as unknown as Record<string, unknown>[];
}

/**
 * Historial de costos de cada producto, por id (null si la función falló para ese).
 * `limite` = cuántas compras traer de cada uno (por defecto, el de la función: 100).
 */
export async function costosPorIds(db: TenantDb, ids: string[], limite?: number) {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < ids.length; i += RPC_EN_PARALELO) {
    const tanda = ids.slice(i, i + RPC_EN_PARALELO);
    const res = await Promise.all(
      tanda.map((id) =>
        db.rpc("historial_costos_producto", limite ? { p_producto_id: id, p_limit: limite } : { p_producto_id: id }),
      ),
    );
    tanda.forEach((id, n) => { out[id] = res[n].error ? null : res[n].data; });
  }
  return out;
}
