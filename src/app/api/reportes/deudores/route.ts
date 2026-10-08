/**
 * Reporte "Deudores": una fila por cliente que debe, lo vencido primero. ADMIN.
 *   GET /api/reportes/deudores?vencidos=1 → { rows, totales }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { reporteDeudores } from "@/modules/reportes/server/deudores";

export const GET = withTenant(
  async (ctx, req) => {
    try {
      return ok(await reporteDeudores(ctx.db, new URL(req.url).searchParams.get("vencidos") === "1"));
    } catch (e) {
      console.error("[reportes/deudores]", e instanceof Error ? e.message : e);
      return ERR.server();
    }
  },
  { roles: ["ADMIN"] },
);
