/**
 * Acciones sobre una conversación.
 *   PATCH /api/conversaciones/[id]
 *     { accion: "tomar" }                          → me la asigno
 *     { accion: "transferir", asignado_id }        → a otro usuario de la empresa
 *     { accion: "derivar", cola_id }               → a una cola (la reparte su estrategia)
 *     { accion: "soltar" }                         → queda sin asignar
 *     { accion: "reabrir" }                        → estado abierta (limpia el cierre)
 *     { accion: "pendiente" | "abierta" }          → cambia el estado (sin cerrar)
 *     { accion: "etiquetas", etiquetas: string[] } → reemplaza las etiquetas
 *   → FilaBandeja actualizada. El trigger avisa a la lista por Realtime.
 * Tomar / transferir / soltar quedan en la auditoría de ruteo (chat_ruteo_eventos). Al
 * asignar a mano, si todavía no hubo primera respuesta, el SLA de la cola vuelve a correr
 * para el nuevo asesor (así el barrido no se la saca por el vencimiento del anterior).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { idConversacion, leerResumen, registrarRuteo } from "@/modules/conversaciones/server";

export const dynamic = "force-dynamic";

const cuerpo = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("tomar") }),
  z.object({ accion: z.literal("soltar") }),
  z.object({ accion: z.literal("reabrir") }),
  z.object({ accion: z.literal("pendiente") }),
  z.object({ accion: z.literal("abierta") }),
  z.object({ accion: z.literal("transferir"), asignado_id: z.string().uuid("Elegí a quién transferir") }),
  z.object({ accion: z.literal("derivar"), cola_id: z.string().uuid("Elegí la cola") }),
  z.object({
    accion: z.literal("etiquetas"),
    etiquetas: z.array(z.string().trim().min(1).max(40)).max(20, "Máximo 20 etiquetas"),
  }),
]);

export const PATCH = withTenant(
  async (ctx, req, input) => {
    const id = idConversacion(req);
    if (!id) return ERR.invalid("Conversación inválida");
    // Derivar a una cola: la reparte chat_asignar con la estrategia de esa cola (también las
    // "solo transferencia"); el ruteo y el mensaje automático los deja la base.
    if (input.accion === "derivar") {
      const { data, error } = await ctx.db.rpc<{ asignada: boolean; motivo?: string }>("chat_asignar", { p_conversacion: id, p_cola: input.cola_id });
      if (error) {
        console.error("[conversaciones] derivar", error.message);
        return ERR.server();
      }
      if (data?.motivo === "no_existe") return ERR.notFound("Conversación");
      if (data?.motivo === "cola_inexistente") return fail("La cola no existe o está inactiva.");
      const fila = await leerResumen(ctx.db, id);
      return fila ? ok(fila) : ERR.notFound("Conversación");
    }
    const ahora = new Date().toISOString();
    const asigna = input.accion === "tomar" || input.accion === "transferir" || input.accion === "soltar";
    // Antes de reasignar: quién la tenía, su cola y si ya hubo primera respuesta.
    let previa: { asignado_id: string | null; cola_id: string | null; primera_respuesta_at: string | null; sla: number | null } | null = null;
    if (asigna) {
      const { data: c } = await ctx.db
        .select("chat_conversaciones", "asignado_id, cola_id, primera_respuesta_at")
        .eq("id", id)
        .limit(1);
      const r = (c?.[0] ?? null) as unknown as { asignado_id: string | null; cola_id: string | null; primera_respuesta_at: string | null } | null;
      if (!r) return ERR.notFound("Conversación");
      let sla: number | null = null;
      if (r.cola_id && !r.primera_respuesta_at && input.accion !== "soltar") {
        const { data: q } = await ctx.db.select("chat_colas", "sla_minutos").eq("id", r.cola_id).limit(1);
        sla = Number((q?.[0] as { sla_minutos?: number } | undefined)?.sla_minutos) || null;
      }
      previa = { ...r, sla };
    }
    const asignacion = (a: string) => ({
      asignado_id: a,
      asignada_at: ahora,
      espera_motivo: null,
      reasignaciones: 0,
      sla_vence_at: previa?.sla ? new Date(Date.now() + previa.sla * 60_000).toISOString() : null,
    });
    let patch: Record<string, unknown>;
    switch (input.accion) {
      case "tomar":
        patch = asignacion(ctx.usuarioId);
        break;
      case "soltar":
        patch = { asignado_id: null, sla_vence_at: null };
        break;
      case "transferir": {
        const { data: u } = await ctx.db.select("usuarios", "id, activo").eq("id", input.asignado_id).limit(1);
        const fila = (u?.[0] ?? null) as { id: string; activo: boolean } | null;
        if (!fila || fila.activo === false) return fail("El usuario no existe o está inactivo.");
        patch = asignacion(input.asignado_id);
        break;
      }
      case "reabrir":
        patch = { estado: "abierta", cerrada_at: null, cerrada_por: null };
        break;
      case "pendiente":
      case "abierta":
        patch = { estado: input.accion };
        break;
      case "etiquetas":
        patch = { etiquetas: [...new Set(input.etiquetas.map((e) => e.trim().toLowerCase()))] };
        break;
    }
    const { data, error } = await ctx.db
      .update("chat_conversaciones", { ...patch, updated_at: ahora })
      .eq("id", id)
      .select("id");
    if (error) {
      console.error("[conversaciones] patch", error.message);
      return ERR.server();
    }
    if (!data?.length) return ERR.notFound("Conversación");
    if (previa) {
      const a = (patch.asignado_id as string | null) ?? null;
      if (a !== previa.asignado_id) {
        await registrarRuteo(ctx.db, {
          conversacion_id: id,
          cola_id: previa.cola_id,
          evento:
            input.accion === "soltar" ? "liberada"
            : input.accion === "tomar" ? "tomada"
            : previa.asignado_id ? "transferida" : "asignada_supervisor",
          de_usuario: previa.asignado_id,
          a_usuario: a,
          detalle: { por: ctx.usuarioId },
        });
      }
    }
    const fila = await leerResumen(ctx.db, id);
    return fila ? ok(fila) : ERR.notFound("Conversación");
  },
  { body: cuerpo },
);
