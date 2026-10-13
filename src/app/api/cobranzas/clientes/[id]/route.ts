/**
 * Detalle de cobranza de un cliente (panel lateral de Seguimiento).
 *   GET /api/cobranzas/clientes/[id] → deuda por servicio con sus cuotas (vencidas y por
 *   vencer), la cuota más vieja (la única que se puede cobrar primero), último pago,
 *   promesas, transferencias esperando aprobación y "mensaje este mes".
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR, fail } from "@/lib/api/responses";
import { idTras } from "@/modules/cobranzas/server";
import { ROLES_REGISTRAR, type DetalleCobranza } from "@/modules/cobranzas/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const id = idTras(req, "clientes");
  if (!id) return ERR.invalid("Falta el id del cliente");
  const { data, error } = await ctx.db.rpc<Omit<DetalleCobranza, "puede_registrar">>("cobranza_detalle", { p_cliente: id });
  if (error) return /no encontrado/i.test(error.message) ? ERR.notFound("Cliente") : fail(error.message, 400);
  if (!data) return ERR.server();
  return ok({ ...data, puede_registrar: ROLES_REGISTRAR.includes(ctx.rol) });
});
