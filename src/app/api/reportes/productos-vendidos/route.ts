/**
 * Reporte "Productos vendidos" (portado de Ferretería República). ADMIN.
 *   GET /api/reportes/productos-vendidos?desde&hasta&categoria&producto&sin_ventas=1
 *        → resumido por producto
 *   GET …&modo=detallado&pagina&por_pagina → cada línea de venta (paginado)
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { detalleProductos, filtrosProductos, resumenProductos } from "@/modules/reportes/server/productos";

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    const f = filtrosProductos(sp);
    try {
      if (sp.get("modo") === "detallado") {
        const porPagina = Math.min(200, Math.max(10, Number(sp.get("por_pagina")) || 50));
        const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
        return ok(await detalleProductos(ctx.db, f, porPagina, (pagina - 1) * porPagina));
      }
      return ok(await resumenProductos(ctx.db, f));
    } catch (e) {
      console.error("[reportes/productos-vendidos]", e instanceof Error ? e.message : e);
      return ERR.server();
    }
  },
  { roles: ["ADMIN"] },
);
