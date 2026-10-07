/**
 * Ventas — listado para el dashboard de Caja (ÓRDENES DE VENTA).
 *   GET /api/ventas?caja=<id>  → ventas (de la caja indicada, o todas), con ítems embebidos
 *                                 para armar la columna "Productos" y el resumen de IVA.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";

const COLS =
  "id, numero_control, fecha, total, tipo_venta, estado, ventas_items(producto_nombre, sku, cantidad, tipo_iva)";

// PostgREST corta cada respuesta en PGRST_DB_MAX_ROWS (1000 en el servidor). Para
// devolver TODAS las ventas sin tope, se piden en tandas con .range() hasta agotar.
const TANDA = 1000;

export const GET = withTenant(async (ctx, req) => {
  const cajaId = new URL(req.url).searchParams.get("caja");
  const todas: unknown[] = [];
  for (let desde = 0; ; desde += TANDA) {
    let query = ctx.db
      .select("ventas", COLS)
      .order("fecha", { ascending: false })
      .order("id", { ascending: false }) // orden estable entre tandas
      .range(desde, desde + TANDA - 1);
    if (cajaId) query = query.eq("caja_id", cajaId);
    const { data, error } = await query;
    if (error) return ERR.server();
    const tanda = data ?? [];
    todas.push(...tanda);
    if (tanda.length < TANDA) break;
  }
  return ok(todas);
});
