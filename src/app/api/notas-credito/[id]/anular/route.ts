/**
 * POST /api/notas-credito/[id]/anular { motivo } → anula una nota de crédito (receta 99): el
 * stock que había vuelto sale de nuevo, la deuda vuelve a la venta, se anula la devolución de
 * caja y el saldo a favor. La base no deja si el saldo ya se usó o si la devolución salió de un
 * turno ya cerrado.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";
import { falloRpc } from "@/modules/inventario/server/rpc";

const cuerpo = z.object({ motivo: z.string().trim().min(3, "Escribí el motivo de la anulación").max(500) });

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req.url, "notas-credito");
    if (!UUID_RE.test(id ?? "")) return idInvalido("nota de crédito");
    const { data, error } = await ctx.db.rpc("anular_nota_credito", { p_id: id, p_motivo: input.motivo });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { permiso: "notas_credito", body: cuerpo },
);
