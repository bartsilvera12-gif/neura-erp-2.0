/**
 * Seguimiento de cobranzas.
 *   GET /api/cobranzas → { hoy, mes, clientes: [...], puede_registrar, es_admin }
 *   Una fila por cliente con deuda y sus servicios (suscripciones; sin suscripción =
 *   "General") ya agregados por la base (cobranza_seguimiento). Los filtros (tramo, plan,
 *   categoría, búsqueda) y el orden se aplican en la pantalla sobre esta lista.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { ROLES_REGISTRAR, type Seguimiento } from "@/modules/cobranzas/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.rpc<Omit<Seguimiento, "puede_registrar" | "es_admin">>("cobranza_seguimiento");
  if (error || !data) {
    console.error("[cobranzas]", error?.message);
    return ERR.server();
  }
  return ok({ ...data, puede_registrar: ROLES_REGISTRAR.includes(ctx.rol), es_admin: ctx.rol === "ADMIN" });
});
