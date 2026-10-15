/**
 * POST /api/gastos/empleados { id?, nombre, ci?, cargo?, sucursal_id?, activo? } → { id }
 * (La lista viene en /api/gastos/catalogos.)
 */
import { withTenant } from "@/lib/api/with-tenant";
import { created, fail } from "@/lib/api/responses";
import { cuerpoEmpleado, mensajeDb } from "@/lib/gastos/esquema";

export const dynamic = "force-dynamic";

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("guardar_empleado", { p: input });
    if (error) return fail(mensajeDb(error.message), 422);
    return created(data);
  },
  { roles: ["ADMIN"], body: cuerpoEmpleado },
);
