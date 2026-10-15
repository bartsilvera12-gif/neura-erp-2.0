/**
 * Un traslado: GET /api/inventario/traslados/[id] → cabecera, origen/destino, ítems con sus
 * lotes, puede_recibir / puede_anular (traslado_detalle).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";
import { falloRpc } from "@/modules/inventario/server/rpc";

export const GET = withTenant(async (ctx, req) => {
  const id = idDeRuta(req.url, "traslados");
  if (!UUID_RE.test(id ?? "")) return idInvalido("traslado");
  const { data, error } = await ctx.db.rpc("traslado_detalle", { p_id: id });
  if (error) return /no encontrado/i.test(error.message) ? fail("Traslado no encontrado", 404) : falloRpc(error);
  return ok(data);
});
