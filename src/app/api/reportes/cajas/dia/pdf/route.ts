/**
 * Cierre de caja del día en PDF (todas las cajas abiertas ese día).
 *   GET /api/reportes/cajas/dia/pdf?fecha=YYYY-MM-DD&sucursal=<id> → descarga
 */
import { withTenant } from "@/lib/api/with-tenant";
import { respuestaPdf } from "@/lib/pdf/documento";
import { pdfCierreDia } from "@/lib/pdf/cierre-dia";
import { fechaONull, uuidONull } from "@/modules/inventario/server/rpc";
import { leerReporte } from "@/modules/reportes/server/rpc";
import type { CierreDiaDetalle } from "@/modules/reportes/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    const r = await leerReporte<CierreDiaDetalle>(ctx.db, "reporte_cierre_dia", { p_fecha: fechaONull(sp.get("fecha")), p_sucursal: uuidONull(sp.get("sucursal")) });
    if (!r.ok) return r.res;
    return respuestaPdf(await pdfCierreDia(r.data), `cierre-caja-dia-${r.data.fecha}.pdf`);
  },
  { permiso: ["ver_cierres_caja", "exportar"] },
);
