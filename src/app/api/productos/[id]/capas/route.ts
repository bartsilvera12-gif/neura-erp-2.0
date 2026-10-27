/**
 * Costo por compra (capas de costo PEPS) de un producto — ficha del producto.
 *   GET /api/productos/[id]/capas[?agotadas=1] → { resumen, depositos[], capas[], agotadas, … }
 * Cada capa: fecha, origen (compra / stock inicial / ajuste / traslado / lote), depósito, costo,
 * compradas, quedan y valor (capas_producto, receta 79). Pide "ver costos" (lo valida la base).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { UUID_RE, idDeRuta, idInvalido, faltaFuncion } from "@/modules/inventario/server/ids";
import { falloRpc } from "@/modules/inventario/server/rpc";

export const GET = withTenant(async (ctx, req) => {
  const id = idDeRuta(req.url, "productos");
  if (!UUID_RE.test(id ?? "")) return idInvalido("producto");
  const agotadas = new URL(req.url).searchParams.get("agotadas") === "1";
  const { data, error } = await ctx.db.rpc("capas_producto", { p_producto_id: id, p_agotadas: agotadas });
  if (error) {
    if (faltaFuncion(error)) return ERR.server();
    if (/no encontrado/i.test(error.message)) return ERR.notFound("producto");
    return falloRpc(error);
  }
  return ok(data);
});
