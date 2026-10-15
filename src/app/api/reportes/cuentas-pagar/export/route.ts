/**
 * Cuentas por pagar en Excel (por proveedor + documentos).
 *   GET /api/reportes/cuentas-pagar/export?desde&hasta&sucursal&proveedor → .xlsx
 */
import { withTenant } from "@/lib/api/with-tenant";
import { xlsxHeaders } from "@/lib/excel/xlsx";
import { uuidONull } from "@/modules/inventario/server/rpc";
import { argsRango, filtrosRango, leerReporte, nombreArchivo } from "@/modules/reportes/server/rpc";
import { xlsxCxp } from "@/modules/reportes/server/cuentas";
import type { CuentasPagar } from "@/modules/reportes/tipos";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    const r = await leerReporte<CuentasPagar>(ctx.db, "reporte_cxp", { ...argsRango(filtrosRango(sp)), p_proveedor: uuidONull(sp.get("proveedor")) });
    if (!r.ok) return r.res;
    return new Response(xlsxCxp(r.data) as unknown as BodyInit, { status: 200, headers: xlsxHeaders(nombreArchivo("cuentas-por-pagar", r.data.hoy)) });
  },
  { permiso: ["ver_reportes_financieros", "exportar"] },
);
