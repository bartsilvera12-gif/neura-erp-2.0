/**
 * Historial de cambios (quién cambió qué) de usuarios y perfiles.
 *   GET /api/configuracion/usuarios/historial?usuario=<id>&perfil=<id>&limite=100
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloRpc } from "@/modules/usuarios/server";
import { uuidONull } from "@/modules/inventario/server/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    const { data, error } = await ctx.db.rpc("admin_historial", {
      p_usuario: uuidONull(sp.get("usuario")),
      p_perfil: uuidONull(sp.get("perfil")),
      p_limite: Math.min(500, Math.max(1, Number(sp.get("limite")) || 100)),
    });
    if (error) return falloRpc(error);
    return ok(data ?? []);
  },
  { permiso: "administrar_usuarios" },
);
