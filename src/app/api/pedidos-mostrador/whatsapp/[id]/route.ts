/**
 * Un pedido de WhatsApp (receta 172).
 *   POST /api/pedidos-mostrador/whatsapp/<id> { accion: "a_caja" } → pasa a "En caja" hoy, en la sucursal
 *        de quien lo envía; desde ahí lo cobra la caja en Nueva venta como cualquier pedido.
 * Anular: /api/pedidos-mostrador/<id>/anular, igual que los de mostrador.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";

const cuerpo = z.object({ accion: z.enum(["a_caja"]) });

export const POST = withTenant(
  async (ctx, req) => {
    const id = idDeRuta(req.url, "whatsapp");
    if (!id || !UUID_RE.test(id)) return idInvalido("pedido");
    const { data, error } = await ctx.db.rpc("pedido_whatsapp_a_caja", { p_id: id });
    if (error) return falloRpc(error);
    if (!data) return ERR.server();
    return ok(data);
  },
  { permiso: "pedidos_mostrador", body: cuerpo },
);
