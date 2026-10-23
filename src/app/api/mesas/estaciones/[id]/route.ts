/**
 * Una estación de cocina (receta 70). ADMIN + "Configuración del sistema".
 *   DELETE /api/mesas/estaciones/<id> → la borra si nunca tuvo comandas (si no: desactivarla).
 *          Las categorías, productos y usuarios que la tenían quedan sin estación.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";

export const DELETE = withTenant(
  async (ctx, req) => {
    const id = idDeRuta(req.url, "estaciones");
    if (!id || !UUID_RE.test(id)) return idInvalido("estación");
    const { error } = await ctx.db.rpc("estacion_cocina_eliminar", { p_id: id });
    if (error) return falloRpc(error);
    return ok({ id });
  },
  { roles: ["ADMIN"], permiso: "configuracion" },
);
