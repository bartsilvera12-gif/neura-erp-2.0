/**
 * Estado de cuenta de la empresa (reporte_estado_cuenta, receta 54): ventas netas, costo de lo
 * vendido, margen, gastos operativos por categoría (los mismos de Gastos empresariales),
 * pérdidas, resultado, IVA, cuentas a cobrar / pagar al cierre, flujo de caja y meses. ADMIN.
 *   GET /api/reportes/estado-cuenta?desde&hasta&sucursal
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { argsRango, filtrosRango, leerReporte } from "@/modules/reportes/server/rpc";
import type { EstadoCuenta } from "@/modules/reportes/tipos";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const r = await leerReporte<EstadoCuenta>(ctx.db, "reporte_estado_cuenta", argsRango(filtrosRango(new URL(req.url).searchParams)));
    return r.ok ? ok(r.data) : r.res;
  },
  { permiso: "ver_reportes_financieros" },
);
