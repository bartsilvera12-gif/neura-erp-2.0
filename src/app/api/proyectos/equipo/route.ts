/**
 * Tareas del equipo en UNA consulta (proyectos_tareas_equipo): una tarjeta por técnico con
 * sus proyectos abiertos y las métricas vivas (horas laborales en el estado, semáforo del
 * SLA, vencido / vence pronto / sin movimiento), el WIP configurado y los proyectos sin
 * técnico. Trae el horario laboral y la hora en que se calculó para que las horas sigan
 * corriendo en el navegador sin recargar.
 *   GET /api/proyectos/equipo
 *     → { wip, tecnicos: [{ id, nombre, activos, en_espera, vencidos, sla_rojo, sobre_wip, entregados_mes, proyectos }], sin_tecnico, horario, generado_at }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { leerHorario } from "@/modules/agenda/server";
import { errorProy, normalizarMetricas, numeros } from "@/modules/proyectos/server";
import type { EquipoResp, TecnicoEquipo } from "@/modules/proyectos/tipos";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx) => {
  const generado_at = new Date().toISOString();
  const [r, horario] = await Promise.all([
    ctx.db.rpc<{ wip: number; tecnicos: Record<string, unknown>[]; sin_tecnico: unknown }>("proyectos_tareas_equipo"),
    leerHorario(ctx.db),
  ]);
  if (r.error) return errorProy(r.error, "No se pudo cargar el equipo");
  const tecnicos: TecnicoEquipo[] = (r.data?.tecnicos ?? []).map((t) => ({
    ...numeros<TecnicoEquipo>(t),
    sobre_wip: !!t.sobre_wip,
    proyectos: normalizarMetricas(t.proyectos),
  }));
  const resp: EquipoResp = {
    wip: Number(r.data?.wip) || 4,
    tecnicos,
    sin_tecnico: normalizarMetricas(r.data?.sin_tecnico),
    horario,
    generado_at,
  };
  return ok(resp);
});
