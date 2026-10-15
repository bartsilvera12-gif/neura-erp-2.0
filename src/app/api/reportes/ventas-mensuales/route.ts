/**
 * Ventas totales por mes (reporte_ventas_mes, receta 54): total, cantidad, contado / crédito,
 * por sucursal, forma de pago y categoría, con el mismo mes del año anterior. ADMIN.
 *   GET /api/reportes/ventas-mensuales?desde&hasta&sucursal   (meses de desde..hasta, máx. 36)
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { argsRango, filtrosRango, leerReporte } from "@/modules/reportes/server/rpc";
import type { VentasMes } from "@/modules/reportes/tipos";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const r = await leerReporte<VentasMes>(ctx.db, "reporte_ventas_mes", argsRango(filtrosRango(new URL(req.url).searchParams)));
    return r.ok ? ok(r.data) : r.res;
  },
  { permiso: "ver_reportes_financieros" },
);
