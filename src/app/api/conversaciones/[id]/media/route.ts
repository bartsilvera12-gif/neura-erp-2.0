/**
 * URLs firmadas (1 h) de los adjuntos de varios mensajes, en UN viaje.
 *   POST /api/conversaciones/[id]/media { ids: uuid[] } → { urls: { [mensajeId]: url } }
 * Los mensajes se leen con la sesión del usuario (RLS): solo se firma lo que es suyo.
 * El navegador las guarda en memoria por mensaje y no las vuelve a pedir.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { firmarAdjuntosChat } from "@/lib/conversaciones/servidor";
import { idConversacion } from "@/modules/conversaciones/server";

export const dynamic = "force-dynamic";

const cuerpo = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) });

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idConversacion(req);
    if (!id) return ERR.invalid("Conversación inválida");
    const { data, error } = await ctx.db
      .select("chat_mensajes", "id, media_path")
      .eq("conversacion_id", id)
      .in("id", input.ids)
      .not("media_path", "is", null);
    if (error) return ERR.server();
    const filas = (data ?? []) as unknown as { id: string; media_path: string }[];
    const firmadas = await firmarAdjuntosChat(ctx.empresaId, filas.map((f) => f.media_path));
    const urls: Record<string, string> = {};
    for (const f of filas) {
      const u = firmadas.get(f.media_path);
      if (u) urls[f.id] = u;
    }
    return ok({ urls });
  },
  { body: cuerpo },
);
