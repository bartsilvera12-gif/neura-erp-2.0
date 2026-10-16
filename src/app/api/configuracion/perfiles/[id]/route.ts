/**
 * Eliminar un perfil propio que nadie usa: DELETE /api/configuracion/perfiles/[id]
 * (el Administrador no se elimina; con usuarios —aunque estén inactivos— tampoco).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ERR, ok } from "@/lib/api/responses";
import { cambioDeAcceso, falloRpc, soloAdmin } from "@/modules/usuarios/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = withTenant(
  async (ctx, req) => {
    const corte = soloAdmin(ctx);
    if (corte) return corte;
    const segs = new URL(req.url).pathname.split("/").filter(Boolean);
    const id = segs[segs.indexOf("perfiles") + 1];
    if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id del perfil");
    const { data, error } = await ctx.db.rpc("admin_eliminar_perfil", { p_id: id });
    if (error) return falloRpc(error);
    cambioDeAcceso();
    return ok(data);
  },
  { permiso: "administrar_usuarios" },
);
