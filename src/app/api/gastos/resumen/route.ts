/**
 * GET /api/gastos/resumen?desde&hasta&sucursal → gastos_resumen: compras de mercadería + gastos operativos
 *     (totales, período anterior, por rubro, por mes, por sucursal, top proveedores, presupuesto). Todo en Gs.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { mensajeDb } from "@/lib/gastos/esquema";

export const dynamic = "force-dynamic";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    const f = (k: string) => {
      const v = sp.get(k);
      return v && FECHA.test(v) ? v : null;
    };
    const suc = sp.get("sucursal");
    const { data, error } = await ctx.db.rpc("gastos_resumen", {
      p_desde: f("desde"),
      p_hasta: f("hasta"),
      p_sucursal: suc && UUID.test(suc) ? suc : null,
    });
    if (error) return fail(mensajeDb(error.message), 422);
    return ok(data);
  },
  { roles: ["ADMIN"] },
);
