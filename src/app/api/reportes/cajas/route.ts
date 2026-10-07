/**
 * Reporte de cierres de caja (portado de Ferretería República).
 *   GET /api/reportes/cajas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD → turnos del período + totales.
 * Sin fechas: del 1° del mes en curso hasta hoy (hora de Asunción).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { getReporteCajas, resolverRango } from "@/modules/caja/reporte-cajas";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  try {
    return ok(await getReporteCajas(ctx.db, resolverRango(sp.get("desde"), sp.get("hasta"))));
  } catch {
    return ERR.server();
  }
});
