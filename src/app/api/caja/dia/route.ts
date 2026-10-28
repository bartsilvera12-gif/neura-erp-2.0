/**
 * Cajas de un día (resumen_cajas_dia, receta 51): los turnos ABIERTOS ese día con su resumen
 * corto, totales por sucursal y del día y los métodos de pago sumados.
 * + `hoy` (resumen_ventas_dia, receta 92): lo vendido y cobrado EN EL DÍA por la fecha de cada
 *   venta / cobro (aunque el turno venga abierto de días anteriores).
 *   GET /api/caja/dia?fecha=YYYY-MM-DD&sucursal=<id>   (sin fecha: hoy en Asunción)
 * ADMIN ve todas las sucursales (o la elegida); el resto, la suya.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloRpc, fechaONull, uuidONull } from "@/modules/inventario/server/rpc";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const args = { p_fecha: fechaONull(sp.get("fecha")), p_sucursal: uuidONull(sp.get("sucursal")) };
  const [cajas, hoy] = await Promise.all([
    ctx.db.rpc("resumen_cajas_dia", args),
    ctx.db.rpc("resumen_ventas_dia", args),
  ]);
  if (cajas.error) return falloRpc(cajas.error);
  // Si la receta 92 todavía no está aplicada, sin `hoy` (la pantalla usa los totales de turnos).
  return ok({ ...(cajas.data as Record<string, unknown>), hoy: hoy.error ? null : hoy.data });
});
