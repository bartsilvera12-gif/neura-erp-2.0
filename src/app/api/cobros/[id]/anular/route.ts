/**
 * Anular un cobro (ADMIN). POST /api/cobros/[id]/anular { motivo }
 * La deuda vuelve a las cuentas a las que se aplicó y el movimiento de caja se anula.
 * Si el efectivo entró a una caja ya cerrada, no se puede anular.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";

export const POST = withTenant(
  async (ctx, req, input) => {
    const segs = new URL(req.url).pathname.split("/").filter(Boolean);
    const id = segs[segs.indexOf("cobros") + 1];
    if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id del cobro");
    const { data, error } = await ctx.db.rpc("anular_cobro", { p_id: id, p_motivo: input.motivo });
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, ""), 400);
    return ok(data);
  },
  { roles: ["ADMIN"], body: z.object({ motivo: z.string().trim().min(1, "Escribí el motivo").max(500) }) },
);
