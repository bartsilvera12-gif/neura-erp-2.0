/**
 * Configuración › Usuarios (nivel ADMIN + "administrar usuarios").
 *   GET  /api/configuracion/usuarios → { usuarios[], perfiles[], sucursales[], mi_usuario_id }
 *        (estado, último ingreso e invitación pendiente salen de la cuenta de acceso)
 *   POST /api/configuracion/usuarios { email, nombres, apellidos?, ci?, telefono?, perfil_id,
 *        sucursal_id?, es_tecnico?, es_qa?, usa_soporte?, modo: email|link, vincular? }
 *        → { estado: invitado | link | existe | vinculado, id?, link? }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { crearUsuario as esquemaCrear, type CrearUsuario } from "@/modules/usuarios/esquemas";
import { crearUsuario, falloRpc } from "@/modules/usuarios/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx) => {
    const { data, error } = await ctx.db.rpc("admin_listar_usuarios");
    if (error) return falloRpc(error);
    return ok(data);
  },
  { permiso: "administrar_usuarios" },
);

export const POST = withTenant((ctx, req, input) => crearUsuario(ctx, req, input as CrearUsuario), {
  permiso: "administrar_usuarios",
  body: esquemaCrear,
});
