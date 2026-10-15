/**
 * Sucursal donde trabaja un usuario (ADMIN): de ahí sale su depósito por defecto (ventas,
 * compras, pérdidas). POST /api/inventario/sucursales/usuario { usuario_id, sucursal_id|null }
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";

const cuerpo = z.object({
  usuario_id: z.string().uuid(),
  sucursal_id: z.string().uuid().nullable(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("asignar_sucursal_usuario", { p_usuario: input.usuario_id, p_sucursal: input.sucursal_id });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { roles: ["ADMIN"], body: cuerpo },
);
