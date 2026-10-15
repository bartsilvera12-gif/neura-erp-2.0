/**
 * GET /api/gastos/catalogos[?todas=1] → { rubros (con subcategorías), sucursales, empleados, cuentas_bancarias,
 *     bancos, ultimos (lo último usado por proveedor, para autocompletar), mi_sucursal_id }
 *     todas=1 incluye lo inactivo (pantalla de catálogos).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { mensajeDb } from "@/lib/gastos/esquema";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const todas = new URL(req.url).searchParams.get("todas") === "1";
    const { data, error } = await ctx.db.rpc("gastos_catalogos", { p_todas: todas });
    if (error) return fail(mensajeDb(error.message), 422);
    return ok(data);
  },
  { roles: ["ADMIN"] },
);
