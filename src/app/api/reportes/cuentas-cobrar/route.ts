/**
 * Cuentas por cobrar (reporte_cxc, receta 54): saldos abiertos por cliente y vencimiento,
 * antigüedad, origen (venta a crédito, cuota de suscripción, factura al contado) y los cobros
 * que esperan aprobación en Conciliación.
 *   GET /api/reportes/cuentas-cobrar?desde&hasta&sucursal   (desde/hasta: emisión) · ADMIN
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { argsRango, filtrosRango, leerReporte } from "@/modules/reportes/server/rpc";
import type { CuentasCobrar } from "@/modules/reportes/tipos";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const r = await leerReporte<CuentasCobrar>(ctx.db, "reporte_cxc", argsRango(filtrosRango(new URL(req.url).searchParams)));
    return r.ok ? ok(r.data) : r.res;
  },
  { roles: ["ADMIN"] },
);
