/**
 * Gastos recurrentes (plantillas: alquiler, internet, sueldos…).
 *   GET  /api/gastos/recurrentes?periodo=YYYY-MM-01 → { periodo, plantillas (con lo generado del período), resumen }
 *   POST /api/gastos/recurrentes { id?, nombre, proveedor_id?, sucursal_id?, con_comprobante, tipo_comprobante?, tipo_pago,
 *        plazo_dias?, medio_pago?, cuenta_bancaria_id?, moneda, tipo_cambio?, dia_vencimiento, descripcion?, activo?,
 *        vigente_desde?, vigente_hasta?, items } → { id, total }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail } from "@/lib/api/responses";
import { cuerpoRecurrente, mensajeDb } from "@/lib/gastos/esquema";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const per = new URL(req.url).searchParams.get("periodo");
    const { data, error } = await ctx.db.rpc("listar_gastos_recurrentes", { p_periodo: per && /^\d{4}-\d{2}-\d{2}$/.test(per) ? per : null });
    if (error) return fail(mensajeDb(error.message), 422);
    return ok(data);
  },
  { roles: ["ADMIN"] },
);

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("guardar_gasto_recurrente", { p: input });
    if (error) return fail(mensajeDb(error.message), 422);
    return created(data);
  },
  { roles: ["ADMIN"], body: cuerpoRecurrente },
);
