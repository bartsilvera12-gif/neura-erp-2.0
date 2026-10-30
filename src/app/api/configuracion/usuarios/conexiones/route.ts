/**
 * GET /api/configuracion/usuarios/conexiones → quién está conectado ahora y su última conexión
 * (receta 111). Nivel ADMIN + "administrar usuarios", igual que el resto de Usuarios.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloRpc } from "@/modules/usuarios/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx) => {
    const { data, error } = await ctx.db.rpc("admin_conexiones_usuarios");
    if (error) return falloRpc(error);
    return ok(data);
  },
  { permiso: "administrar_usuarios" },
);
