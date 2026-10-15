/**
 * Perfiles (pantallas y permisos).
 *   GET  /api/configuracion/perfiles → perfiles[] con pantallas, permisos y cuántos usuarios
 *   POST /api/configuracion/perfiles { id?, nombre, descripcion?, nivel_base, alcance_sucursal,
 *        tope_descuento_pct?, pantallas[], permisos[] } → { id, cambios }
 * Administrador no se edita; los de sistema conservan nombre y nivel base.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { guardarPerfil } from "@/modules/usuarios/esquemas";
import { cambioDeAcceso, falloRpc, soloAdmin } from "@/modules/usuarios/server";
import { pantallasCatalogo } from "@/modules/registry";
import { permisoAplica, permisoDef } from "@/modules/usuarios/permisos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx) => {
    const { data, error } = await ctx.db.rpc("admin_listar_perfiles");
    if (error) return falloRpc(error);
    return ok(data ?? []);
  },
  { permiso: "administrar_usuarios" },
);

export const POST = withTenant(
  async (ctx, _req, input) => {
    const corte = soloAdmin(ctx);
    if (corte) return corte;
    // Solo lo que el nivel base puede usar (la base exige ese rol en esas funciones).
    const catalogo = new Map(pantallasCatalogo().map((p) => [p.href, p]));
    const p = {
      ...input,
      permisos: input.permisos.filter((x) => { const d = permisoDef(x); return !!d && permisoAplica(d, input.nivel_base); }),
      pantallas: input.pantallas.filter((h) => { const x = catalogo.get(h); return !x || !x.niveles?.length || x.niveles.includes(input.nivel_base); }),
    };
    const { data, error } = await ctx.db.rpc("admin_guardar_perfil", { p });
    if (error) return falloRpc(error);
    cambioDeAcceso();
    return ok(data);
  },
  { permiso: "administrar_usuarios", body: guardarPerfil },
);
