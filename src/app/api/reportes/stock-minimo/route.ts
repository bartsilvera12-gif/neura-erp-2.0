/**
 * Reporte "Stock mínimo" (portado de Ferretería República). ADMIN.
 *   GET /api/reportes/stock-minimo?categoria=&sin_stock=1
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { categoriaDeUrl, reporteStockMinimo } from "@/modules/reportes/server/stock";

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    try {
      return ok(await reporteStockMinimo(ctx.db, categoriaDeUrl(sp), sp.get("sin_stock") === "1"));
    } catch (e) {
      console.error("[reportes/stock-minimo]", e instanceof Error ? e.message : e);
      return ERR.server();
    }
  },
  { roles: ["ADMIN"] },
);
