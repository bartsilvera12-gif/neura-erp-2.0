/**
 * Suscripciones del cliente con su "Estado de facturación": cada una con sus meses
 * (desde el inicio hasta 3 meses adelante) — emitida / pagada / vencida / proyectada.
 *   GET /api/clientes/[id]/facturacion → facturacion_suscripciones
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { errorDb, idDeRuta } from "@/modules/clientes/suscripciones/server";

export const GET = withTenant(async (ctx, req) => {
  const id = idDeRuta(req, "clientes");
  if (!id) return ERR.invalid("Falta el id del cliente");
  const { data, error } = await ctx.db.rpc("facturacion_suscripciones", { p_cliente: id });
  if (error) return errorDb(error, "No se pudo cargar la facturación");
  return ok(data ?? []);
});
