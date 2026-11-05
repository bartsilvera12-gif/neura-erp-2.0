/** GET /api/gimnasio/comisiones?desde=&hasta= → comisión de cada profesor en el período (receta 150, gimnasio_administrar). */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { falloGim } from "@/modules/gimnasio/server";

export const dynamic = "force-dynamic";
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export const GET = withTenant(async (ctx, req) => {
  const u = new URL(req.url).searchParams;
  const desde = u.get("desde"), hasta = u.get("hasta");
  if (!desde || !hasta || !FECHA.test(desde) || !FECHA.test(hasta)) return fail("Elegí el período", 400);
  const { data, error } = await ctx.db.rpc("gim_comisiones", { p_desde: desde, p_hasta: hasta });
  if (error) return falloGim(error, "No se pudieron calcular las comisiones");
  return ok(data);
}, { permiso: "gimnasio_administrar" });