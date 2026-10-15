/**
 * Un día de caja (reporte_cierre_dia, receta 54): totales del día, ventas por forma de pago,
 * por sucursal y el resumen COMPLETO de cada turno abierto ese día (resumen_turno).
 *   GET /api/reportes/cajas/dia?fecha=YYYY-MM-DD&sucursal=<id>
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { fechaONull, uuidONull } from "@/modules/inventario/server/rpc";
import { leerReporte } from "@/modules/reportes/server/rpc";
import type { CierreDiaDetalle } from "@/modules/reportes/tipos";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    const r = await leerReporte<CierreDiaDetalle>(ctx.db, "reporte_cierre_dia", { p_fecha: fechaONull(sp.get("fecha")), p_sucursal: uuidONull(sp.get("sucursal")) });
    return r.ok ? ok(r.data) : r.res;
  },
  { roles: ["ADMIN", "SUPERVISOR"] },
);
