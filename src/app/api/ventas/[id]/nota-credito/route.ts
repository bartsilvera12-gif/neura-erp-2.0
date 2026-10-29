/**
 * GET /api/ventas/[id]/nota-credito → lo que hace falta para la nota de crédito de una venta
 * (receta 99, nota_credito_previa): cuánto queda por devolver de cada línea, lo ya acreditado,
 * la deuda de la venta, el saldo a favor del cliente, la caja abierta y las notas que ya tiene.
 * No mueve nada.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";
import { falloRpc } from "@/modules/inventario/server/rpc";

export const GET = withTenant(async (ctx, req) => {
  const id = idDeRuta(req.url, "ventas");
  if (!UUID_RE.test(id ?? "")) return idInvalido("venta");
  const { data, error } = await ctx.db.rpc("nota_credito_previa", { p_venta: id });
  if (error) return /no encontrada/i.test(error.message) ? fail("Venta no encontrada", 404) : falloRpc(error);
  return ok(data);
});
