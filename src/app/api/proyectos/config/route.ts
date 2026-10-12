/**
 * Parámetros de seguimiento de Proyectos (proyecto_config) que usan Tareas del equipo y
 * los dashboards: WIP por técnico, cuántos días antes "vence pronto" y cuántas horas
 * laborales sin actividad cuentan como "sin movimiento".
 *   GET /api/proyectos/config → { wip_por_tecnico, vence_pronto_dias, sin_movimiento_horas, soy_pm }
 *       (`soy_pm`: el usuario es PM de algún proyecto sin archivar → ve el Dashboard PM)
 *   PUT /api/proyectos/config { wip_por_tecnico, vence_pronto_dias, sin_movimiento_horas } → lo mismo (solo ADMIN)
 */
import { z } from "zod";
import { withTenant, type TenantContext } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { CONFIG_DEFECTO, type ProyectoConfig } from "@/modules/proyectos/tipos";

export const dynamic = "force-dynamic";

const COLS = "wip_por_tecnico, vence_pronto_dias, sin_movimiento_horas";

async function leer(ctx: TenantContext): Promise<ProyectoConfig | null> {
  const { data, error } = await ctx.db.select("proyecto_config", COLS).limit(1);
  if (error) return null;
  const c = (data?.[0] ?? null) as unknown as ProyectoConfig | null;
  return {
    wip_por_tecnico: Number(c?.wip_por_tecnico ?? CONFIG_DEFECTO.wip_por_tecnico),
    vence_pronto_dias: Number(c?.vence_pronto_dias ?? CONFIG_DEFECTO.vence_pronto_dias),
    sin_movimiento_horas: Number(c?.sin_movimiento_horas ?? CONFIG_DEFECTO.sin_movimiento_horas),
  };
}

async function soyPm(ctx: TenantContext): Promise<boolean> {
  const { count } = await ctx.db
    .select("proyectos", "id", { count: "exact", head: true })
    .eq("project_manager_id", ctx.usuarioId)
    .eq("archivado", false);
  return (count ?? 0) > 0;
}

export const GET = withTenant(async (ctx) => {
  const [c, pm] = await Promise.all([leer(ctx), soyPm(ctx)]);
  if (!c) return ERR.server();
  return ok({ ...c, soy_pm: pm });
});

const guardar = z.object({
  wip_por_tecnico: z.coerce.number().int("El WIP tiene que ser un número entero").min(1, "El WIP va de 1 a 50").max(50, "El WIP va de 1 a 50"),
  vence_pronto_dias: z.coerce.number().int("Los días tienen que ser un número entero").min(1, "\"Vence pronto\" va de 1 a 60 días").max(60, "\"Vence pronto\" va de 1 a 60 días"),
  sin_movimiento_horas: z.coerce.number().int("Las horas tienen que ser un número entero").min(1, "\"Sin movimiento\" va de 1 a 500 horas").max(500, "\"Sin movimiento\" va de 1 a 500 horas"),
});

export const PUT = withTenant(
  async (ctx, _req, input) => {
    const campos = { ...input, updated_at: new Date().toISOString() };
    const up = await ctx.db.update("proyecto_config", campos).select("empresa_id");
    if (up.error) return fail("No se pudieron guardar los parámetros", 422);
    if (!up.data?.length) {
      const ins = await ctx.db.insert("proyecto_config", campos);
      if (ins.error) return fail("No se pudieron guardar los parámetros", 422);
    }
    const [c, pm] = await Promise.all([leer(ctx), soyPm(ctx)]);
    if (!c) return ERR.server();
    return ok({ ...c, soy_pm: pm });
  },
  { roles: ["ADMIN"], body: guardar },
);
