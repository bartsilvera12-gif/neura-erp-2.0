/** GET /api/soporte/tickets/[id]/subtareas — revisiones de QA del ticket, cada una con su conversación. */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import {
  SUBTAREA_CAMPOS,
  accesoSoporte,
  falla,
  idTras,
  personasPorId,
  sinAccesoSoporte,
  ticketDeEmpresa,
  type SubtareaFila,
} from "@/modules/soporte/server";

type Com = { id: string; subtarea_id: string; usuario_id: string | null; contenido: string; es_rechazo_qa: boolean; created_at: string };

export const GET = withTenant(async (ctx, req) => {
  if (!(await accesoSoporte(ctx))) return sinAccesoSoporte();
  const id = idTras(req, "tickets");
  if (!id || !(await ticketDeEmpresa(ctx, id, "id"))) return falla("Ticket no encontrado", 404);

  const [subs, coms] = await Promise.all([
    ctx.db.select("soporte_subtareas", SUBTAREA_CAMPOS).eq("ticket_id", id).order("numero"),
    ctx.db
      .select("soporte_ticket_comentarios", "id, subtarea_id, usuario_id, contenido, es_rechazo_qa, created_at")
      .eq("ticket_id", id)
      .not("subtarea_id", "is", null)
      .order("created_at", { ascending: true }),
  ]);
  if (subs.error) return falla("No se pudieron cargar las subtareas", 500);
  const lista = (subs.data ?? []) as unknown as SubtareaFila[];
  const comentarios = (coms.data ?? []) as unknown as Com[];
  const personas = await personasPorId(ctx, [...lista.map((s) => s.asignado_id), ...comentarios.map((c) => c.usuario_id)]);

  const adjuntos = new Map<string, { id: string; nombre: string }[]>();
  if (comentarios.length) {
    const { data: arch } = await ctx.db
      .select("soporte_ticket_archivos", "id, nombre, comentario_id")
      .eq("ticket_id", id)
      .is("deleted_at", null)
      .in("comentario_id", comentarios.map((c) => c.id));
    for (const a of (arch ?? []) as unknown as { id: string; nombre: string; comentario_id: string }[]) {
      adjuntos.set(a.comentario_id, [...(adjuntos.get(a.comentario_id) ?? []), { id: a.id, nombre: a.nombre }]);
    }
  }

  return ok(
    lista.map((s) => ({
      ...s,
      asignado: s.asignado_id ? (personas.get(s.asignado_id) ?? null) : null,
      comentarios: comentarios
        .filter((c) => c.subtarea_id === s.id)
        .map((c) => ({ ...c, autor: c.usuario_id ? (personas.get(c.usuario_id) ?? null) : null, adjuntos: adjuntos.get(c.id) ?? [] })),
    })),
  );
});
