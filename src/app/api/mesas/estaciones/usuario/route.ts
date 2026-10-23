/**
 * Estación fija de un usuario (receta 70): entra directo a esa pantalla de cocina y no la puede
 * cambiar. null = elige la estación en la pantalla. ADMIN + "Configuración del sistema".
 *   POST /api/mesas/estaciones/usuario { usuario_id, estacion_id | null }
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";

const cuerpo = z.object({ usuario_id: z.string().uuid(), estacion_id: z.string().uuid().nullable() });

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("usuario_estacion_cocina", { p_usuario: input.usuario_id, p_estacion: input.estacion_id });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { roles: ["ADMIN"], permiso: "configuracion", body: cuerpo },
);
