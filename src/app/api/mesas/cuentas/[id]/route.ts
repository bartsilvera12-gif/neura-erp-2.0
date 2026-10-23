/**
 * Cuenta abierta de una mesa (recetas 68 y 69). "Atender pedidos de mesas".
 *   POST /api/mesas/cuentas/<id> { accion: "enviar_caja" } → la mesa pidió la cuenta: queda "en caja · por cobrar"
 *        y la ve la caja (Caja › Nueva venta › Mesas por cobrar), que la cobra como una venta normal.
 *   POST /api/mesas/cuentas/<id> { accion: "reabrir" }     → la saca de la caja (se envió por error).
 *   POST /api/mesas/cuentas/<id> { accion: "liberar" }     → cierra sin cobrar (todo rechazado).
 * El cobro ya no se hace acá: un solo camino, por la caja (POST /api/caja/venta con mesa_cuenta_id).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";

const cuerpo = z.object({ accion: z.enum(["enviar_caja", "reabrir", "liberar"]) });

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req.url, "cuentas");
    if (!id || !UUID_RE.test(id)) return idInvalido("cuenta");
    if (!ctx.puede("pedidos_mesas")) return ERR.sinPermiso("pedidos_mesas");

    if (input.accion === "liberar") {
      const { error } = await ctx.db.rpc("mesa_cuenta_liberar", { p_cuenta_id: id });
      if (error) return falloRpc(error);
      return ok({ id });
    }

    const { data, error } = await ctx.db.rpc("mesa_cuenta_enviar_caja", { p_cuenta_id: id, p_enviar: input.accion === "enviar_caja" });
    if (error) return falloRpc(error);
    return ok(data ?? { id });
  },
  { body: cuerpo },
);
