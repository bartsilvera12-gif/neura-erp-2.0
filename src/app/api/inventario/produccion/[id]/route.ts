/**
 * GET /api/inventario/produccion/[id] → detalle de una producción (receta 97): producto,
 * depósito, planeado / obtenido / merma, materias primas que salieron (con lotes) y costos.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";
import { falloRpc } from "@/modules/inventario/server/rpc";

export const GET = withTenant(async (ctx, req) => {
  const id = idDeRuta(req.url, "produccion");
  if (!UUID_RE.test(id ?? "")) return idInvalido("producción");
  const { data, error } = await ctx.db.rpc("produccion_detalle", { p_id: id });
  if (error) return /no encontrada/i.test(error.message) ? fail("Producción no encontrada", 404) : falloRpc(error);
  return ok(data);
});
