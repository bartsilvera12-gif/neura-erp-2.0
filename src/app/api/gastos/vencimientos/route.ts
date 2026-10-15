/**
 * GET /api/gastos/vencimientos?dias=30 → próximos vencimientos (y lo vencido): borradores programados,
 *     plantillas sin generar y deudas con proveedores (gastos y compras). { hoy, hasta, total_gs, vencido_gs, rows }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { mensajeDb } from "@/lib/gastos/esquema";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const dias = Math.min(120, Math.max(1, Number(new URL(req.url).searchParams.get("dias")) || 30));
    const { data, error } = await ctx.db.rpc("gastos_proximos_vencimientos", { p_dias: dias });
    if (error) return fail(mensajeDb(error.message), 422);
    return ok(data);
  },
  { roles: ["ADMIN"] },
);
