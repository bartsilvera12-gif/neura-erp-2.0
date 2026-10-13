/**
 * Vencimientos — lotes vencidos y por vencer (pantalla Inventario → Vencimientos).
 *   GET /api/inventario/vencimientos?dias=7|15|30|60&q&estado=vencido|por_vencer
 *     → { hoy, dias, hay_productos_con_lotes, items[], totales }
 * totales = franja de cifras de todo el rango (sin el filtro de búsqueda ni de estado).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { consultarVencimientos, filtrosVencimientos } from "@/modules/inventario/server/vencimientos";

export const GET = withTenant(async (ctx, req) => {
  try {
    return ok(await consultarVencimientos(ctx.db, filtrosVencimientos(new URL(req.url).searchParams)));
  } catch {
    return ERR.server();
  }
});
