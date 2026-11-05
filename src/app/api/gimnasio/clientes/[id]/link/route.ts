/**
 * El link personal del alumno (receta 155): con él reserva, cancela y marca su asistencia solo.
 *   POST /api/gimnasio/clientes/<id>/link {}                → { token, nombre, telefono } (lo crea la primera vez)
 *   POST /api/gimnasio/clientes/<id>/link { rehacer: true } → link nuevo; el viejo deja de andar
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { falloGim, idDe } from "@/modules/gimnasio/server";

export const POST = withTenant(async (ctx, req) => {
  const id = idDe(req, "clientes");
  if (!id) return fail("Cliente inválido", 400);
  const b = (await req.json().catch(() => null)) as { rehacer?: unknown } | null;
  const { data, error } = await ctx.db.rpc("gim_alumno_link", { p_cliente: id, p_rehacer: b?.rehacer === true });
  if (error) return falloGim(error, "No se pudo crear el link del alumno");
  return ok(data);
}, { permiso: "gimnasio_recepcion" });
