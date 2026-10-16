/**
 * Cierre de caja de UN DÍA en PDF (todas las cajas / sucursales que se abrieron ese día):
 * totales, ventas por forma de pago (cuadra con el total vendido), por sucursal, resumen de
 * turnos y, por cada turno, su arqueo por forma de pago y la conciliación del efectivo.
 * El detalle de movimientos de cada turno está en su propio PDF (cierre-caja.ts). Solo servidor.
 */
import type { DatosEmpresa } from "@/modules/empresa/tipos";
import { COLOR, encabezado, fechaHoraPY, gs, M, nuevoDocumento, pieDePagina, W, asegurarEspacio, pdfTxt } from "@/lib/pdf/documento";
import { kpisPdf, tablaPdf } from "@/lib/pdf/tabla";
import type { CierreDiaDetalle } from "@/modules/reportes/tipos";

const g = (n: number | null | undefined) => `Gs. ${gs(Number(n) || 0)}`;
const conSigno = (v: number | null | undefined) => {
  const n = Number(v) || 0;
  return n === 0 ? "0" : `${n > 0 ? "+" : "-"}${gs(Math.abs(n))}`;
};
const hora = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)) : "—";

export async function pdfCierreDia(d: CierreDiaDetalle, empresa?: DatosEmpresa | null) {
  const doc = nuevoDocumento(empresa);
  const fecha = new Date(`${d.fecha}T12:00:00Z`).toLocaleDateString("es-PY", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const suc = d.sucursal_id ? d.sucursales.find((s) => s.id === d.sucursal_id)?.nombre ?? "Sucursal" : "Todas las sucursales";
  let y = await encabezado(doc, "CIERRE DE CAJA DEL DÍA", `${fecha} · ${suc}`);
  const t = d.totales;

  y = kpisPdf(doc, y, [
    { label: "Total vendido", valor: g(t.total_vendido), sub: `${gs(t.cantidad_ventas)} ventas · ${t.turnos} turno(s)`, color: COLOR.teal },
    { label: "Contado", valor: g(t.ventas_contado) },
    { label: "Crédito", valor: g(t.ventas_credito) },
    { label: "Cobros de cuentas", valor: g(t.cobros) },
    { label: "Egresos", valor: g(t.egresos), sub: "compras, gastos, pagos, devoluciones" },
    { label: "Retiros de efectivo", valor: g(t.retiros) },
    { label: "Diferencia efectivo", valor: conSigno(t.diferencia), color: t.diferencia ? COLOR.rojo : COLOR.verde },
    { label: "Diferencia otros medios", valor: conSigno(t.diferencia_otros), color: t.diferencia_otros ? COLOR.rojo : COLOR.verde },
  ]);

  const sumaMetodos = d.ventas_por_metodo.reduce((a, m) => a + Number(m.total), 0);
  y = tablaPdf(doc, y, "VENTAS POR FORMA DE PAGO", ["FORMA DE PAGO", "COBROS", "MONTO"],
    d.ventas_por_metodo.map((m) => [m.label, gs(m.cantidad), g(m.total)]), [1, 2],
    { pie: ["Total vendido", "", g(sumaMetodos)] });

  if (d.por_sucursal.length > 1) {
    y = tablaPdf(doc, y, "POR SUCURSAL", ["SUCURSAL", "TURNOS", "CONTADO", "CRÉDITO", "TOTAL", "EFECTIVO ESPERADO", "DIFERENCIA"],
      d.por_sucursal.map((s) => [s.sucursal_nombre, s.turnos, g(s.ventas_contado), g(s.ventas_credito), g(s.total_vendido), g(s.efectivo_esperado), conSigno(s.diferencia)]),
      [1, 2, 3, 4, 5, 6]);
  }

  y = tablaPdf(doc, y, "TURNOS DEL DÍA", ["CAJA", "TURNO", "HORARIO", "CONTADO", "CRÉDITO", "TOTAL", "EF. ESPERADO", "EF. CONTADO", "DIF."],
    d.turnos.map((x) => [`${x.punto_nombre} · ${x.sucursal_nombre}`, `N° ${x.numero_caja}`, `${hora(x.fecha_apertura)}–${x.fecha_cierre ? hora(x.fecha_cierre) : "abierta"}`,
      g(x.ventas_contado), g(x.ventas_credito), g(x.total_vendido), g(x.efectivo_esperado), x.efectivo_contado == null ? "—" : g(x.efectivo_contado),
      x.diferencia == null ? "—" : conSigno(x.diferencia)]),
    [3, 4, 5, 6, 7, 8], { styles: { fontSize: 7, cellPadding: 1.2 } });

  for (const r of d.detalle) {
    const c = r.caja;
    y = asegurarEspacio(doc, y, 60);
    doc.setFillColor(244, 247, 247).rect(M, y - 4, W, 8, "F");
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(...COLOR.negro);
    doc.text(pdfTxt(`${c.punto_nombre} · ${c.sucursal_nombre} · Turno N° ${c.numero_caja}`), M + 2, y + 1.2);
    doc.setFont("helvetica", "normal").setFontSize(7.4).setTextColor(...COLOR.gris);
    doc.text(pdfTxt(`Abrió ${c.abierta_por_nombre ?? "—"} ${fechaHoraPY(c.fecha_apertura)} · ${c.fecha_cierre ? `cerró ${c.cerrada_por_nombre ?? "—"} ${fechaHoraPY(c.fecha_cierre)}` : "sigue abierta"}`),
      M + W - 2, y + 1.2, { align: "right" });
    y += 9;
    y = tablaPdf(doc, y, "ARQUEO POR FORMA DE PAGO", ["FORMA DE PAGO", "INGRESOS", "EGRESOS", "ESPERADO", "DECLARADO", "DIFERENCIA"],
      r.metodos.map((m) => [m.label, g(m.ingresos), g(m.egresos), g(m.esperado), m.declarado == null ? "—" : g(m.declarado), m.diferencia == null ? "—" : conSigno(m.diferencia)]),
      [1, 2, 3, 4, 5]);
    const e = r.efectivo;
    const filas: [string, number][] = [
      ["Monto inicial", e.apertura], ["+ Ventas en efectivo", e.ventas], ["+ Cobros", e.cobros], ["+ Ingresos", e.ingresos],
      ["- Retiros", -e.retiros], ["- Compras", -e.compras], ["- Gastos", -e.gastos], ["- Pagos a proveedores", -e.pagos_proveedores],
      ["- Devoluciones", -e.devoluciones], ["- Egresos", -e.egresos_manuales],
    ];
    y = tablaPdf(doc, y, "EFECTIVO", ["CONCEPTO", "MONTO"],
      [...filas.filter(([l, v]) => v !== 0 || l === "Monto inicial").map(([l, v]) => [l, conSigno(v)]),
        ["Esperado en caja", g(e.esperado)], ["Contado al cierre", e.contado == null ? "—" : g(e.contado)], ["Diferencia", e.diferencia == null ? "—" : conSigno(e.diferencia)]],
      [1], { tableWidth: W / 2 + 10 });
    const notas = [
      `Ventas: ${r.ventas.cantidad} (contado ${g(r.ventas.contado.total)} · crédito ${g(r.ventas.credito.total)})${r.ventas.anuladas.cantidad ? ` · anuladas ${r.ventas.anuladas.cantidad} por ${g(r.ventas.anuladas.total)}` : ""}`,
      c.motivo_diferencia ? `Motivo de la diferencia: ${c.motivo_diferencia}` : "",
      c.observacion_cierre ? `Observación: ${c.observacion_cierre}` : "",
    ].filter(Boolean);
    doc.setFont("helvetica", "normal").setFontSize(7.6).setTextColor(...COLOR.gris);
    for (const n of notas) {
      y = asegurarEspacio(doc, y, 6);
      const l = doc.splitTextToSize(pdfTxt(n), W) as string[];
      doc.text(l, M, y - 3);
      y += l.length * 4;
    }
    y += 4;
  }

  doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...COLOR.grisClaro);
  y = asegurarEspacio(doc, y, 8);
  doc.text(pdfTxt("Cada turno cuenta para el día en que se abrió (si cerró después de la medianoche, igual figura acá)."), M, y);
  pieDePagina(doc, "Cierre de caja del día · Documento no fiscal");
  return doc;
}
