/**
 * "Asignar automáticamente" una conversación sin asignar (Monitoreo): corre la misma regla
 * que el trigger de mensajes entrantes (chat_asignar: cola del canal, asesor disponible con
 * lugar, el de menos asignaciones del día…). ADMIN o supervisor.
 *   POST /api/conversaciones/[id]/asignar
 *   → { asignada, motivo?, usuario_id?, fila }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { idConversacion, leerResumen, puedeSupervisar } from "@/modules/conversaciones/server";

export const dynamic = "force-dynamic";

type Resultado = { asignada: boolean; motivo?: string; usuario_id?: string; cola_id?: string };

export const POST = withTenant(async (ctx, req) => {
  const id = idConversacion(req);
  if (!id) return ERR.invalid("Conversación inválida");
  if (!(await puedeSupervisar(ctx))) return ERR.forbidden();
  const actual = await leerResumen(ctx.db, id);
  if (!actual) return ERR.notFound("Conversación");
  const { data, error } = await ctx.db.rpc<Resultado>("chat_asignar", { p_conversacion: id });
  if (error) {
    console.error("[conversaciones] asignar", error.message);
    return ERR.server();
  }
  const fila = await leerResumen(ctx.db, id);
  return ok({ ...(data ?? { asignada: false }), fila });
});
