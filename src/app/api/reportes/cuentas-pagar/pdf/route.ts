/**
 * Cuentas por pagar en PDF (antigüedad, por proveedor y documentos).
 *   GET /api/reportes/cuentas-pagar/pdf?desde&hasta&sucursal&proveedor → descarga
 */
import { withTenant } from "@/lib/api/with-tenant";
import { respuestaPdf } from "@/lib/pdf/documento";
import { uuidONull } from "@/modules/inventario/server/rpc";
import { argsRango, filtrosRango, leerReporte, nombreArchivo } from "@/modules/reportes/server/rpc";
import { pdfCxp } from "@/modules/reportes/server/cuentas";
import type { CuentasPagar } from "@/modules/reportes/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    const r = await leerReporte<CuentasPagar>(ctx.db, "reporte_cxp", { ...argsRango(filtrosRango(sp)), p_proveedor: uuidONull(sp.get("proveedor")) });
    if (!r.ok) return r.res;
    return respuestaPdf(await pdfCxp(r.data), `${nombreArchivo("cuentas-por-pagar", r.data.hoy)}.pdf`);
  },
  { permiso: ["ver_reportes_financieros", "exportar"] },
);
