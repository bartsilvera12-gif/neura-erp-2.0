/**
 * Formas de pago (reporte_formas_pago, receta 60): ventas, costo y ganancia por medio de pago
 * (mixtos prorrateados), venta a crédito aparte, cobros de créditos por medio y evolución. ADMIN.
 *   GET /api/reportes/formas-pago?desde&hasta&sucursal
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { argsRango, filtrosRango, leerReporte } from "@/modules/reportes/server/rpc";
import type { FormasPago } from "@/modules/reportes/tipos";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const r = await leerReporte<FormasPago>(ctx.db, "reporte_formas_pago", argsRango(filtrosRango(new URL(req.url).searchParams)));
    return r.ok ? ok(r.data) : r.res;
  },
  { permiso: "ver_reportes_financieros" },
);
