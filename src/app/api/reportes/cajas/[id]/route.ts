/**
 * Detalle de un turno de caja: resumen del arqueo + ventas + movimientos manuales.
 *   GET /api/reportes/cajas/<id>
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { cajaIdDeUrl, getDetalleCaja } from "@/modules/caja/reporte-cajas";

export const GET = withTenant(async (ctx, req) => {
  const id = cajaIdDeUrl(req.url);
  if (!id) return ERR.invalid("Falta el id de la caja");
  try {
    const d = await getDetalleCaja(ctx.db, id);
    return d ? ok(d) : ERR.notFound("turno");
  } catch {
    return ERR.server();
  }
});
