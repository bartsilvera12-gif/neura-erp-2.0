/**
 * Historial de costos de compra de un producto (ficha del producto).
 *   GET /api/productos/[id]/costos → { costo_promedio, total_compras, compras[] }
 * Cada compra: fecha, cantidad, costo c/u, proveedor, factura y variación contra la
 * compra anterior (historial_costos_producto, receta 20_historial_costos.sql).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";

export const GET = withTenant(async (ctx, req) => {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segs[segs.indexOf("productos") + 1];
  if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id del producto");
  const { data, error } = await ctx.db.rpc("historial_costos_producto", { p_producto_id: id });
  if (error) return ERR.server();
  return ok(data);
});
