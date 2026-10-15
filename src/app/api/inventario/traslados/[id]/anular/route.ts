/**
 * Anular un traslado que todavía no se recibió (ADMIN). POST /api/inventario/traslados/[id]/anular { motivo }
 * Todo vuelve al depósito de origen, a los mismos lotes (anular_traslado).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";
import { falloRpc } from "@/modules/inventario/server/rpc";

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req.url, "traslados");
    if (!UUID_RE.test(id ?? "")) return idInvalido("traslado");
    const { data, error } = await ctx.db.rpc("anular_traslado", { p_id: id, p_motivo: input.motivo });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { roles: ["ADMIN"], body: z.object({ motivo: z.string().trim().min(1, "Escribí el motivo").max(500) }) },
);
