/**
 * Relaciones entre tickets (en las dos direcciones: si A está relacionado con B,
 * B muestra a A sin cargarlo dos veces).
 *   GET    /api/soporte/tickets/[id]/relaciones
 *   POST   /api/soporte/tickets/[id]/relaciones { numero, tipo? } → vincula por número
 *   DELETE /api/soporte/tickets/[id]/relaciones?relacion_id=… → quita el vínculo
 * Agregar o quitar queda en el historial de los DOS tickets.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created } from "@/lib/api/responses";
import { TIPOS_RELACION, numeroTicket } from "@/modules/soporte/dominio";
import {
  accesoSoporte,
  clientesPorId,
  cuerpo,
  esUuid,
  falla,
  idTras,
  leerCatalogos,
  registrarHistorial,
  sinAccesoSoporte,
  ticketDeEmpresa,
} from "@/modules/soporte/server";

type Relacion = { id: string; ticket_id: string; relacionado_id: string; tipo: string; created_at: string };
type Resumen = { id: string; numero: number; asunto: string; estado_codigo: string; cliente_id: string | null };

export const GET = withTenant(async (ctx, req) => {
  if (!(await accesoSoporte(ctx))) return sinAccesoSoporte();
  const id = idTras(req, "tickets");
  if (!id || !(await ticketDeEmpresa(ctx, id, "id"))) return falla("Ticket no encontrado", 404);

  const { data, error } = await ctx.db
    .select("soporte_ticket_relaciones", "id, ticket_id, relacionado_id, tipo, created_at")
    .or(`ticket_id.eq.${id},relacionado_id.eq.${id}`)
    .order("created_at", { ascending: true });
  if (error) return falla("No se pudieron cargar las relaciones", 500);
  const rel = (data ?? []) as unknown as Relacion[];
  const otros = rel.map((r) => (r.ticket_id === id ? r.relacionado_id : r.ticket_id));
  let resumenes: Resumen[] = [];
  if (otros.length) {
    const { data: tk } = await ctx.db.select("soporte_tickets", "id, numero, asunto, estado_codigo, cliente_id").in("id", otros);
    resumenes = (tk ?? []) as unknown as Resumen[];
  }
  const [cat, clientes] = await Promise.all([leerCatalogos(ctx), clientesPorId(ctx, resumenes.map((t) => t.cliente_id))]);

  return ok(
    rel
      .map((r) => {
        const otroId = r.ticket_id === id ? r.relacionado_id : r.ticket_id;
        const t = resumenes.find((x) => x.id === otroId);
        if (!t) return null;
        const estado = cat.estados.find((e) => e.codigo === t.estado_codigo);
        return {
          id: r.id,
          tipo: r.tipo,
          tipo_nombre: TIPOS_RELACION.find((x) => x.codigo === r.tipo)?.nombre ?? r.tipo,
          inversa: r.ticket_id !== id,
          created_at: r.created_at,
          ticket: {
            id: t.id,
            numero: t.numero,
            asunto: t.asunto,
            estado_nombre: estado?.nombre ?? t.estado_codigo,
            estado_color: estado?.color ?? "#94a3b8",
            cliente_nombre: t.cliente_id ? (clientes.get(t.cliente_id) ?? null) : null,
          },
        };
      })
      .filter(Boolean),
  );
});

export const POST = withTenant(async (ctx, req) => {
  if (!(await accesoSoporte(ctx))) return sinAccesoSoporte();
  const id = idTras(req, "tickets");
  const origen = id ? await ticketDeEmpresa<{ id: string; numero: number }>(ctx, id, "id, numero") : null;
  if (!id || !origen) return falla("Ticket no encontrado", 404);

  const body = await cuerpo(req);
  const numero = Number(String(body?.numero ?? "").replace(/^#/, ""));
  if (!Number.isInteger(numero) || numero <= 0) return falla("Indicá el número del ticket");
  const tipo = typeof body?.tipo === "string" ? body.tipo : "relacionado";
  if (!TIPOS_RELACION.some((t) => t.codigo === tipo)) return falla("Tipo de relación inválido");

  const { data: destino } = await ctx.db.select("soporte_tickets", "id, numero").eq("numero", numero).maybeSingle();
  const dst = destino as unknown as { id: string; numero: number } | null;
  if (!dst) return falla(`No existe el ticket ${numeroTicket(numero)}`);
  if (dst.id === id) return falla("Un ticket no puede relacionarse consigo mismo");

  const { data: existe } = await ctx.db
    .select("soporte_ticket_relaciones", "id")
    .eq("tipo", tipo)
    .or(`and(ticket_id.eq.${id},relacionado_id.eq.${dst.id}),and(ticket_id.eq.${dst.id},relacionado_id.eq.${id})`)
    .limit(1);
  if ((existe ?? []).length) return falla(`Ya está vinculado con ${numeroTicket(numero)}`);

  const { data, error } = await ctx.db.insert("soporte_ticket_relaciones", { ticket_id: id, relacionado_id: dst.id, tipo, created_by: ctx.usuarioId });
  const fila = data?.[0] as { id: string } | undefined;
  if (error || !fila) return falla("No se pudo vincular");

  await registrarHistorial(ctx, id, [{ tipo_evento: "relacion_agregada", valor_nuevo: numeroTicket(dst.numero), metadata: { tipo, relacion_id: fila.id } }]);
  await registrarHistorial(ctx, dst.id, [
    { tipo_evento: "relacion_agregada", valor_nuevo: numeroTicket(origen.numero), metadata: { tipo, relacion_id: fila.id, inversa: true } },
  ]);
  return created({ id: fila.id });
});

export const DELETE = withTenant(async (ctx, req) => {
  if (!(await accesoSoporte(ctx))) return sinAccesoSoporte();
  const id = idTras(req, "tickets");
  const relacionId = new URL(req.url).searchParams.get("relacion_id");
  if (!id || !esUuid(relacionId)) return falla("Relación no encontrada", 404);

  const { data } = await ctx.db.select("soporte_ticket_relaciones", "id, ticket_id, relacionado_id, tipo").eq("id", relacionId).maybeSingle();
  const rel = data as unknown as Relacion | null;
  if (!rel || (rel.ticket_id !== id && rel.relacionado_id !== id)) return falla("Relación no encontrada", 404);

  const { error } = await ctx.db.delete("soporte_ticket_relaciones").eq("id", rel.id);
  if (error) return falla("No se pudo quitar el vínculo");

  const { data: nums } = await ctx.db.select("soporte_tickets", "id, numero").in("id", [rel.ticket_id, rel.relacionado_id]);
  const num = (tid: string) => numeroTicket(((nums ?? []) as unknown as { id: string; numero: number }[]).find((x) => x.id === tid)?.numero);
  for (const [tk, otro] of [
    [rel.ticket_id, rel.relacionado_id],
    [rel.relacionado_id, rel.ticket_id],
  ]) {
    await registrarHistorial(ctx, tk, [{ tipo_evento: "relacion_eliminada", valor_anterior: num(otro), metadata: { tipo: rel.tipo } }]);
  }
  return ok({ eliminada: true });
});
