/**
 * Arqueo y cierre de caja. Portado de distribuidorajm, re-plomado a 2.0 y simplificado
 * al modelo núcleo (una caja abierta por empresa, sin repartos/camiones).
 *
 *   GET  /api/caja/cierre  → arqueo de la caja abierta: apertura, ingresos por medio,
 *                            salidas, ajustes, efectivo esperado y crédito del día.
 *   POST /api/caja/cierre  → cierra la caja { monto_cierre_contado, observacion?, arqueo_json? }
 *
 * El arqueo va sobre `caja_movimientos` (no sobre `ventas`): en la caja también entran
 * y salen retiros, egresos y ajustes, y sin eso el efectivo del cajón no cuadra. Solo el
 * efectivo cuenta para "lo esperado"; lo demás (tarjeta/transferencia) va informado aparte.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";

const ROLES_CAJA = ["ADMIN", "CAJERO", "VENDEDOR"];

type Mov = { tipo: string; monto: number; medio_pago: string | null };
const esEfectivo = (m: Mov) => (m.medio_pago ?? "").trim().toLowerCase() === "efectivo";
const etiquetaMedio = (m: string) =>
  ({ efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia", cheque: "Cheque", otro: "Otro" }[m] ??
    (m ? m[0].toUpperCase() + m.slice(1) : "Sin registrar"));

export const GET = withTenant(async (ctx) => {
  // Caja abierta + sus movimientos + su crédito en UNA consulta (embebidos), en vez de
  // tres seguidas que solo dependían del id de la caja.
  // Crédito del turno: no entra al cajón pero es parte de lo vendido. Va informado aparte.
  // (Antes era "desde la medianoche", que en UTC arrancaba a las 21:00 de Paraguay.)
  const cajaQ = await ctx.db
    .select(
      "cajas",
      "id, numero_caja, estado, fecha_apertura, monto_apertura, movs:caja_movimientos(tipo, monto, medio_pago), cred:ventas(total)",
    )
    .eq("estado", "abierta")
    .is("movs.anulado_at", null)
    .eq("cred.tipo_venta", "CREDITO")
    .neq("cred.estado", "anulada")
    .order("fecha_apertura", { ascending: false })
    .limit(1);
  if (cajaQ.error) return ERR.server();
  const caja = cajaQ.data?.[0] as unknown as
    | {
        id: string;
        numero_caja: number;
        fecha_apertura: string;
        monto_apertura: number;
        movs: { tipo: string; monto: number | string; medio_pago: string | null }[] | null;
        cred: { total: number | string }[] | null;
      }
    | undefined;
  if (!caja) return ok({ arqueo: null });

  const movs: Mov[] = (caja.movs ?? []).map((m) => ({ ...m, monto: Number(m.monto) }));

  const sum = (pred: (m: Mov) => boolean) => movs.filter(pred).reduce((a, m) => a + m.monto, 0);
  const ingresos = movs.filter((m) => m.tipo === "ingreso");
  const salidas = movs.filter((m) => m.tipo === "egreso" || m.tipo === "retiro");
  const ajustes = movs.filter((m) => m.tipo === "ajuste");

  const esperadoEfectivo =
    Number(caja.monto_apertura) +
    sum((m) => m.tipo === "ingreso" && esEfectivo(m)) -
    sum((m) => (m.tipo === "egreso" || m.tipo === "retiro") && esEfectivo(m)) +
    sum((m) => m.tipo === "ajuste" && esEfectivo(m));

  // Desglose de lo que entró, por medio de pago (lo que se compara al cerrar).
  const porMedio = new Map<string, { cantidad: number; total: number }>();
  for (const m of ingresos) {
    const medio = (m.medio_pago ?? "").trim().toLowerCase();
    const acc = porMedio.get(medio) ?? { cantidad: 0, total: 0 };
    acc.cantidad += 1;
    acc.total += m.monto;
    porMedio.set(medio, acc);
  }

  const credVentas = caja.cred ?? [];

  return ok({
    arqueo: {
      caja: { id: caja.id, numero_caja: caja.numero_caja, fecha_apertura: caja.fecha_apertura },
      monto_apertura: Number(caja.monto_apertura),
      ingresos: {
        total: sum((m) => m.tipo === "ingreso"),
        por_medio: [...porMedio.entries()]
          .map(([medio, v]) => ({ medio, label: etiquetaMedio(medio), ...v }))
          .sort((a, b) => b.total - a.total),
      },
      salidas: { total: sum((m) => m.tipo === "egreso" || m.tipo === "retiro"), cantidad: salidas.length },
      ajustes: { total: sum((m) => m.tipo === "ajuste"), cantidad: ajustes.length },
      efectivo_esperado: esperadoEfectivo,
      credito: { cantidad: credVentas.length, total: credVentas.reduce((a, v) => a + Number(v.total), 0) },
    },
  });
});

const cierreSchema = z.object({
  monto_cierre_contado: z.coerce.number().min(0, "Contá el efectivo antes de cerrar (≥ 0)"),
  observacion: z.string().trim().max(500).nullish(),
  arqueo_json: z.record(z.string(), z.unknown()).nullish(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const abierta = await ctx.db.select("cajas", "id").eq("estado", "abierta").limit(1);
    if (abierta.error) return ERR.server();
    const caja = abierta.data?.[0] as unknown as { id: string } | undefined;
    if (!caja) return fail("No hay una caja abierta para cerrar.", 409);

    const { data, error } = await ctx.db.rpc<{
      caja_id: string;
      numero_caja: number;
      contado: number;
      esperado: number;
      diferencia: number;
    }>("cerrar_caja", {
      p_caja_id: caja.id,
      p_monto_contado: input.monto_cierre_contado,
      p_observacion: input.observacion ?? null,
      p_arqueo_json: input.arqueo_json ?? null,
    });
    if (error) return fail(error.message || "No se pudo cerrar la caja.", 409);
    if (!data) return ERR.server();
    return created(data);
  },
  { roles: ROLES_CAJA, body: cierreSchema },
);
