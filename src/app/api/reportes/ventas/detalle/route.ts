/**
 * Reporte "Ventas del período" — detalle venta por venta, paginado. ADMIN.
 *   GET /api/reportes/ventas/detalle?desde&hasta&cajero&tipo&medio&categoria&pagina&por_pagina
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { detalleVentas, filtrosVentas } from "@/modules/reportes/server/ventas";

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    const porPagina = Math.min(200, Math.max(10, Number(sp.get("por_pagina")) || 25));
    const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
    try {
      return ok(await detalleVentas(ctx.db, filtrosVentas(sp), porPagina, (pagina - 1) * porPagina));
    } catch (e) {
      console.error("[reportes/ventas/detalle]", e instanceof Error ? e.message : e);
      return ERR.server();
    }
  },
  { roles: ["ADMIN"] },
);
