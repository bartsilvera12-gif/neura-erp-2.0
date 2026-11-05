/**
 * El link personal del alumno (recetas 155 y 156): con él reserva, cancela y marca su asistencia solo.
 *   POST /api/gimnasio/clientes/<id>/link {}                → { token, nombre, telefono } (lo crea la primera vez)
 *   POST /api/gimnasio/clientes/<id>/link { rehacer: true } → link nuevo; el viejo deja de andar
 *   POST /api/gimnasio/clientes/<id>/link { enviado: true } → además anota que se le mandó (WhatsApp o Copiar)
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { falloGim, idDe } from "@/modules/gimnasio/server";

export const POST = withTenant(async (ctx, req) => {
  const id = idDe(req, "clientes");
  if (!id) return fail("Cliente inválido", 400);
  const b = (await req.json().catch(() => null)) as { rehacer?: unknown; enviado?: unknown } | null;
  const { data, error } = await ctx.db.rpc("gim_alumno_link", { p_cliente: id, p_rehacer: b?.rehacer === true });
  if (error) return falloGim(error, "No se pudo crear el link del alumno");
  if (b?.enviado === true) {
    const r = await ctx.db.rpc("gim_alumno_link_enviado", { p_cliente: id });
    if (r.error) return falloGim(r.error, "No se pudo anotar el envío");
  }
  return ok(data);
}, { permiso: "gimnasio_recepcion" });
