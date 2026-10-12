/**
 * PATCH /api/soporte/tickets/[id]/subtareas/[subId] { estado, comentario? }
 * Cambia el estado de una revisión de QA (ciclo del sistema actual):
 *
 *   · "Cambios solicitados": si el ticket está en "Listo para revisión" vuelve a
 *     "En proceso" en la fase siguiente (Fase 2, 3, …) y se avisa al responsable.
 *     El comentario (si viene) queda marcado como rechazo de QA.
 *   · "Finalizado": si no queda otra revisión abierta, el ticket pasa de "Listo
 *     para revisión" a "Resuelto" y se avisa al responsable (y a quien lo cargó).
 *
 * El cambio se aplica sólo si la subtarea sigue en el estado leído: dos personas
 * no pueden cerrar la misma revisión de dos formas distintas.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { ESTADOS_SUBTAREA, TRANSICIONES_SUBTAREA, nombreEstadoSubtarea, numeroTicket, type EstadoSubtarea } from "@/modules/soporte/dominio";
import {
  SUBTAREA_CAMPOS,
  accesoSoporte,
  avisarEstadoACreador,
  cuerpo,
  falla,
  idTras,
  notificar,
  registrarHistorial,
  sinAccesoSoporte,
  subtareasSinFinalizar,
  ticketDeEmpresa,
  type EventoHistorial,
  type SubtareaFila,
} from "@/modules/soporte/server";

type TicketMin = { id: string; numero: number; asunto: string; estado_codigo: string; responsable_id: string | null; fase: number | null; created_by: string | null; cliente_id: string | null };

export const PATCH = withTenant(async (ctx, req) => {
  if (!(await accesoSoporte(ctx))) return sinAccesoSoporte();
  const id = idTras(req, "tickets");
  const subId = idTras(req, "subtareas");
  if (!id || !subId) return falla("Subtarea no encontrada", 404);

  const [ticket, { data: subData }] = await Promise.all([
    ticketDeEmpresa<TicketMin>(ctx, id, "id, numero, asunto, estado_codigo, responsable_id, fase, created_by, cliente_id"),
    ctx.db.select("soporte_subtareas", SUBTAREA_CAMPOS).eq("ticket_id", id).eq("id", subId).maybeSingle(),
  ]);
  const sub = subData as unknown as SubtareaFila | null;
  if (!ticket || !sub) return falla("Subtarea no encontrada", 404);

  const body = await cuerpo(req);
  const hacia = ESTADOS_SUBTAREA.find((e) => e.codigo === body?.estado)?.codigo;
  if (!hacia) return falla("Estado inválido");
  const desde = sub.estado as EstadoSubtarea;
  if (hacia === desde) return ok({ sin_cambios: true });
  if (!(TRANSICIONES_SUBTAREA[desde] ?? []).includes(hacia)) {
    return falla(`No se puede pasar de "${nombreEstadoSubtarea(desde)}" a "${nombreEstadoSubtarea(hacia)}"`);
  }
  const comentario = typeof body?.comentario === "string" ? body.comentario.trim().slice(0, 20_000) : "";

  const ahora = new Date().toISOString();
  const { data: actualizada, error } = await ctx.db
    .update("soporte_subtareas", { estado: hacia, updated_at: ahora, finalizado_at: hacia === "finalizado" ? ahora : null })
    .eq("id", subId)
    .eq("estado", desde)
    .select("id")
    .maybeSingle();
  if (error) return falla("No se pudo cambiar el estado");
  if (!actualizada) return falla("La subtarea cambió mientras tanto. Recargá y volvé a intentar.", 409);

  const eventos: EventoHistorial[] = [
    { tipo_evento: "subtarea_estado", valor_anterior: desde, valor_nuevo: hacia, metadata: { subtarea_id: sub.id, titulo: sub.titulo } },
  ];

  let comentarioId: string | null = null;
  if (comentario) {
    const { data: com } = await ctx.db.insert("soporte_ticket_comentarios", {
      ticket_id: id,
      subtarea_id: subId,
      usuario_id: ctx.usuarioId,
      contenido: comentario,
      es_rechazo_qa: hacia === "cambios_solicitados",
    });
    comentarioId = (com?.[0] as { id?: string } | undefined)?.id ?? null;
    eventos.push({ tipo_evento: "comentario", metadata: { comentario_id: comentarioId, subtarea_id: sub.id, rechazo_qa: hacia === "cambios_solicitados" } });
  }

  // QA pidió cambios: el ticket vuelve a En proceso y arranca una fase nueva.
  let ticketReabierto = false;
  const faseNueva = (ticket.fase ?? 1) + 1;
  if (hacia === "cambios_solicitados" && ticket.estado_codigo === "listo_revision") {
    const { data: t } = await ctx.db
      .update("soporte_tickets", { estado_codigo: "en_proceso", fase: faseNueva, resuelto_at: null, cerrado_at: null, updated_at: ahora, updated_by: ctx.usuarioId })
      .eq("id", id)
      .eq("estado_codigo", "listo_revision")
      .select("id")
      .maybeSingle();
    if (t) {
      ticketReabierto = true;
      eventos.push({ tipo_evento: "devolucion_qa", valor_anterior: "listo_revision", valor_nuevo: "en_proceso", metadata: { subtarea_id: sub.id, fase: faseNueva } });
    }
  }

  // QA aprobó: el ticket pasa solo a Resuelto.
  let ticketResuelto = false;
  if (hacia === "finalizado" && ticket.estado_codigo === "listo_revision" && (await subtareasSinFinalizar(ctx, id)).length === 0) {
    const { data: t } = await ctx.db
      .update("soporte_tickets", { estado_codigo: "resuelto", resuelto_at: ahora, cerrado_at: null, updated_at: ahora, updated_by: ctx.usuarioId })
      .eq("id", id)
      .eq("estado_codigo", "listo_revision")
      .select("id")
      .maybeSingle();
    if (t) {
      ticketResuelto = true;
      eventos.push({ tipo_evento: "confirmacion_qa", valor_anterior: "listo_revision", valor_nuevo: "resuelto", metadata: { subtarea_id: sub.id } });
    }
  }

  if (!ticketReabierto && !ticketResuelto) {
    await ctx.db.update("soporte_tickets", { updated_at: ahora, updated_by: ctx.usuarioId }).eq("id", id);
  }
  await registrarHistorial(ctx, id, eventos);

  if (hacia === "cambios_solicitados") {
    await notificar(ctx, {
      usuarioId: ticket.responsable_id,
      titulo: ticketReabierto
        ? `QA pidió cambios en el ticket ${numeroTicket(ticket.numero)}: vuelve a En proceso (Fase ${faseNueva})`
        : `QA pidió cambios en el ticket ${numeroTicket(ticket.numero)}`,
      cuerpo: comentario || ticket.asunto,
      ticketId: id,
    });
  } else if (hacia === "finalizado") {
    await notificar(ctx, {
      usuarioId: ticket.responsable_id,
      titulo: ticketResuelto
        ? `QA aprobó el ticket ${numeroTicket(ticket.numero)}: pasó a Resuelto`
        : `QA finalizó la revisión del ticket ${numeroTicket(ticket.numero)}`,
      cuerpo: ticket.asunto,
      ticketId: id,
    });
  }
  if (ticketResuelto) await avisarEstadoACreador(ctx, ticket, "resuelto");

  return ok({ actualizado: true, ticket_reabierto: ticketReabierto, ticket_resuelto: ticketResuelto, comentario_id: comentarioId });
});
