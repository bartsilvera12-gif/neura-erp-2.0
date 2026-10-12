/**
 * Tablero del CRM en UNA consulta (crm_tablero): cada etapa activa con su cantidad, su
 * total en Gs y solo las primeras N tarjetas, más los KPIs del encabezado.
 *   GET /api/crm/tablero?q=&responsable=<uuid>&mios=1&hoy=1&n=25
 *     → { columnas: [{ codigo, nombre, color, orden, es_ganado, es_perdido, cantidad, total, tarjetas }], kpis }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { errorCrm, filtrosRpc, limite, normalizarTarjetas } from "@/modules/crm/server";
import type { Columna, Tablero } from "@/modules/crm/tipos";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const { data, error } = await ctx.db.rpc<Tablero>("crm_tablero", { ...filtrosRpc(sp), p_por_columna: limite(sp, 25) });
  if (error) return errorCrm(error, "No se pudo cargar el tablero");
  const columnas = (data?.columnas ?? []).map((c: Columna) => ({
    ...c,
    cantidad: Number(c.cantidad) || 0,
    total: Number(c.total) || 0,
    tarjetas: normalizarTarjetas(c.tarjetas),
  }));
  const k = data?.kpis;
  return ok({
    columnas,
    kpis: {
      leads_hoy: Number(k?.leads_hoy) || 0,
      leads_mes: Number(k?.leads_mes) || 0,
      en_negociacion: Number(k?.en_negociacion) || 0,
      ganados_mes: Number(k?.ganados_mes) || 0,
      acciones_vencidas: Number(k?.acciones_vencidas) || 0,
    },
  });
});
