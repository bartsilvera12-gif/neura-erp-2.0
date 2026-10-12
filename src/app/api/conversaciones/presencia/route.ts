/**
 * Presencia del asesor (latido). Lo llaman la bandeja y el Monitoreo cada 30 s mientras la
 * pestaña se ve; al cerrar la pestaña se manda "desconectado" con fetch keepalive.
 *   POST /api/conversaciones/presencia { estado?: disponible|ocupado|pausa|desconectado }
 *   → { estado }   (sin estado: solo late y conserva el que tenía)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

const cuerpo = z.object({ estado: z.enum(["disponible", "ocupado", "pausa", "desconectado"]).nullish() }).default({});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc<{ estado: string }>("chat_latido", { p_estado: input?.estado ?? null });
    if (error) {
      console.error("[conversaciones] latido", error.message);
      return fail("No se pudo actualizar tu estado.", 500);
    }
    return ok({ estado: data?.estado ?? input?.estado ?? "disponible" });
  },
  { body: cuerpo },
);
