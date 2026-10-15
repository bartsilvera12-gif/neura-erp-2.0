/** Datos del usuario logueado (para el cascarón: rol, empresa, email, perfil con pantallas y permisos). */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";

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
  }),
);
