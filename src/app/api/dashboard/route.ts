/**
 * Inicio (dashboard) — una sola función de agregados (dashboard_inicio, receta 54):
 * ventas por día (30 días vs los 30 anteriores, por sucursal), hoy / semana / mes contra el
 * período anterior a la misma altura, ticket, top productos, medios de pago e inventario.
 *   GET /api/dashboard?sucursal=<id>
 * ADMIN ve todas las sucursales (o la elegida) con costos y valores de inventario; el resto
 * de los roles ve solo su sucursal y sin costos ni márgenes (lo resuelve la base).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { uuidONull } from "@/modules/inventario/server/rpc";
import { leerReporte } from "@/modules/reportes/server/rpc";
import type { Dashboard } from "@/modules/reportes/tipos";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const r = await leerReporte<Dashboard>(ctx.db, "dashboard_inicio", { p_sucursal: uuidONull(new URL(req.url).searchParams.get("sucursal")) });
  return r.ok ? ok(r.data) : r.res;
});
