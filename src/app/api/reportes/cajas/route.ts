/**
 * Cierre de caja por día (reporte_cierres_dias, receta 54): un renglón por día con lo vendido
 * (contado por forma de pago + crédito), cobros, egresos, retiros y diferencias de arqueo.
 * Un turno cuenta para el día en que se ABRIÓ.
 *   GET /api/reportes/cajas?desde&hasta&sucursal
 * ADMIN: todas las sucursales; SUPERVISOR: la suya (lo fuerza la base).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { argsRango, filtrosRango, leerReporte } from "@/modules/reportes/server/rpc";
import type { CierresDias } from "@/modules/reportes/tipos";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const r = await leerReporte<CierresDias>(ctx.db, "reporte_cierres_dias", argsRango(filtrosRango(new URL(req.url).searchParams)));
    return r.ok ? ok(r.data) : r.res;
  },
  { roles: ["ADMIN", "SUPERVISOR"] },
);
