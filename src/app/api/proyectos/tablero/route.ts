/**
 * Tablero de Proyectos en UNA consulta (proyectos_tablero): cada estado activo con su
 * cantidad y solo las primeras N tarjetas (livianas), más los KPIs del encabezado y el
 * horario laboral (soporte_config) para que el SLA corra en el navegador sin recargar.
 *   GET /api/proyectos/tablero?q=&responsable=<uuid>&cliente=<uuid>&prioridad=&archivados=1&n=30
 *     → { columnas: [{ id, codigo, nombre, color, orden, tipo_sla, sla_horas_objetivo, rol, es_final, cantidad, tarjetas }], kpis, horario }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { leerHorario } from "@/modules/agenda/server";
import { errorProy, filtrosRpc, limite, normalizarTarjetas } from "@/modules/proyectos/server";
import type { Columna, Kpis } from "@/modules/proyectos/tipos";

export const dynamic = "force-dynamic";

const KPIS: (keyof Kpis)[] = ["activos", "vencidos", "vencen_3_dias", "sin_fecha", "bloqueados", "sin_movimiento", "urgentes", "entregados_mes"];

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const [r, horario] = await Promise.all([
    ctx.db.rpc<{ columnas: Columna[]; kpis: Kpis }>("proyectos_tablero", { ...filtrosRpc(sp), p_por_columna: limite(sp, 30) }),
    leerHorario(ctx.db),
  ]);
  if (r.error) return errorProy(r.error, "No se pudo cargar el tablero");
  const columnas = (r.data?.columnas ?? []).map((c) => ({
    ...c,
    orden: Number(c.orden) || 0,
    sla_horas_objetivo: c.sla_horas_objetivo == null ? null : Number(c.sla_horas_objetivo),
    cantidad: Number(c.cantidad) || 0,
    tarjetas: normalizarTarjetas(c.tarjetas),
  }));
  const kpis = Object.fromEntries(KPIS.map((k) => [k, Number(r.data?.kpis?.[k]) || 0])) as Kpis;
  return ok({ columnas, kpis, horario });
});
