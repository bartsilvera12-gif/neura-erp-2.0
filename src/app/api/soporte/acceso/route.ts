/**
 * GET /api/soporte/acceso — qué partes de Soporte ve quien consulta.
 * Lo usan el layout del módulo y el Dashboard; cada API vuelve a comprobarlo.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { accesoSoporte, leerConfig, sinAccesoSoporte } from "@/modules/soporte/server";

export const GET = withTenant(async (ctx) => {
  const acc = await accesoSoporte(ctx);
  if (!acc) return sinAccesoSoporte();
  const cfg = await leerConfig(ctx);
  return ok({ dashboard: acc.veDashboard, configuracion: acc.puedeConfigurar, qa_activo: cfg.qa_activo, usuario_id: ctx.usuarioId });
});
