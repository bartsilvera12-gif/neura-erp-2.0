/**
 * Cajas de un día (resumen_cajas_dia, receta 51): los turnos ABIERTOS ese día con su resumen
 * corto, totales por sucursal y del día y los métodos de pago sumados.
 *   GET /api/caja/dia?fecha=YYYY-MM-DD&sucursal=<id>   (sin fecha: hoy en Asunción)
 * ADMIN ve todas las sucursales (o la elegida); el resto, la suya.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloRpc, fechaONull, uuidONull } from "@/modules/inventario/server/rpc";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const { data, error } = await ctx.db.rpc("resumen_cajas_dia", {
    p_fecha: fechaONull(sp.get("fecha")),
    p_sucursal: uuidONull(sp.get("sucursal")),
  });
  if (error) return falloRpc(error);
  return ok(data);
});
