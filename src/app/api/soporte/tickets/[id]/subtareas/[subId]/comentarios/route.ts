/** POST /api/soporte/tickets/[id]/subtareas/[subId]/comentarios { contenido } — comentario dentro de una revisión de QA. */
import { withTenant } from "@/lib/api/with-tenant";
import { created } from "@/lib/api/responses";
import { accesoSoporte, cuerpo, falla, idTras, sinAccesoSoporte, tocarTicket } from "@/modules/soporte/server";

export const POST = withTenant(async (ctx, req) => {
  if (!(await accesoSoporte(ctx))) return sinAccesoSoporte();
  const id = idTras(req, "tickets");
  const subId = idTras(req, "subtareas");
  if (!id || !subId) return falla("Subtarea no encontrada", 404);
  const { data: sub } = await ctx.db.select("soporte_subtareas", "id").eq("ticket_id", id).eq("id", subId).maybeSingle();
  if (!sub) return falla("Subtarea no encontrada", 404);

  const body = await cuerpo(req);
  const contenido = typeof body?.contenido === "string" ? body.contenido.trim().slice(0, 20_000) : "";
  if (!contenido) return falla("Escribí el comentario");

  const { data, error } = await ctx.db.insert("soporte_ticket_comentarios", { ticket_id: id, subtarea_id: subId, usuario_id: ctx.usuarioId, contenido });
  const fila = data?.[0] as { id: string; created_at: string } | undefined;
  if (error || !fila) return falla("No se pudo comentar");
  await tocarTicket(ctx, id);
  return created({ id: fila.id, created_at: fila.created_at });
});
