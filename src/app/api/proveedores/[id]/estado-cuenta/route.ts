/**
 * Estado de cuenta de un proveedor. GET /api/proveedores/[id]/estado-cuenta
 * → { cuentas (facturas a crédito con días de atraso), pagos (con medios y a qué se aplicaron),
 *     deuda_gs, deuda_usd, vencido_gs }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";

export const GET = withTenant(
  async (ctx, req) => {
    const segs = new URL(req.url).pathname.split("/").filter(Boolean);
    const id = segs[segs.indexOf("proveedores") + 1];
    if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id del proveedor");
    const { data, error } = await ctx.db.rpc("estado_cuenta_proveedor", { p_proveedor: id });
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, ""), 422);
    return ok(data);
  },
  { roles: ["ADMIN"] },
);
