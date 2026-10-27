/** Datos del usuario logueado (para el cascarón: rol, empresa, email, perfil con pantallas y permisos, funciones de la empresa). */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { funcionesDeEmpresa } from "@/lib/api/funciones-servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx) =>
  ok({
    usuarioId: ctx.usuarioId,
    empresaId: ctx.empresaId,
    rol: ctx.rol,
    nombre: ctx.nombre,
    email: ctx.user.email ?? null,
    sucursalId: ctx.sucursalId,
    perfil: ctx.perfil,
    // Receta 75: Mesas / Cocina / Recetas (menú, paneles y guard). Si la base no la tiene: sin filtrar.
    funciones: await funcionesDeEmpresa(ctx.empresaId).catch(() => null),
  }),
);
