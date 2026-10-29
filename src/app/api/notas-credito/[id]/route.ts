/**
 * GET /api/notas-credito/[id] → detalle de una nota de crédito (receta 99): venta, cliente,
 * productos (si volvieron al stock), a dónde fue la plata (deuda, caja, saldo a favor).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";
import { falloRpc } from "@/modules/inventario/server/rpc";

export const GET = withTenant(async (ctx, req) => {
  const id = idDeRuta(req.url, "notas-credito");
  if (!UUID_RE.test(id ?? "")) return idInvalido("nota de crédito");
  const { data, error } = await ctx.db.rpc("nota_credito_detalle", { p_id: id });
  if (error) return /no encontrada/i.test(error.message) ? fail("Nota de crédito no encontrada", 404) : falloRpc(error);
  return ok(data);
});
