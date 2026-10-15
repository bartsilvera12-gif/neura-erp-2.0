/**
 * Cuentas por pagar (reporte_cxp, receta 54): saldos abiertos de compras y gastos a crédito por
 * proveedor y vencimiento, antigüedad, calendario de las próximas semanas, GS y USD.
 *   GET /api/reportes/cuentas-pagar?desde&hasta&sucursal&proveedor   (desde/hasta: emisión) · ADMIN
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { uuidONull } from "@/modules/inventario/server/rpc";
import { argsRango, filtrosRango, leerReporte } from "@/modules/reportes/server/rpc";
import type { CuentasPagar } from "@/modules/reportes/tipos";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    const r = await leerReporte<CuentasPagar>(ctx.db, "reporte_cxp", { ...argsRango(filtrosRango(sp)), p_proveedor: uuidONull(sp.get("proveedor")) });
    return r.ok ? ok(r.data) : r.res;
  },
  { permiso: "ver_reportes_financieros" },
);
