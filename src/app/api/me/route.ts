/** Datos del usuario logueado (para el cascarón: rol, empresa, email). */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";

export const GET = withTenant(async (ctx) =>
  ok({
    usuarioId: ctx.usuarioId,
    empresaId: ctx.empresaId,
    rol: ctx.rol,
    email: ctx.user.email ?? null,
  }),
);
