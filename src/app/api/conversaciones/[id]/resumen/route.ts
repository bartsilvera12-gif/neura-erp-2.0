/**
 * UNA fila de la bandeja (lo que se pide al llegar un aviso de Realtime "conversacion":
 * se parcha esa tarjeta, nunca se recarga la lista entera).
 *   GET /api/conversaciones/[id]/resumen → FilaBandeja
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { idConversacion, leerResumen } from "@/modules/conversaciones/server";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const id = idConversacion(req);
  if (!id) return ERR.invalid("Conversación inválida");
  try {
    const fila = await leerResumen(ctx.db, id);
    return fila ? ok(fila) : ERR.notFound("Conversación");
  } catch (e) {
    console.error("[conversaciones] resumen", (e as Error).message);
    return ERR.server();
  }
});
