/**
 * Cierre de caja (arqueo de un turno) en PDF A4. Sale de resumen_turno (receta 51): arqueo
 * por forma de pago (esperado / declarado / diferencia), conciliación del efectivo, ventas
 * contado y crédito, crédito otorgado, cobros, egresos, retiros e ingresos, movimientos y
 * firmas. Con el turno abierto sale como "Arqueo parcial". Solo servidor.
 */
import type { DatosEmpresa } from "@/modules/empresa/tipos";
import autoTable from "jspdf-autotable";
import type { jsPDF } from "jspdf";
import { TZ_PY } from "@/lib/fecha/paraguay";
import { asegurarEspacio, COLOR, encabezado, fechaHoraPY, gs, M, nuevoDocumento, pdfTxt, pieDePagina, tituloSeccion, W, type RGB } from "@/lib/pdf/documento";
import type { ResumenTurno } from "@/modules/caja/turno";

const hora = (iso: string, conDia: boolean) =>
  new Intl.DateTimeFormat("es-PY", { timeZone: TZ_PY, ...(conDia ? { day: "2-digit", month: "2-digit" } : {}), hour: "2-digit", minute: "2-digit" })
    .format(new Date(iso))
    .replace(",", "");
const dia = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ_PY });
const fechaCorta = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
const conSigno = (v: number) => (v === 0 ? "0" : `${v > 0 ? "+" : "-"}${gs(Math.abs(v))}`);

const ORIGEN: Record<string, string> = {
  venta: "Venta",
  devolucion: "Devolución",
  cobro: "Cobro",
  compra: "Compra",
  gasto: "Gasto",
  pago_proveedor: "Pago a proveedor",
};

export async function pdfCierreCaja(r: ResumenTurno, empresa?: DatosEmpresa | null) {
  const c = r.caja;
  const cerrada = c.estado === "cerrada";
  const doc = nuevoDocumento(empresa);
  let y = await encabezado(
    doc,
    cerrada ? "CIERRE DE CAJA" : "ARQUEO PARCIAL DE CAJA",
    `${c.punto_nombre} · ${c.sucursal_nombre} · Turno N° ${c.numero_caja}${cerrada ? "" : " · en curso"}`,
  );
  const conDia = dia(c.fecha_apertura) !== dia(c.fecha_cierre ?? new Date().toISOString());

  // ── Datos del turno (dos columnas) ─────────────────────────────────────────
  const col = (W - 8) / 2;
  const filas = (lista: [string, string][], x: number, y0: number) => {
    let yy = y0;
    for (const [l, v] of lista) {
      doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...COLOR.gris);
      doc.text(pdfTxt(l), x, yy);
      doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(...COLOR.negro);
      const txt = doc.splitTextToSize(pdfTxt(v || "—"), col - 30) as string[];
      doc.text(txt, x + 30, yy);
      yy += 4.6 * txt.length;
    }
    return yy;
  };
  y = Math.max(
    filas([
      ["Apertura", `${fechaHoraPY(c.fecha_apertura)} · ${c.abierta_por_nombre ?? "—"}`],
      ["Cierre", c.fecha_cierre ? `${fechaHoraPY(c.fecha_cierre)} · ${c.cerrada_por_nombre ?? "—"}` : "En curso"],
      ["Depósito de salida", c.deposito_nombre],
    ], M, y),
    filas([
      ["Monto inicial", `Gs. ${gs(c.monto_apertura)}`],
      ["Ventas", `${r.ventas.cantidad} · Gs. ${gs(r.ventas.total)}`],
      ["Anuladas", r.ventas.anuladas.cantidad ? `${r.ventas.anuladas.cantidad} · Gs. ${gs(r.ventas.anuladas.total)}` : "Ninguna"],
    ], M + col + 8, y),
  ) + 4;

  // ── Arqueo por forma de pago ───────────────────────────────────────────────
  tituloSeccion(doc, "ARQUEO POR FORMA DE PAGO", M, y);
  y += 2.5;
  const metodos = r.metodos;
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, bottom: 16 },
    head: [["FORMA DE PAGO", "ENTRADAS", "SALIDAS", "ESPERADO", cerrada ? "DECLARADO" : "", cerrada ? "DIFERENCIA" : ""]],
    body: metodos.map((m) => [
      pdfTxt(m.metodo === "efectivo" ? `${m.label} (contado)` : m.label),
      gs(m.ingresos + (m.metodo === "efectivo" ? c.monto_apertura : 0)),
      m.egresos ? `-${gs(m.egresos)}` : "0",
      gs(m.esperado),
      cerrada ? gs(m.declarado ?? m.esperado) : "",
      cerrada ? conSigno(m.diferencia ?? 0) : "",
    ]),
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8, cellPadding: { top: 1.6, bottom: 1.6, left: 2.2, right: 2.2 }, lineColor: [220, 220, 220], lineWidth: 0.2, textColor: COLOR.negro },
    headStyles: { fillColor: [244, 247, 247], textColor: COLOR.teal, fontStyle: "bold", fontSize: 7 },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right", fontStyle: "bold" }, 4: { halign: "right" }, 5: { halign: "right", fontStyle: "bold" } },
    didParseCell: (h) => {
      if (h.section === "head" && h.column.index > 0) h.cell.styles.halign = "right";
      if (h.section === "body" && h.column.index === 5) {
        const d = metodos[h.row.index].diferencia ?? 0;
        h.cell.styles.textColor = d === 0 ? COLOR.verde : d < 0 ? COLOR.rojo : COLOR.ambar;
      }
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // ── Ventas (izq.) y conciliación del efectivo (der.) ──────────────────────
  y = asegurarEspacio(doc, y, 72);
  const xIzq = M;
  const xDer = M + col + 8;
  const FILA = 5.2;
  const fila = (x: number, yy: number, label: string, valor: string, o: { bold?: boolean; color?: RGB; gris?: boolean; tam?: number } = {}) => {
    doc.setFont("helvetica", o.bold ? "bold" : "normal").setFontSize(o.tam ?? 8.2).setTextColor(...(o.gris ? COLOR.gris : COLOR.negro));
    doc.text(pdfTxt(label), x, yy);
    doc.setTextColor(...(o.color ?? (o.gris ? COLOR.gris : COLOR.negro)));
    doc.text(pdfTxt(valor), x + col, yy, { align: "right" });
  };
  const linea = (x: number, yy: number, grosor = 0.2, color: RGB = [210, 214, 220]) => doc.setDrawColor(...color).setLineWidth(grosor).line(x, yy, x + col, yy);

  tituloSeccion(doc, "VENTAS DEL TURNO", xIzq, y, col);
  tituloSeccion(doc, "EFECTIVO", xDer, y, col);
  let yi = y + 7;
  for (const m of r.ventas.por_metodo) {
    fila(xIzq, yi, `${m.label} (${m.cantidad})`, `Gs. ${gs(m.total)}`);
    yi += FILA;
  }
  if (!r.ventas.por_metodo.length) { fila(xIzq, yi, "Sin ventas de contado", "Gs. 0", { gris: true }); yi += FILA; }
  linea(xIzq, yi - 3.4);
  fila(xIzq, yi, `Contado (${r.ventas.contado.cantidad})`, `Gs. ${gs(r.ventas.contado.total)}`, { bold: true });
  yi += FILA;
  fila(xIzq, yi, `Crédito (${r.ventas.credito.cantidad}) · no entra a la caja`, `Gs. ${gs(r.ventas.credito.total)}`, { gris: !r.ventas.credito.total });
  yi += 2;
  linea(xIzq, yi, 0.5, COLOR.negro);
  yi += 4.6;
  fila(xIzq, yi, `TOTAL VENDIDO · ${r.ventas.cantidad}`, `Gs. ${gs(r.ventas.total)}`, { bold: true, color: COLOR.teal, tam: 9 });
  yi += FILA + 1;
  if (r.cobros.cantidad) {
    fila(xIzq, yi, `Cobros de cuentas (${r.cobros.cantidad})`, `Gs. ${gs(r.cobros.total)}`);
    yi += FILA;
    for (const m of r.cobros.por_metodo) {
      fila(xIzq + 3, yi, m.label, `Gs. ${gs(m.total)}`, { gris: true, tam: 7.6 });
      yi += 4.4;
    }
  }

  const e = r.efectivo;
  let yd = y + 7;
  const sumar = (label: string, v: number, neg = false) => {
    fila(xDer, yd, label, v === 0 ? "Gs. 0" : `${neg ? "- " : "+ "}Gs. ${gs(v)}`, { gris: v === 0, color: v && neg ? COLOR.rojo : undefined });
    yd += FILA;
  };
  fila(xDer, yd, "Monto inicial", `Gs. ${gs(e.apertura)}`);
  yd += FILA;
  sumar("(+) Ventas en efectivo", e.ventas);
  sumar("(+) Cobros en efectivo", e.cobros);
  sumar("(+) Ingresos de efectivo", e.ingresos);
  if (e.compras) sumar("(-) Compras", e.compras, true);
  if (e.gastos) sumar("(-) Gastos", e.gastos, true);
  if (e.pagos_proveedores) sumar("(-) Pagos a proveedores", e.pagos_proveedores, true);
  if (e.devoluciones) sumar("(-) Devoluciones", e.devoluciones, true);
  if (e.egresos_manuales) sumar("(-) Otros egresos", e.egresos_manuales, true);
  sumar("(-) Retiros", e.retiros, true);
  if (e.ajustes) sumar("(±) Ajustes", e.ajustes);
  linea(xDer, yd - 3.4);
  fila(xDer, yd, "= Efectivo esperado", `Gs. ${gs(e.esperado)}`, { bold: true });
  yd += FILA;
  fila(xDer, yd, "Efectivo contado", e.contado == null ? "—" : `Gs. ${gs(e.contado)}`);
  yd += 2;
  linea(xDer, yd, 0.5, COLOR.negro);
  yd += 1.6;
  const dif = e.diferencia;
  const est =
    dif == null ? { txt: "TURNO ABIERTO", col: COLOR.gris, fondo: [243, 244, 246] as RGB }
    : dif === 0 ? { txt: "CUADRA", col: COLOR.verde, fondo: [236, 253, 245] as RGB }
    : dif < 0 ? { txt: "FALTANTE", col: COLOR.rojo, fondo: [254, 242, 242] as RGB }
    : { txt: "SOBRANTE", col: COLOR.ambar, fondo: [255, 251, 235] as RGB };
  doc.setFillColor(...est.fondo).rect(xDer, yd, col, 7, "F");
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(...est.col);
  doc.text(`DIFERENCIA · ${est.txt}`, xDer + 2, yd + 4.7);
  doc.text(dif == null ? "—" : `${dif > 0 ? "+ " : dif < 0 ? "- " : ""}Gs. ${gs(Math.abs(dif))}`, xDer + col - 2, yd + 4.7, { align: "right" });
  yd += 11;
  y = Math.max(yi, yd) + 3;

  // ── Motivo de la diferencia / observaciones ────────────────────────────────
  const notas: [string, string][] = [];
  if (c.motivo_diferencia) notas.push(["Motivo de la diferencia: ", c.motivo_diferencia]);
  if (c.observacion_cierre) notas.push(["Observación de cierre: ", c.observacion_cierre]);
  if (c.observacion_apertura) notas.push(["Observación de apertura: ", c.observacion_apertura]);
  for (const [et, txt] of notas) {
    doc.setFontSize(8);
    const ancho = doc.setFont("helvetica", "bold").getTextWidth(et);
    const resto = doc.setFont("helvetica", "normal").splitTextToSize(pdfTxt(txt), W - 6 - ancho) as string[];
    const alto = resto.length * 3.6 + 4;
    y = asegurarEspacio(doc, y, alto);
    doc.setDrawColor(...COLOR.borde).setFillColor(250, 250, 250).setLineWidth(0.25).roundedRect(M, y, W, alto, 1.2, 1.2, "FD");
    doc.setFont("helvetica", "bold").setTextColor(...COLOR.negro).text(et, M + 3, y + 4.6);
    doc.setFont("helvetica", "normal").text(resto, M + 3 + ancho, y + 4.6, { lineHeightFactor: 1.25 });
    y += alto + 3;
  }

  // ── Billetes contados ──────────────────────────────────────────────────────
  const billetes = Object.entries(c.billetes ?? {}).filter(([, n]) => Number(n) > 0).sort((a, b) => Number(b[0]) - Number(a[0]));
  if (billetes.length) {
    y = asegurarEspacio(doc, y + 2, 14);
    tituloSeccion(doc, "CONTEO DEL EFECTIVO", M, y);
    y += 6;
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...COLOR.negro);
    const txt = billetes.map(([d, n]) => `${n} x ${gs(Number(d))} = ${gs(Number(d) * Number(n))}`).join("   ·   ");
    const lineas = doc.splitTextToSize(pdfTxt(txt), W) as string[];
    doc.text(lineas, M, y);
    y += lineas.length * 4 + 3;
  }

  // ── Crédito otorgado ───────────────────────────────────────────────────────
  if (r.credito.ventas.length) {
    y = asegurarEspacio(doc, y + 2, 24);
    tituloSeccion(doc, `CRÉDITO OTORGADO · ${r.credito.cantidad} venta${r.credito.cantidad === 1 ? "" : "s"} · Gs. ${gs(r.credito.total)}`, M, y);
    y += 2.5;
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M, bottom: 16 },
      head: [["VENTA", "CLIENTE", "VENCE", "TOTAL", "SALDO", "ESTADO"]],
      body: r.credito.ventas.map((v) => [
        v.numero_control,
        pdfTxt(`${v.cliente_nombre ?? "—"}${v.cliente_ruc ? ` (${v.cliente_ruc})` : ""}`),
        fechaCorta(v.vencimiento),
        gs(v.total),
        v.estado === "anulada" ? "—" : gs(v.saldo ?? 0),
        v.estado === "anulada" ? "Anulada" : (v.estado_cuenta ?? "pendiente").replace(/^./, (x) => x.toUpperCase()),
      ]),
      theme: "grid",
      styles: { font: "helvetica", fontSize: 7.8, cellPadding: { top: 1.4, bottom: 1.4, left: 2, right: 2 }, lineColor: [220, 220, 220], lineWidth: 0.2, textColor: COLOR.negro },
      headStyles: { fillColor: [244, 247, 247], textColor: COLOR.teal, fontStyle: "bold", fontSize: 7 },
      columnStyles: { 0: { font: "courier", cellWidth: 26 }, 2: { cellWidth: 20 }, 3: { halign: "right", cellWidth: 24 }, 4: { halign: "right", cellWidth: 24 }, 5: { cellWidth: 20 } },
      didParseCell: (h) => {
        if (h.section === "head" && (h.column.index === 3 || h.column.index === 4)) h.cell.styles.halign = "right";
        if (h.section === "body" && r.credito.ventas[h.row.index].estado === "anulada") h.cell.styles.textColor = COLOR.rojo;
      },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  // ── Movimientos del turno ──────────────────────────────────────────────────
  const movs = r.movimientos;
  y = asegurarEspacio(doc, y + 2, 24);
  tituloSeccion(doc, "MOVIMIENTOS DEL TURNO", M, y);
  y += 2.5;
  const tipoMov = (m: (typeof movs)[number]) =>
    m.origen !== "manual" ? ORIGEN[m.origen] : m.tipo === "retiro" ? "Retiro" : m.tipo === "ingreso" ? "Ingreso" : m.tipo === "egreso" ? "Egreso" : "Ajuste";
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, bottom: 16 },
    head: [["HORA", "MOVIMIENTO", "DETALLE", "FORMA", "MONTO"]],
    body: movs.length
      ? movs.map((m) => [
          pdfTxt(hora(m.created_at, conDia)),
          tipoMov(m),
          pdfTxt(`${m.concepto}${m.referencia ? ` · ref. ${m.referencia}` : ""}${m.usuario_nombre ? ` · ${m.usuario_nombre}` : ""}${m.anulado ? " (anulado)" : ""}`),
          pdfTxt(m.metodo_label),
          `${m.signo < 0 ? "-" : "+"}${gs(m.monto)}`,
        ])
      : [["", "", "Sin movimientos", "", ""]],
    theme: "grid",
    styles: { font: "helvetica", fontSize: 7.8, cellPadding: { top: 1.4, bottom: 1.4, left: 2, right: 2 }, lineColor: [220, 220, 220], lineWidth: 0.2, textColor: COLOR.negro, valign: "middle" },
    headStyles: { fillColor: [244, 247, 247], textColor: COLOR.teal, fontStyle: "bold", fontSize: 7 },
    columnStyles: { 0: { font: "courier", cellWidth: conDia ? 26 : 16 }, 1: { cellWidth: 26 }, 3: { cellWidth: 28 }, 4: { halign: "right", cellWidth: 24 } },
    didParseCell: (h) => {
      if (h.section === "head" && h.column.index === 4) h.cell.styles.halign = "right";
      if (h.section !== "body" || !movs.length) return;
      const m = movs[h.row.index];
      if (m.anulado) h.cell.styles.textColor = COLOR.gris;
      else if (h.column.index === 4) h.cell.styles.textColor = m.signo < 0 ? COLOR.rojo : COLOR.verde;
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;

  // ── Firmas ─────────────────────────────────────────────────────────────────
  firmas(doc, y, c.cerrada_por_nombre ?? c.abierta_por_nombre);

  pieDePagina(doc, cerrada ? "Cierre de caja · Documento no fiscal" : "Arqueo parcial · Documento no fiscal");
  return doc;
}

function firmas(doc: jsPDF, y0: number, cajero: string | null) {
  const y = asegurarEspacio(doc, y0, 22) + 10;
  const ancho = 70;
  const lugares: [number, string][] = [[M + 5, `Cajero${cajero ? ` · ${cajero}` : ""}`], [M + W - ancho - 5, "Supervisor / Administración"]];
  for (const [x, txt] of lugares) {
    doc.setDrawColor(...COLOR.negro).setLineWidth(0.3).line(x, y, x + ancho, y);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...COLOR.gris);
    doc.text(pdfTxt(txt), x + ancho / 2, y + 4, { align: "center" });
  }
}
