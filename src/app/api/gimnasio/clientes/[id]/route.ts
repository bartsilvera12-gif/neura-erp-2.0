/** Asistencia de un alumno (receta 150): GET /api/gimnasio/clientes/<id> → deuda, membresía, próximas clases e historial. */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { falloGim, idDe } from "@/modules/gimnasio/server";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const id = idDe(req, "clientes");
  if (!id) return fail("Cliente inválido", 400);
  const { data, error } = await ctx.db.rpc("gim_cliente", { p_cliente: id });
  if (error) return falloGim(error, "No se pudo leer la asistencia del alumno");
  return ok(data);
}, { permiso: "gimnasio_recepcion" });