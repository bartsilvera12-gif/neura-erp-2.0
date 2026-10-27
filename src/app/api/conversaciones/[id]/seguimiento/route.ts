/**
 * Seguimiento de una conversación finalizada (la "próxima acción" del cierre).
 *   POST /api/conversaciones/[id]/seguimiento { hecho: boolean }
 *   → { id, seguimiento_hecho_at }
 * "Marcar hecho" la saca de Finalizadas › Seguimientos (y deja una nota en el hilo);
 * hecho: false la vuelve a dejar pendiente. Puede quien la cerró o un supervisor que la ve.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { alcanceSupervision, idConversacion, puedeSupervisar } from "@/modules/conversaciones/server";

export const dynamic = "force-dynamic";

const cuerpo = z.object({ hecho: z.boolean() });

type Fila = { id: string; estado: string; cerrada_por: string | null; asignado_id: string | null; proxima_accion_fecha: string | null };

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idConversacion(req);
    if (!id) return ERR.invalid("Conversación inválida");
    const { data } = await ctx.db.select("chat_conversaciones", "id, estado, cerrada_por, asignado_id, proxima_accion_fecha").eq("id", id).limit(1);
    const c = (data?.[0] ?? null) as unknown as Fila | null;
    if (!c) return ERR.notFound("Conversación");
    if (!c.proxima_accion_fecha) return fail("Esta conversación no tiene una próxima acción agendada.", 409);

    if (c.cerrada_por !== ctx.usuarioId) {
      if (!(await puedeSupervisar(ctx))) return ERR.forbidden();
      const equipo = await alcanceSupervision(ctx);
      if (equipo && !equipo.includes(c.cerrada_por ?? "") && !equipo.includes(c.asignado_id ?? "")) return ERR.forbidden();
    }

    const ahora = new Date().toISOString();
    const { error } = await ctx.db
      .update("chat_conversaciones", { seguimiento_hecho_at: input.hecho ? ahora : null, seguimiento_hecho_por: input.hecho ? ctx.usuarioId : null })
      .eq("id", id);
    if (error) {
      console.error("[conversaciones] seguimiento", error.message);
      return ERR.server();
    }
    await ctx.db.insert("chat_mensajes", {
      conversacion_id: id,
      from_me: true,
      tipo: "nota",
      contenido: input.hecho ? "📅 Seguimiento hecho" : "📅 Seguimiento vuelto a pendiente",
      estado_entrega: "enviado",
      autor_usuario_id: ctx.usuarioId,
    });
    return ok({ id, seguimiento_hecho_at: input.hecho ? ahora : null });
  },
  { body: cuerpo },
);
