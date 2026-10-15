/**
 * Ajustes de Presupuestos de la empresa.
 *   GET /api/presupuestos/config → { validez_dias, condiciones, respuesta_online } (con valores por defecto)
 *   PUT /api/presupuestos/config → guarda (solo ADMIN; la función lo vuelve a validar)
 */
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok, ERR } from "@/lib/api/responses";
import { CONFIG_DEFECTO, cuerpoConfig, ROLES_PRESUPUESTOS, type ConfigPresupuestos } from "@/modules/presupuestos/tipos";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.select("presupuestos_config", "validez_dias, condiciones, respuesta_online").limit(1);
  if (error) return ERR.server();
  return ok({ ...CONFIG_DEFECTO, ...((data?.[0] as unknown as ConfigPresupuestos | undefined) ?? {}) });
}, { roles: ROLES_PRESUPUESTOS });

export const PUT = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("guardar_presupuestos_config", { p: input });
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, ""), 400);
    return ok(data);
  },
  { roles: ["ADMIN"], body: cuerpoConfig },
);
