/**
 * POST /api/gastos/cuentas-bancarias { id?, banco_id? | banco_nombre?, numero, moneda, titular?, alias?, activa? } → { id }
 * Cuentas PROPIAS de la empresa (de dónde sale una transferencia, un cheque o un pago con tarjeta).
 * (La lista viene en /api/gastos/catalogos.)
 */
import { withTenant } from "@/lib/api/with-tenant";
import { created, fail } from "@/lib/api/responses";
import { cuerpoCuentaBancaria, mensajeDb } from "@/lib/gastos/esquema";

export const dynamic = "force-dynamic";

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("guardar_cuenta_bancaria", { p: input });
    if (error) return fail(mensajeDb(error.message), 422);
    return created(data);
  },
  { roles: ["ADMIN"], body: cuerpoCuentaBancaria },
);
