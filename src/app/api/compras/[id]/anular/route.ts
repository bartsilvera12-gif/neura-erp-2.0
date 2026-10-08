/**
 * Anular una compra (ADMIN). POST /api/compras/[id]/anular { motivo }
 * Revierte stock y costo promedio de cada producto (anular_compra). Si ya se vendió
 * parte y el stock no alcanza, no deja anular y lo explica.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";

export const POST = withTenant(
  async (ctx, req, input) => {
    const segs = new URL(req.url).pathname.split("/").filter(Boolean);
    const id = segs[segs.indexOf("compras") + 1];
    if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id de la compra");
    const { data, error } = await ctx.db.rpc("anular_compra", { p_id: id, p_motivo: input.motivo });
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, ""), 400);
    return ok(data);
  },
  { roles: ["ADMIN"], body: z.object({ motivo: z.string().trim().min(1, "Escribí el motivo").max(500) }) },
);
