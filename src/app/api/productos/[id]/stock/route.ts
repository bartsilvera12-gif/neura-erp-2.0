/**
 * Stock de un producto por depósito (ficha del producto).
 *   GET /api/productos/[id]/stock → { stock_total, en_transito, controla_lotes, hoy,
 *        depositos: [{ deposito_id, deposito, sucursal, cantidad, en_lotes, sin_lote, lotes[] }] }
 * (stock_producto, receta 50).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";

export const GET = withTenant(async (ctx, req) => {
  const id = idDeRuta(req.url, "productos");
  if (!UUID_RE.test(id ?? "")) return idInvalido("producto");
  const { data, error } = await ctx.db.rpc("stock_producto", { p_producto_id: id });
  if (error) return /no encontrado/i.test(error.message) ? ERR.notFound("producto") : ERR.server();
  return ok(data);
});
