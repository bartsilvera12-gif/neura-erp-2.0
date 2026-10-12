/**
 * Estado y carga de los asesores (para el modal Transferir: punto en línea + chats abiertos).
 *   GET /api/conversaciones/agentes → { agentes: [{ id, estado, online, carga }] }
 * Sale de chat_monitoreo (una consulta); solo se devuelve lo mínimo.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import type { AgenteCarga, AgenteMonitoreo } from "@/modules/conversaciones/supervision";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.rpc<{ agentes: AgenteMonitoreo[] }>("chat_monitoreo");
  if (error) {
    console.error("[conversaciones] agentes", error.message);
    return ERR.server();
  }
  const agentes: AgenteCarga[] = (data?.agentes ?? []).map((a) => ({
    id: a.id,
    estado: a.estado,
    online: a.online === true,
    carga: Number(a.carga) || 0,
  }));
  return ok({ agentes });
});
