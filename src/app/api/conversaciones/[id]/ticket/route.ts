/**
 * Ticket de Soporte sin salir del chat (por el flujo de Tipificación, sin cerrar la conversación).
 *   POST /api/conversaciones/[id]/ticket { familia_id, estado_id, observacion, clasificacion_codigo? }
 *   El sub-estado tiene que ser ticket_error / ticket_cambio y el contacto tener cliente vinculado.
 *   Deja una nota interna en el hilo con el número.  → { tipificacion_id, ticket: { id, numero } }
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, fail, ERR } from "@/lib/api/responses";
import { registrarTipificacion } from "@/modules/tipificacion/registrar";
import { numeroTicket } from "@/modules/tipificacion/dominio";
import { idConversacion, leerResumen } from "@/modules/conversaciones/server";

export const dynamic = "force-dynamic";

const cuerpo = z.object({
  familia_id: z.string().uuid("Elegí el estado"),
  estado_id: z.string().uuid("Elegí el sub-estado"),
  observacion: z.string().trim().min(1, "Describí el pedido").max(5000),
  clasificacion_codigo: z.string().max(80).nullish(),
});

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idConversacion(req);
    if (!id) return ERR.invalid("Conversación inválida");
    const conv = await leerResumen(ctx.db, id);
    if (!conv) return ERR.notFound("Conversación");
    if (!conv.cliente_id) return fail("El contacto no tiene cliente vinculado. Vinculalo o crealo desde la Ficha.");

    const { data: sub } = await ctx.db.select("tipificacion_estados", "comportamiento").eq("id", input.estado_id).limit(1);
    const comp = (sub?.[0] as { comportamiento?: string | null } | undefined)?.comportamiento ?? "";
    if (comp !== "ticket_error" && comp !== "ticket_cambio") return fail("Elegí un sub-estado que cree ticket (error o cambio).");

    const r = await registrarTipificacion(ctx, {
      clienteId: conv.cliente_id,
      estadoId: input.familia_id,
      subestadoId: input.estado_id,
      observacion: input.observacion,
      ticket: { clasificacion_codigo: input.clasificacion_codigo ?? null },
    });
    if (!r.ok) return fail(r.mensaje, r.status);
    if (r.ticket) {
      await ctx.db.insert("chat_mensajes", {
        conversacion_id: id,
        from_me: true,
        tipo: "nota",
        contenido: `🎫 Ticket de Soporte ${numeroTicket(r.ticket.numero)} creado\n${input.observacion}`,
        estado_entrega: "enviado",
        autor_usuario_id: ctx.usuarioId,
      });
    }
    return created({ tipificacion_id: r.tipificacion_id, ticket: r.ticket });
  },
  { body: cuerpo },
);
