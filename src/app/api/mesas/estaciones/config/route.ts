/**
 * Configuración › Mesas y QR › Estaciones de cocina (receta 70). ADMIN + "Configuración del sistema".
 *   GET /api/mesas/estaciones/config → { estaciones (con sus categorías, excepciones y si ya se
 *       usaron), usuarios (los que ven la cocina, con su estación fija) }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";

export const GET = withTenant(
  async (ctx) => {
    const { data, error } = await ctx.db.rpc("estaciones_cocina_listar");
    if (error) return falloRpc(error);
    if (!data) return ERR.server();
    return ok(data);
  },
  { roles: ["ADMIN"], permiso: "configuracion" },
);
