/**
 * Cuentas por pagar / cobrar — Excel y PDF (mismos datos que la pantalla). Solo servidor.
 */
import { buildXlsx, hoja } from "@/lib/excel/xlsx";
import { COLOR, encabezado, gs, nuevoDocumento, pieDePagina } from "@/lib/pdf/documento";
import { kpisPdf, tablaPdf } from "@/lib/pdf/tabla";
import { fechaCorta } from "@/components/graficos/formato";
import { describirRango } from "@/modules/reportes/server/rpc";
import { ORIGEN_CXC, TRAMOS, type CuentasCobrar, type CuentasPagar } from "@/modules/reportes/tipos";

const TRAMO_LABEL = Object.fromEntries(TRAMOS.map((t) => [t.key, t.label]));
const g = (n: number) => `Gs. ${gs(n)}`;
const montoMon = (n: number, moneda: string) => (moneda === "USD" ? `USD ${Number(n).toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : g(n));
const filtro = (d: { hoy: string; sucursal_id: string | null; sucursales: { id: string; nombre: string }[] }) =>
  `Saldos al ${fechaCorta(d.hoy)} · ${describirRango({ sucursal_id: d.sucursal_id, sucursales: d.sucursales })}`;

// ── Por pagar ─────────────────────────────────────────────────────────────────
export function xlsxCxp(d: CuentasPagar) {
  return buildXlsx([
    hoja("Por proveedor", d.por_proveedor, [
      { header: "Proveedor", value: (f) => f.nombre, width: 34 },
      { header: "Teléfono", value: (f) => f.telefono ?? "", width: 14 },
      { header: "Cuentas", value: (f) => Number(f.cuentas), width: 8 },
      { header: "Saldo (Gs.)", value: (f) => Number(f.saldo_gs), width: 15 },
      { header: "Vencido (Gs.)", value: (f) => Number(f.vencido_gs), width: 15 },
      ...TRAMOS.map((t) => ({ header: t.label, value: (f: CuentasPagar["por_proveedor"][number]) => Number(f[t.key]), width: 13 })),
      { header: "Saldo USD", value: (f) => Number(f.saldo_usd), width: 11 },
      { header: "Próximo vencimiento", value: (f) => (f.proximo_vencimiento ? fechaCorta(f.proximo_vencimiento) : ""), width: 12 },
      { header: "Máx. días de atraso", value: (f) => Number(f.max_atraso), width: 10 },
    ]),
    hoja("Documentos", d.rows, [
      { header: "Proveedor", value: (f) => f.proveedor_nombre, width: 30 },
      { header: "Origen", value: (f) => (f.origen === "compra" ? "Compra" : "Gasto"), width: 9 },
      { header: "Documento", value: (f) => f.documento, width: 14 },
      { header: "Factura", value: (f) => f.factura ?? "", width: 18 },
      { header: "Emisión", value: (f) => fechaCorta(f.fecha_emision), width: 11 },
      { header: "Vencimiento", value: (f) => fechaCorta(f.vencimiento), width: 11 },
      { header: "Días de atraso", value: (f) => Number(f.dias_atraso), width: 9 },
      { header: "Antigüedad", value: (f) => TRAMO_LABEL[f.tramo], width: 11 },
      { header: "Moneda", value: (f) => f.moneda, width: 7 },
      { header: "Monto", value: (f) => Number(f.monto), width: 14 },
      { header: "Pagado", value: (f) => Number(f.pagado), width: 14 },
      { header: "Saldo", value: (f) => Number(f.saldo), width: 14 },
      { header: "Saldo en Gs.", value: (f) => Number(f.saldo_gs), width: 14 },
    ]),
  ]);
}

export async function pdfCxp(d: CuentasPagar) {
  const doc = nuevoDocumento();
  let y = await encabezado(doc, "CUENTAS POR PAGAR", filtro(d));
  const t = d.tramos_gs;
  const usd = d.por_moneda.USD;
  y = kpisPdf(doc, y, [
    { label: "Total a pagar (Gs.)", valor: g(t.total), sub: `${t.proveedores} proveedores`, color: COLOR.teal },
    { label: "Vencido", valor: g(t.vencido), color: Number(t.vencido) ? COLOR.rojo : COLOR.verde },
    { label: "Compras / gastos", valor: `${gs(t.compras)} / ${gs(t.gastos)}` },
    { label: "En dólares", valor: usd ? montoMon(usd.saldo, "USD") : "—" },
  ]);
  y = tablaPdf(doc, y, "ANTIGÜEDAD (GS. EQUIVALENTES)", TRAMOS.map((x) => x.label.toUpperCase()).concat("TOTAL"),
    [[...TRAMOS.map((x) => g(Number(t[x.key]))), g(t.total)]], [0, 1, 2, 3, 4, 5]);
  y = tablaPdf(doc, y, "POR PROVEEDOR", ["PROVEEDOR", "CUENTAS", "SALDO", "VENCIDO", "1-30", "31-60", "61-90", "+90", "PRÓX. VENC."],
    d.por_proveedor.map((p) => [p.nombre, p.cuentas, gs(p.saldo_gs), gs(p.vencido_gs), gs(p.d1_30), gs(p.d31_60), gs(p.d61_90), gs(p.d90), p.proximo_vencimiento ? fechaCorta(p.proximo_vencimiento) : "—"]),
    [1, 2, 3, 4, 5, 6, 7], { styles: { fontSize: 7 } });
  tablaPdf(doc, y, "DOCUMENTOS (POR VENCIMIENTO)", ["PROVEEDOR", "DOCUMENTO", "EMISIÓN", "VENCE", "ATRASO", "SALDO"],
    d.rows.map((r) => [r.proveedor_nombre, `${r.documento}${r.factura ? ` (${r.factura})` : ""}`, fechaCorta(r.fecha_emision), fechaCorta(r.vencimiento),
      r.dias_atraso ? `${r.dias_atraso} d` : "al día", montoMon(r.saldo, r.moneda)]), [4, 5], { styles: { fontSize: 7 } });
  pieDePagina(doc, "Cuentas por pagar · Documento no fiscal");
  return doc;
}

// ── Por cobrar ────────────────────────────────────────────────────────────────
export function xlsxCxc(d: CuentasCobrar) {
  return buildXlsx([
    hoja("Por cliente", d.por_cliente, [
      { header: "Cliente", value: (f) => f.nombre, width: 32 },
      { header: "Teléfono", value: (f) => f.telefono ?? "", width: 14 },
      { header: "Cuentas", value: (f) => Number(f.cuentas), width: 8 },
      { header: "Saldo", value: (f) => Number(f.saldo), width: 14 },
      { header: "Vencido", value: (f) => Number(f.vencido), width: 14 },
      ...TRAMOS.map((t) => ({ header: t.label, value: (f: CuentasCobrar["por_cliente"][number]) => Number(f[t.key]), width: 13 })),
      { header: "En aprobación", value: (f) => Number(f.en_aprobacion), width: 13 },
      { header: "Máx. días de atraso", value: (f) => Number(f.max_atraso), width: 10 },
      { header: "Próximo vencimiento", value: (f) => (f.proximo_vencimiento ? fechaCorta(f.proximo_vencimiento) : ""), width: 12 },
      { header: "Último cobro", value: (f) => (f.ultimo_cobro ? new Date(f.ultimo_cobro) : ""), width: 16 },
    ]),
    hoja("Documentos", d.rows, [
      { header: "Cliente", value: (f) => f.cliente_nombre, width: 30 },
      { header: "RUC / CI", value: (f) => f.cliente_ruc ?? "", width: 14 },
      { header: "Documento", value: (f) => f.documento, width: 14 },
      { header: "Origen", value: (f) => ORIGEN_CXC[f.origen] ?? f.origen, width: 18 },
      { header: "Sucursal", value: (f) => f.sucursal_nombre ?? "", width: 16 },
      { header: "Emisión", value: (f) => fechaCorta(f.fecha_emision), width: 11 },
      { header: "Vencimiento", value: (f) => fechaCorta(f.vencimiento), width: 11 },
      { header: "Días de atraso", value: (f) => Number(f.dias_atraso), width: 9 },
      { header: "Antigüedad", value: (f) => TRAMO_LABEL[f.tramo], width: 11 },
      { header: "Monto", value: (f) => Number(f.monto), width: 14 },
      { header: "Cobrado", value: (f) => Number(f.cobrado), width: 14 },
      { header: "Saldo", value: (f) => Number(f.saldo), width: 14 },
      { header: "En aprobación", value: (f) => Number(f.en_aprobacion), width: 13 },
    ]),
    hoja("En aprobación", d.en_aprobacion, [
      { header: "Fecha", value: (f) => fechaCorta(f.fecha), width: 11 },
      { header: "Cliente", value: (f) => f.cliente_nombre, width: 30 },
      { header: "Documento", value: (f) => f.documento, width: 14 },
      { header: "Monto", value: (f) => Number(f.monto), width: 14 },
      { header: "Banco", value: (f) => f.banco ?? "", width: 18 },
      { header: "Operación", value: (f) => f.operacion ?? "", width: 16 },
      { header: "Cargado por", value: (f) => f.creado_por ?? "", width: 18 },
    ]),
  ]);
}

export async function pdfCxc(d: CuentasCobrar) {
  const doc = nuevoDocumento();
  let y = await encabezado(doc, "CUENTAS POR COBRAR", filtro(d));
  const t = d.tramos;
  y = kpisPdf(doc, y, [
    { label: "Total a cobrar", valor: g(t.total), sub: `${t.clientes} clientes · ${t.cuentas} cuentas`, color: COLOR.teal },
    { label: "Vencido", valor: g(t.vencido), color: Number(t.vencido) ? COLOR.rojo : COLOR.verde },
    { label: "Vence en 7 días", valor: g(t.vence_7) },
    { label: "En aprobación", valor: g(t.en_aprobacion), sub: "transferencias en Conciliación" },
  ]);
  y = tablaPdf(doc, y, "ANTIGÜEDAD", TRAMOS.map((x) => x.label.toUpperCase()).concat("TOTAL"),
    [[...TRAMOS.map((x) => g(Number(t[x.key]))), g(t.total)]], [0, 1, 2, 3, 4, 5]);
  y = tablaPdf(doc, y, "POR CLIENTE", ["CLIENTE", "CUENTAS", "SALDO", "VENCIDO", "1-30", "31-60", "61-90", "+90", "ATRASO MÁX."],
    d.por_cliente.map((c) => [c.nombre, c.cuentas, gs(c.saldo), gs(c.vencido), gs(c.d1_30), gs(c.d31_60), gs(c.d61_90), gs(c.d90), c.max_atraso ? `${c.max_atraso} d` : "—"]),
    [1, 2, 3, 4, 5, 6, 7, 8], { styles: { fontSize: 7 } });
  tablaPdf(doc, y, "DOCUMENTOS (POR VENCIMIENTO)", ["CLIENTE", "DOCUMENTO", "ORIGEN", "VENCE", "ATRASO", "SALDO"],
    d.rows.map((r) => [r.cliente_nombre, r.documento, ORIGEN_CXC[r.origen] ?? r.origen, fechaCorta(r.vencimiento), r.dias_atraso ? `${r.dias_atraso} d` : "al día", g(r.saldo)]),
    [4, 5], { styles: { fontSize: 7 } });
  pieDePagina(doc, "Cuentas por cobrar · Documento no fiscal");
  return doc;
}
