/**
 * Finalizar una conversación con su tipificación.
 *   POST /api/conversaciones/[id]/finalizar { familia_id, estado_id, observacion, ticket?: { clasificacion_codigo },
 *        proxima_accion?: { fecha: "YYYY-MM-DD", nota } }
 *   · La próxima acción (opcional) aparece en Finalizadas › Seguimientos hasta "Marcar hecho".
 *   · Si el contacto tiene cliente vinculado → registra la tipificación del cliente (y el
 *     ticket de Soporte si el sub-estado es ticket_error / ticket_cambio).
 *   · Cierra la conversación (estado cerrada + cierre_*) y deja una nota interna en el hilo.
 *   → { fila, tipificacion_id, ticket }
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { registrarTipificacion } from "@/modules/tipificacion/registrar";
import { numeroTicket } from "@/modules/tipificacion/dominio";
import { hoyPY } from "@/lib/fecha/paraguay";
import { idConversacion, leerResumen } from "@/modules/conversaciones/server";

export const dynamic = "force-dynamic";

const cuerpo = z.object({
  familia_id: z.string().uuid("Elegí el estado"),
  estado_id: z.string().uuid("Elegí el sub-estado"),
  observacion: z.string().trim().min(1, "El comentario es obligatorio").max(5000),
  ticket: z.object({ clasificacion_codigo: z.string().max(80).nullish() }).nullish(),
  proxima_accion: z
    .object({
      fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de la próxima acción inválida"),
      nota: z.string().trim().max(1000, "Nota de la próxima acción: máximo 1000 caracteres").nullish(),
    })
    .nullish(),
});

const F_DIA = new Intl.DateTimeFormat("es-PY", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
const diaLegible = (iso: string) => F_DIA.format(new Date(`${iso}T00:00:00Z`));

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idConversacion(req);
    if (!id) return ERR.invalid("Conversación inválida");
    const conv = await leerResumen(ctx.db, id);
    if (!conv) return ERR.notFound("Conversación");
    if (conv.estado === "cerrada") return fail("La conversación ya está cerrada.", 409);

    const [famRes, subRes] = await Promise.all([
      ctx.db.select("tipificacion_familias", "id, nombre").eq("id", input.familia_id).limit(1),
      ctx.db.select("tipificacion_estados", "id, nombre, familia_id, comportamiento").eq("id", input.estado_id).limit(1),
    ]);
    const fam = (famRes.data?.[0] ?? null) as unknown as { id: string; nombre: string } | null;
    const sub = (subRes.data?.[0] ?? null) as unknown as { id: string; nombre: string; familia_id: string; comportamiento: string | null } | null;
    if (!fam) return fail("El estado no existe.");
    if (!sub || sub.familia_id !== fam.id) return fail("El sub-estado no corresponde al estado elegido.");
    const creaTicket = sub.comportamiento === "ticket_error" || sub.comportamiento === "ticket_cambio";
    if (creaTicket && !conv.cliente_id) {
      return fail("Ese sub-estado crea un ticket de Soporte: primero vinculá un cliente a este contacto (Ficha).");
    }
    const prox = input.proxima_accion ?? null;
    if (prox && prox.fecha < hoyPY()) return fail("La próxima acción no puede ser en el pasado.");

    let tipificacionId: string | null = null;
    let ticket: { id: string; numero: number } | null = null;
    if (conv.cliente_id) {
      const r = await registrarTipificacion(ctx, {
        clienteId: conv.cliente_id,
        estadoId: fam.id,
        subestadoId: sub.id,
        observacion: input.observacion,
        ticket: input.ticket ?? null,
      });
      if (!r.ok) return fail(r.mensaje, r.status);
      tipificacionId = r.tipificacion_id;
      ticket = r.ticket;
    }

    const ahora = new Date().toISOString();
    const { error } = await ctx.db
      .update("chat_conversaciones", {
        estado: "cerrada",
        cerrada_at: ahora,
        cerrada_por: ctx.usuarioId,
        cierre_familia_id: fam.id,
        cierre_estado_id: sub.id,
        cierre_observacion: input.observacion,
        // Cada cierre reemplaza el seguimiento anterior (pendiente o hecho).
        proxima_accion_fecha: prox?.fecha ?? null,
        proxima_accion_nota: prox?.nota?.trim() || null,
        seguimiento_hecho_at: null,
        seguimiento_hecho_por: null,
        updated_at: ahora,
      })
      .eq("id", id);
    if (error) {
      console.error("[conversaciones] finalizar", error.message);
      return ERR.server();
    }
    await ctx.db.insert("chat_mensajes", {
      conversacion_id: id,
      from_me: true,
      tipo: "nota",
      contenido:
        `✅ Conversación finalizada · ${fam.nombre} / ${sub.nombre}${ticket ? ` · Ticket ${numeroTicket(ticket.numero)}` : ""}\n${input.observacion}` +
        (prox ? `\n📅 Próxima acción: ${diaLegible(prox.fecha)}${prox.nota?.trim() ? ` · ${prox.nota.trim()}` : ""}` : ""),
      estado_entrega: "enviado",
      autor_usuario_id: ctx.usuarioId,
    });
    const fila = await leerResumen(ctx.db, id);
    return ok({ fila, tipificacion_id: tipificacionId, ticket });
  },
  { body: cuerpo },
);
