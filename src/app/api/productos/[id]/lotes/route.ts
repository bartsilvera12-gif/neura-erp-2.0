/**
 * Lotes de un producto (ficha del producto, sección "Lotes").
 *   GET /api/productos/[id]/lotes → { controla_lotes, stock_actual, en_lotes, sin_lote, hoy, lotes[] }
 * Solo los lotes con unidades, el que vence primero arriba (lotes_producto, receta 44_lotes.sql).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";

export const GET = withTenant(async (ctx, req) => {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segs[segs.indexOf("productos") + 1];
  if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id del producto");
  const { data, error } = await ctx.db.rpc("lotes_producto", { p_producto_id: id });
  if (error) return ERR.server();
  return ok(data);
});
