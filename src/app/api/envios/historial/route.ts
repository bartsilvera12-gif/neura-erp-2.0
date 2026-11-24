/**
 * Línea de tiempo de un envío (receta 174): cambios de estado con quién y cuándo.
 *   GET /api/envios/historial?id=<uuid> → [{ estado_nombre, usuario_nombre, at }]
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { falloRpc, uuidONull } from "@/modules/inventario/server/rpc";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const id = uuidONull(new URL(req.url).searchParams.get("id"));
  if (!id) return fail("Falta el envío");
  const { data, error } = await ctx.db.rpc("envio_historial", { p_envio: id });
  if (error) return falloRpc(error);
  return ok(data ?? []);
}, { permiso: "envios_operar" });
