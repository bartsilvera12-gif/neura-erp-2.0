/**
 * Cuentas por cobrar en PDF (antigüedad, por cliente y documentos) para salir a cobrar.
 *   GET /api/reportes/cuentas-cobrar/pdf?desde&hasta&sucursal → descarga
 */
import { datosEmpresa } from "@/modules/empresa/server";
import { withTenant } from "@/lib/api/with-tenant";
import { respuestaPdf } from "@/lib/pdf/documento";
import { argsRango, filtrosRango, leerReporte, nombreArchivo } from "@/modules/reportes/server/rpc";
import { pdfCxc } from "@/modules/reportes/server/cuentas";
import type { CuentasCobrar } from "@/modules/reportes/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const r = await leerReporte<CuentasCobrar>(ctx.db, "reporte_cxc", argsRango(filtrosRango(new URL(req.url).searchParams)));
    if (!r.ok) return r.res;
    return respuestaPdf(await pdfCxc(r.data, await datosEmpresa(ctx.db)), `${nombreArchivo("cuentas-por-cobrar", r.data.hoy)}.pdf`);
  },
  { permiso: ["ver_reportes_financieros", "exportar"] },
);
