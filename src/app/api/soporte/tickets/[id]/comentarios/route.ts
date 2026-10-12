/**
 * Comentarios del ticket (la conversación humana; el historial es la auditoría).
 *   GET  /api/soporte/tickets/[id]/comentarios → en orden cronológico, con autor y adjuntos
 *   POST /api/soporte/tickets/[id]/comentarios { contenido } → { id, created_at }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created } from "@/lib/api/responses";
import {
  accesoSoporte,
  cuerpo,
  falla,
  idTras,
  personasPorId,
  registrarHistorial,
  sinAccesoSoporte,
  ticketDeEmpresa,
  tocarTicket,
} from "@/modules/soporte/server";

type Com = { id: string; usuario_id: string | null; contenido: string; es_rechazo_qa: boolean; created_at: string };

export const GET = withTenant(async (ctx, req) => {
  if (!(await accesoSoporte(ctx))) return sinAccesoSoporte();
  const id = idTras(req, "tickets");
  if (!id || !(await ticketDeEmpresa(ctx, id, "id"))) return falla("Ticket no encontrado", 404);

  const { data, error } = await ctx.db
    .select("soporte_ticket_comentarios", "id, usuario_id, contenido, es_rechazo_qa, created_at")
    .eq("ticket_id", id)
    .is("subtarea_id", null)
    .order("created_at", { ascending: true });
  if (error) return falla("No se pudieron cargar los comentarios", 500);
  const lista = (data ?? []) as unknown as Com[];
  const personas = await personasPorId(ctx, lista.map((c) => c.usuario_id));

  const adjuntos = new Map<string, { id: string; nombre: string }[]>();
  if (lista.length) {
    const { data: arch } = await ctx.db
      .select("soporte_ticket_archivos", "id, nombre, comentario_id")
      .eq("ticket_id", id)
      .is("deleted_at", null)
      .in("comentario_id", lista.map((c) => c.id));
    for (const a of (arch ?? []) as unknown as { id: string; nombre: string; comentario_id: string }[]) {
      adjuntos.set(a.comentario_id, [...(adjuntos.get(a.comentario_id) ?? []), { id: a.id, nombre: a.nombre }]);
    }
  }
  return ok(lista.map((c) => ({ ...c, autor: c.usuario_id ? (personas.get(c.usuario_id) ?? null) : null, adjuntos: adjuntos.get(c.id) ?? [] })));
});

export const POST = withTenant(async (ctx, req) => {
  if (!(await accesoSoporte(ctx))) return sinAccesoSoporte();
  const id = idTras(req, "tickets");
  if (!id || !(await ticketDeEmpresa(ctx, id, "id"))) return falla("Ticket no encontrado", 404);
  const body = await cuerpo(req);
  const contenido = typeof body?.contenido === "string" ? body.contenido.trim().slice(0, 20_000) : "";
  if (!contenido) return falla("Escribí el comentario");

  const { data, error } = await ctx.db.insert("soporte_ticket_comentarios", { ticket_id: id, usuario_id: ctx.usuarioId, contenido });
  const fila = data?.[0] as { id: string; created_at: string } | undefined;
  if (error || !fila) return falla("No se pudo comentar");
  await registrarHistorial(ctx, id, [{ tipo_evento: "comentario", metadata: { comentario_id: fila.id } }]);
  await tocarTicket(ctx, id);
  return created({ id: fila.id, created_at: fila.created_at });
});
