/**
 * Recibir un traslado en el depósito de destino (ADMIN o alguien de la sucursal de destino:
 * lo valida la base). POST /api/inventario/traslados/[id]/recibir
 *   { items?: [{ item_id, cantidad_recibida, lotes?: [{ id, cantidad_recibida }] }],
 *     diferencia_motivo? (obligatorio si llegó menos), observacion? }
 * Sin items = llegó todo lo enviado.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";
import { falloRpc } from "@/modules/inventario/server/rpc";

const cuerpo = z.object({
  items: z
    .array(
      z.object({
        item_id: z.string().uuid(),
        cantidad_recibida: z.coerce.number().min(0),
        lotes: z.array(z.object({ id: z.string().uuid(), cantidad_recibida: z.coerce.number().min(0) })).max(50).nullish(),
      }),
    )
    .max(300)
    .nullish(),
  diferencia_motivo: z.string().trim().max(300).nullish(),
  observacion: z.string().trim().max(1000).nullish(),
});

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req.url, "traslados");
    if (!UUID_RE.test(id ?? "")) return idInvalido("traslado");
    const { data, error } = await ctx.db.rpc("recibir_traslado", { p_id: id, p: input });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { body: cuerpo },
);
