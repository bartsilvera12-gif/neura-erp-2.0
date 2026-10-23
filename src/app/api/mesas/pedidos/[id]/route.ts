/**
 * Acción sobre un pedido de mesa (receta 68).
 *   POST /api/mesas/pedidos/<id> { accion, motivo? }
 *     aceptar / rechazar (con motivo)       → "Atender pedidos de mesas"
 *     preparar / listo / entregar           → "Pantalla de cocina" (o la caja): todas las partes
 *     entregar_listos                       → receta 70: entrega solo las comandas listas
 * La base valida el permiso, la sucursal y la transición de estado.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";

const cuerpo = z.object({
  accion: z.enum(["aceptar", "rechazar", "preparar", "listo", "entregar", "entregar_listos"]),
  motivo: z.string().trim().max(500, "El motivo es muy largo").nullish(),
});

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req.url, "pedidos");
    if (!id || !UUID_RE.test(id)) return idInvalido("pedido");
    if (!ctx.puede("pedidos_mesas") && !ctx.puede("cocina")) return ERR.sinPermiso("pedidos_mesas");
    if (input.accion === "rechazar" && !input.motivo) return ERR.invalid("Escribí el motivo (lo ve el cliente en su celular)");
    const { data, error } = await ctx.db.rpc("mesa_pedido_accion", { p_id: id, p_accion: input.accion, p_motivo: input.motivo ?? null });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { body: cuerpo },
);
