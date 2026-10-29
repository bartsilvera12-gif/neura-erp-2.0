/**
 * GET /api/inventario/produccion/fabricables?deposito= → productos que se pueden fabricar
 * (Fabricados y preparaciones por tanda con receta), con su stock y cuánto alcanza la materia
 * prima del depósito (receta 97, fabricables).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloRpc, uuidONull } from "@/modules/inventario/server/rpc";

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    const { data, error } = await ctx.db.rpc("fabricables", { p_deposito: uuidONull(sp.get("deposito")) });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { permiso: "fabricar" },
);
