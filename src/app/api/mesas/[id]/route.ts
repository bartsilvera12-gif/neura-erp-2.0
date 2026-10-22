/**
 * Una mesa (Configuración › Mesas y QR, receta 68).
 *   POST   /api/mesas/<id>  { accion: "token" } → regenera el token (el QR viejo deja de andar)
 *   DELETE /api/mesas/<id>  → la borra si nunca tuvo pedidos (si no: desactivarla)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";

const mesaId = (url: string) => {
  const id = idDeRuta(url, "mesas");
  return id && UUID_RE.test(id) ? id : null;
};

export const POST = withTenant(
  async (ctx, req) => {
    const id = mesaId(req.url);
    if (!id) return idInvalido("mesa");
    const { data, error } = await ctx.db.rpc("mesa_regenerar_token", { p_id: id });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { permiso: "configuracion", body: z.object({ accion: z.literal("token") }) },
);

export const DELETE = withTenant(
  async (ctx, req) => {
    const id = mesaId(req.url);
    if (!id) return idInvalido("mesa");
    const { error } = await ctx.db.rpc("mesa_eliminar", { p_id: id });
    if (error) return falloRpc(error);
    return ok({ id });
  },
  { permiso: "configuracion" },
);
