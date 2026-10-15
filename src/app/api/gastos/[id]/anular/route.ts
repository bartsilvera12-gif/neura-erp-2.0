/**
 * POST /api/gastos/[id]/anular { motivo } — confirmado → anulado (conserva el número).
 * Anula la cuenta a pagar (no si ya tiene pagos) y el egreso de caja (no si la caja ya cerró).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

const cuerpo = z.object({ motivo: z.string().trim().min(3, "Escribí el motivo (mínimo 3 caracteres)").max(500) });

export const POST = withTenant(
  async (ctx, req, input) => {
    const segs = new URL(req.url).pathname.split("/").filter(Boolean);
    const id = segs[segs.indexOf("gastos") + 1];
    if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id del gasto");
    const { data, error } = await ctx.db.rpc("anular_gasto", { p_id: id, p_motivo: input.motivo });
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, ""), 422);
    return ok(data);
  },
  { permiso: "anular_gastos", body: cuerpo },
);
