/**
 * Resumen de la caja abierta (para el panel de control de turno). Portado del
 * getResumenCaja de O&M, re-plomado al 2.0.
 *   GET /api/caja/resumen → ventas del turno por medio + movimientos manuales +
 *                           efectivo esperado del cajón.
 *
 * Las ventas de contado ya escriben un caja_movimiento (venta_id seteado); por eso
 * acá las ventas salen de `ventas` y los movimientos MANUALES de `caja_movimientos`
 * con venta_id NULL — así nada se cuenta dos veces.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";

const esEfvo = (m: string | null) => (m ?? "").trim().toLowerCase() === "efectivo";

export const GET = withTenant(async (ctx) => {
  // TODO sale de caja_movimientos (fuente de verdad del cajón). Las ventas de
  // contado escriben un movimiento por MEDIO (pago mixto → varios), así el
  // desglose por medio y el arqueo cuadran aun con pagos combinados.
  // Caja abierta + sus movimientos en UNA consulta (embebido): corre al abrir la caja
  // y después de cada venta, así que se ahorra un viaje a la base.
  const cajaQ = await ctx.db
    .select(
      "cajas",
      "id, numero_caja, estado, fecha_apertura, monto_apertura, " +
        "movs:caja_movimientos(id, tipo, concepto, monto, medio_pago, venta_id, cobro_id, observacion, created_at)",
    )
    .eq("estado", "abierta")
    .is("movs.anulado_at", null)
    .order("fecha_apertura", { ascending: false })
    .order("created_at", { referencedTable: "movs", ascending: true })
    .limit(1);
  if (cajaQ.error) return ERR.server();
  const caja = cajaQ.data?.[0] as unknown as
    | { id: string; numero_caja: number; fecha_apertura: string; monto_apertura: number; movs: Record<string, unknown>[] | null }
    | undefined;
  if (!caja) return ok({ caja: null, resumen: null });

  const movRaw = caja.movs ?? [];
  const all = movRaw.map((m) => ({
    id: String(m.id),
    tipo: String(m.tipo),
    concepto: String(m.concepto ?? ""),
    monto: Number(m.monto) || 0,
    medio_pago: String(m.medio_pago ?? "efectivo"),
    venta_id: m.venta_id ? String(m.venta_id) : null,
    cobro_id: m.cobro_id ? String(m.cobro_id) : null,
    observacion: (m.observacion as string | null) ?? null,
    created_at: String(m.created_at),
  }));

  // Ventas del turno = ingresos ligados a una venta, agrupados por medio.
  const ventaMovs = all.filter((m) => m.venta_id && m.tipo === "ingreso");
  const sumMedioVenta = (m: string) => ventaMovs.filter((x) => x.medio_pago === m).reduce((a, x) => a + x.monto, 0);
  const total_efectivo = sumMedioVenta("efectivo");
  const total_transferencia = sumMedioVenta("transferencia");
  const total_tarjeta = sumMedioVenta("tarjeta");
  const total_pos = sumMedioVenta("pos");
  const total_vendido = ventaMovs.reduce((a, x) => a + x.monto, 0);
  const cantidad_ventas = new Set(ventaMovs.map((x) => x.venta_id)).size;

  // Cobros a clientes (cuenta corriente): entran a la caja, se muestran aparte.
  const cobroMovs = all.filter((m) => m.cobro_id && m.tipo === "ingreso");
  const cobros_efectivo = cobroMovs.filter((m) => esEfvo(m.medio_pago)).reduce((a, x) => a + x.monto, 0);
  const cobros_otros = cobroMovs.filter((m) => !esEfvo(m.medio_pago)).reduce((a, x) => a + x.monto, 0);
  const cantidad_cobros = new Set(cobroMovs.map((x) => x.cobro_id)).size;

  // Movimientos manuales (sin venta ni cobro) para la lista y el efectivo esperado.
  const movimientos = all.filter((m) => !m.venta_id && !m.cobro_id).map(({ id, tipo, concepto, monto, medio_pago, observacion, created_at }) => ({ id, tipo, concepto, monto, medio_pago, observacion, created_at }));
  const sumMov = (pred: (x: (typeof movimientos)[number]) => boolean) => movimientos.filter(pred).reduce((a, x) => a + x.monto, 0);
  const ingresos_efectivo = sumMov((m) => m.tipo === "ingreso" && esEfvo(m.medio_pago));
  const egresos_efectivo = sumMov((m) => m.tipo === "egreso" && esEfvo(m.medio_pago));
  const retiros_efectivo = sumMov((m) => m.tipo === "retiro" && esEfvo(m.medio_pago));
  const ajustes_efectivo = sumMov((m) => m.tipo === "ajuste" && esEfvo(m.medio_pago));

  // Efectivo físico esperado: apertura + todo el efectivo (ventas + manuales).
  const efectivo_esperado =
    Number(caja.monto_apertura) + total_efectivo + cobros_efectivo + ingresos_efectivo - egresos_efectivo - retiros_efectivo + ajustes_efectivo;

  return ok({
    caja: {
      id: caja.id,
      numero_caja: caja.numero_caja,
      fecha_apertura: caja.fecha_apertura,
      monto_apertura: Number(caja.monto_apertura),
    },
    resumen: {
      total_vendido,
      cantidad_ventas,
      total_efectivo,
      total_transferencia,
      total_tarjeta,
      total_pos,
      efectivo_esperado,
      ingresos_efectivo,
      egresos_efectivo,
      retiros_efectivo,
      ajustes_efectivo,
      cobros_efectivo,
      cobros_otros,
      cantidad_cobros,
      movimientos,
    },
  });
});
