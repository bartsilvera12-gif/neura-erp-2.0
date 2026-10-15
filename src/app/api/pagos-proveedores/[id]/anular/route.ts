/**
 * Anular una orden de pago (ADMIN). POST /api/pagos-proveedores/[id]/anular { motivo }
 * La deuda vuelve a las facturas a las que se aplicó y el egreso de caja se anula.
 * Si el efectivo salió de una caja ya cerrada, no se puede anular.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";

export const POST = withTenant(
  async (ctx, req, input) => {
    const segs = new URL(req.url).pathname.split("/").filter(Boolean);
    const id = segs[segs.indexOf("pagos-proveedores") + 1];
    if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id del pago");
    const { data, error } = await ctx.db.rpc("anular_pago_proveedor", { p_id: id, p_motivo: input.motivo });
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, ""), 422);
    return ok(data);
  },
  { permiso: "pagar_proveedores", body: z.object({ motivo: z.string().trim().min(1, "Escribí el motivo").max(500) }) },
);
