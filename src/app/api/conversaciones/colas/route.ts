/**
 * Colas de atención (configuración desde Monitoreo, solo ADMIN).
 *   GET  /api/conversaciones/colas → { colas, canales, usuarios }
 *   POST /api/conversaciones/colas { nombre, estrategia, prioridad, sla_minutos, max_reasignaciones,
 *        mismo_asesor_horas, activo, canales: uuid[], agentes: [{ usuario_id, recibe_nuevos,
 *        max_conversaciones, es_supervisor }] } → { id }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { created, fail, ok, ERR } from "@/lib/api/responses";
import { esquemaCola, guardarCola, leerColas } from "@/modules/conversaciones/colas-server";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx) => {
    try {
      return ok(await leerColas(ctx));
    } catch (e) {
      console.error("[conversaciones] colas", (e as Error).message);
      return ERR.server();
    }
  },
  { roles: ["ADMIN"] },
);

export const POST = withTenant(
  async (ctx, _req, input) => {
    const r = await guardarCola(ctx, null, input);
    if (!r.ok) return fail(r.mensaje, r.status);
    return created({ id: r.id });
  },
  { roles: ["ADMIN"], body: esquemaCola },
);
