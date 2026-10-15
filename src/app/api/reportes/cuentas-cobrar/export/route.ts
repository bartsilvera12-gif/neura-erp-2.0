/**
 * Cuentas por cobrar en Excel (por cliente, documentos y cobros en aprobación).
 *   GET /api/reportes/cuentas-cobrar/export?desde&hasta&sucursal → .xlsx
 */
import { withTenant } from "@/lib/api/with-tenant";
import { xlsxHeaders } from "@/lib/excel/xlsx";
import { argsRango, filtrosRango, leerReporte, nombreArchivo } from "@/modules/reportes/server/rpc";
import { xlsxCxc } from "@/modules/reportes/server/cuentas";
import type { CuentasCobrar } from "@/modules/reportes/tipos";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const r = await leerReporte<CuentasCobrar>(ctx.db, "reporte_cxc", argsRango(filtrosRango(new URL(req.url).searchParams)));
    if (!r.ok) return r.res;
    return new Response(xlsxCxc(r.data) as unknown as BodyInit, { status: 200, headers: xlsxHeaders(nombreArchivo("cuentas-por-cobrar", r.data.hoy)) });
  },
  { roles: ["ADMIN"] },
);
