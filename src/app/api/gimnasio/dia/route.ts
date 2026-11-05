/** Recepción del gimnasio (receta 150): GET /api/gimnasio/dia?fecha=AAAA-MM-DD → clases del día con sus alumnos y las entradas libres. */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloGim } from "@/modules/gimnasio/server";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const f = new URL(req.url).searchParams.get("fecha");
  const fecha = f && /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : null;
  const { data, error } = await ctx.db.rpc("gim_dia", { p_fecha: fecha });
  if (error) return falloGim(error, "No se pudieron leer las clases del día");
  return ok(data);
}, { permiso: "gimnasio_recepcion" });