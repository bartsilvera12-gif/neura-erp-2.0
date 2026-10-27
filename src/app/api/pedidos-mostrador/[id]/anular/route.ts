/**
 * Anular un pedido de mostrador que sigue en caja (receta 77). Permiso "Armar pedidos de mostrador"
 * (el nivel Vendedor, solo los suyos). Si la caja lo tenía cargado, ve que ya no está.
 *   POST /api/pedidos-mostrador/<id>/anular { motivo? }
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";

const cuerpo = z.object({ motivo: z.string().trim().max(300).nullish() });

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req.url, "pedidos-mostrador");
    if (!id || !UUID_RE.test(id)) return idInvalido("pedido");
    const { data, error } = await ctx.db.rpc("pedido_mostrador_anular", { p_id: id, p_motivo: input.motivo ?? null });
    if (error) return falloRpc(error);
    if (!data) return ERR.server();
    return ok(data);
  },
  { permiso: "pedidos_mostrador", body: cuerpo },
);
