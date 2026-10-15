/**
 * Presupuesto mensual de gastos.
 *   GET /api/gastos/presupuesto?periodo=YYYY-MM-01 → { periodo, mercaderia: { previsto, anterior, gastado },
 *       rubros: [{ id, nombre, previsto, anterior, gastado, subcategorias: [...] }] }
 *   PUT /api/gastos/presupuesto { periodo, items: [{ categoria_id (null = mercadería), monto }] } → reemplaza el mes
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { cuerpoPresupuesto, mensajeDb } from "@/lib/gastos/esquema";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const per = new URL(req.url).searchParams.get("periodo");
    const { data, error } = await ctx.db.rpc("presupuesto_gastos", { p_periodo: per && /^\d{4}-\d{2}-\d{2}$/.test(per) ? per : null });
    if (error) return fail(mensajeDb(error.message), 422);
    return ok(data);
  },
  { roles: ["ADMIN"] },
);

export const PUT = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("guardar_presupuesto_gastos", { p_periodo: input.periodo, p_items: input.items });
    if (error) return fail(mensajeDb(error.message), 422);
    return ok(data);
  },
  { roles: ["ADMIN"], body: cuerpoPresupuesto },
);
