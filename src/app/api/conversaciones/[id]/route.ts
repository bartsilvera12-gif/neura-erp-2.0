/**
 * Acciones sobre una conversación.
 *   PATCH /api/conversaciones/[id]
 *     { accion: "tomar" }                          → me la asigno
 *     { accion: "transferir", asignado_id }        → a otro usuario de la empresa
 *     { accion: "soltar" }                         → queda sin asignar
 *     { accion: "reabrir" }                        → estado abierta (limpia el cierre)
 *     { accion: "pendiente" | "abierta" }          → cambia el estado (sin cerrar)
 *     { accion: "etiquetas", etiquetas: string[] } → reemplaza las etiquetas
 *   → FilaBandeja actualizada. El trigger avisa a la lista por Realtime.
 * Asignación automática, colas y SLA: siguiente fase.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { idConversacion, leerResumen } from "@/modules/conversaciones/server";

export const dynamic = "force-dynamic";

const cuerpo = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("tomar") }),
  z.object({ accion: z.literal("soltar") }),
  z.object({ accion: z.literal("reabrir") }),
  z.object({ accion: z.literal("pendiente") }),
  z.object({ accion: z.literal("abierta") }),
  z.object({ accion: z.literal("transferir"), asignado_id: z.string().uuid("Elegí a quién transferir") }),
  z.object({
    accion: z.literal("etiquetas"),
    etiquetas: z.array(z.string().trim().min(1).max(40)).max(20, "Máximo 20 etiquetas"),
  }),
]);

export const PATCH = withTenant(
  async (ctx, req, input) => {
    const id = idConversacion(req);
    if (!id) return ERR.invalid("Conversación inválida");
    const ahora = new Date().toISOString();
    let patch: Record<string, unknown>;
    switch (input.accion) {
      case "tomar":
        patch = { asignado_id: ctx.usuarioId };
        break;
      case "soltar":
        patch = { asignado_id: null };
        break;
      case "transferir": {
        const { data: u } = await ctx.db.select("usuarios", "id, activo").eq("id", input.asignado_id).limit(1);
        const fila = (u?.[0] ?? null) as { id: string; activo: boolean } | null;
        if (!fila || fila.activo === false) return fail("El usuario no existe o está inactivo.");
        patch = { asignado_id: input.asignado_id };
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
    const fila = await leerResumen(ctx.db, id);
    return fila ? ok(fila) : ERR.notFound("Conversación");
  },
  { body: cuerpo },
);
