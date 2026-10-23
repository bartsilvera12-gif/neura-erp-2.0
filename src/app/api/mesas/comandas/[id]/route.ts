/**
 * Acción sobre UNA comanda (la parte de un pedido de una estación de cocina, receta 70).
 *   POST /api/mesas/comandas/<id> { accion: "preparar" | "listo" | "entregar" | "impresa" }
 * "Pantalla de cocina" o "Atender pedidos de mesas". La base valida la sucursal, la transición,
 * y que un usuario con estación fija solo toque las comandas de su estación. Devuelve el pedido
 * (con su estado general derivado de todas sus comandas).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";

const cuerpo = z.object({ accion: z.enum(["preparar", "listo", "entregar", "impresa"]) });

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req.url, "comandas");
    if (!id || !UUID_RE.test(id)) return idInvalido("comanda");
    if (!ctx.puede("pedidos_mesas") && !ctx.puede("cocina")) return ERR.sinPermiso("cocina");
    const { data, error } = await ctx.db.rpc("mesa_comanda_accion", { p_id: id, p_accion: input.accion });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { body: cuerpo },
);
