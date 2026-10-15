/**
 * Pérdidas de producto (reporte_perdidas, receta 54): bajas PE- aplicadas + faltantes de
 * traslados, por motivo, producto, categoría, depósito y mes, valorizadas al costo, con su
 * impacto sobre las ventas y el valor del inventario. ADMIN.
 *   GET /api/reportes/perdidas?desde&hasta&sucursal
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { argsRango, filtrosRango, leerReporte } from "@/modules/reportes/server/rpc";
import type { Perdidas } from "@/modules/reportes/tipos";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const r = await leerReporte<Perdidas>(ctx.db, "reporte_perdidas", argsRango(filtrosRango(new URL(req.url).searchParams)));
    return r.ok ? ok(r.data) : r.res;
  },
  { permiso: "ver_reportes_financieros" },
);
