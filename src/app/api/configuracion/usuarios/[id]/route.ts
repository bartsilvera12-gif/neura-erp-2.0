/**
 * Editar un usuario: PATCH /api/configuracion/usuarios/[id] { nombres?, apellidos?, ci?,
 * telefono?, perfil_id?, sucursal_id?, activo?, es_tecnico?, es_qa?, usa_soporte? }
 * La base no deja desactivar ni cambiar de perfil al último Administrador, ni desactivarse
 * o cambiarse el perfil a uno mismo; todo queda en el historial.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ERR, ok } from "@/lib/api/responses";
import { editarUsuario } from "@/modules/usuarios/esquemas";
import { cambioDeAcceso, falloRpc, soloAdmin } from "@/modules/usuarios/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = withTenant(
  async (ctx, req, input) => {
    const corte = soloAdmin(ctx);
    if (corte) return corte;
    const segs = new URL(req.url).pathname.split("/").filter(Boolean);
    const id = segs[segs.indexOf("usuarios") + 1];
    if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id del usuario");
    const { data, error } = await ctx.db.rpc("admin_actualizar_usuario", { p_id: id, p: input });
    if (error) return falloRpc(error);
    cambioDeAcceso();
    return ok(data);
  },
  { permiso: "administrar_usuarios", body: editarUsuario },
);
