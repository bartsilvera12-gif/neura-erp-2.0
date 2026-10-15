/**
 * Un ajuste o pérdida: GET /api/inventario/ajustes/[id] → cabecera, depósito e ítems (ajuste_detalle).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";
import { falloRpc } from "@/modules/inventario/server/rpc";

export const GET = withTenant(async (ctx, req) => {
  const id = idDeRuta(req.url, "ajustes");
  if (!UUID_RE.test(id ?? "")) return idInvalido("documento");
  const { data, error } = await ctx.db.rpc("ajuste_detalle", { p_id: id });
  if (error) return /no encontrado/i.test(error.message) ? fail("Documento no encontrado", 404) : falloRpc(error);
  return ok(data);
});
