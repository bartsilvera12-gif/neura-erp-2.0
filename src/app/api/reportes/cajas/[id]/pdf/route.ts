/**
 * Arqueo / detalle de un turno en PDF A4 (diseño portado de Ferretería República).
 *   GET /api/reportes/cajas/<id>/pdf → application/pdf como DESCARGA (attachment).
 * Se arma con jsPDF + autotable (vectorial: texto nítido y seleccionable, cortes de
 * página con encabezado repetido). El front lo baja con el Bearer (descargarArchivo).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { withTenant } from "@/lib/api/with-tenant";
import { ERR } from "@/lib/api/responses";
import { clienteConfig } from "@/cliente.config";
import { TZ_PY } from "@/lib/fecha/paraguay";
import { cajaIdDeUrl, estadoCajaLabel, getDetalleCaja, medioLabel } from "@/modules/caja/reporte-cajas";

export const runtime = "nodejs";

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const TEAL = hex(clienteConfig.color);
const NEGRO: RGB = [17, 17, 17];
const GRIS: RGB = [102, 102, 102];
const GRIS_CLARO: RGB = [136, 136, 136];
const BORDE: RGB = [226, 231, 239];
const VERDE: RGB = [4, 120, 87];
const ROJO: RGB = [185, 28, 28];

const gs = (v: number) => Math.round(v || 0).toLocaleString("es-PY");
const fechaHora = (iso: string) =>
  new Intl.DateTimeFormat("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const dia = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ_PY });
// Turno que cruza la medianoche → la hora sola no alcanza: se antepone dd/mm.
const horaTurno = (iso: string, conDia: boolean) =>
  new Intl.DateTimeFormat("es-PY", { timeZone: TZ_PY, ...(conDia ? { day: "2-digit", month: "2-digit" } : {}), hour: "2-digit", minute: "2-digit" })
    .format(new Date(iso))
    .replace(",", "");
// Helvetica de jsPDF es WinAnsi: el signo menos tipográfico y similares no existen.
const pdfTxt = (s: string) => s.replace(/−/g, "-").replace(/[→]/g, "->").replace(/ | /g, " ");

let logoCache: { data: string; w: number; h: number } | null | undefined;
async function logoDoc() {
  if (logoCache !== undefined) return logoCache;
  try {
    const buf = await readFile(path.join(process.cwd(), "public", "brand", "logo-doc.png"));
    // Tamaño del PNG desde el encabezado IHDR (bytes 16..23).
    logoCache = { data: `data:image/png;base64,${buf.toString("base64")}`, w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch {
    logoCache = null; // sin logo → el membrete queda solo con el nombre
  }
  return logoCache;
}

export const GET = withTenant(async (ctx, req) => {
  const id = cajaIdDeUrl(req.url);
  if (!id) return ERR.invalid("Falta el id de la caja");

  let data;
  try {
    data = await getDetalleCaja(ctx.db, id);
  } catch {
    return ERR.server();
  }
  if (!data) return ERR.notFound("turno");
  const c = data.caja;
  const conDia = dia(c.fecha_apertura) !== dia(c.fecha_cierre ?? new Date().toISOString());

  // ── Línea de tiempo (misma lógica que la pantalla) ──────────────────────────
  type Row = { ts: string; tipo: string; detalle: string; medio: string; monto: number; signo: number; tachado?: boolean };
  const timeline: Row[] = [
    { ts: c.fecha_apertura, tipo: "Apertura", detalle: c.abierta_por_nombre ? `Abrió ${c.abierta_por_nombre}` : "Apertura de caja", medio: "Efectivo", monto: c.monto_apertura, signo: 1 },
  ];
  for (const v of data.ventas) {
    const credito = v.tipo_venta === "CREDITO";
    timeline.push({
      ts: v.fecha,
      tipo: "Venta",
      detalle: `${v.numero_control ?? "Venta"}${v.tipo_venta ? ` · ${v.tipo_venta}` : ""}`,
      medio: credito ? "Crédito" : v.medios.length ? v.medios.map(medioLabel).join(" + ") : medioLabel(v.metodo_pago),
      monto: v.total,
      signo: 1,
      tachado: v.estado === "anulada",
    });
  }
  for (const m of data.movimientos) {
    const entrada = m.tipo === "ingreso" || (m.tipo === "ajuste" && m.monto >= 0);
    const tipo = m.tipo === "ingreso" ? "Ingreso" : m.tipo === "egreso" ? "Egreso" : m.tipo === "retiro" ? "Retiro" : "Ajuste";
    const autor = m.usuario_nombre || m.usuario_email;
    timeline.push({ ts: m.created_at, tipo, detalle: autor ? `${m.concepto} · ${autor}` : m.concepto, medio: medioLabel(m.medio_pago), monto: Math.abs(m.monto), signo: entrada ? 1 : -1 });
  }
  timeline.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  // ── Documento ───────────────────────────────────────────────────────────────
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const M = 15; // margen
  const W = 210 - M * 2; // ancho útil
  const der = M + W;
  let y = M;

  // Membrete: logo a la izquierda, datos de la empresa a la derecha, línea divisoria.
  const logo = await logoDoc();
  let altoMembrete = 12;
  if (logo) {
    const h = 15;
    const w = Math.min(45, (logo.w / logo.h) * h);
    doc.addImage(logo.data, "PNG", M, y, w, (w * logo.h) / logo.w, "logo", "FAST");
    altoMembrete = Math.max(altoMembrete, (w * logo.h) / logo.w);
  }
  doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(31, 41, 55);
  doc.text(pdfTxt(clienteConfig.nombre), der, y + 4, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(107, 114, 128);
  doc.text(clienteConfig.dominio, der, y + 9, { align: "right" });
  doc.text("Paraguay", der, y + 13, { align: "right" });
  y += altoMembrete + 3;
  doc.setDrawColor(...TEAL).setLineWidth(0.6).line(M, y, der, y);
  y += 6;

  // Título en recuadro.
  doc.setDrawColor(...NEGRO).setLineWidth(0.6).rect(M, y, W, 9);
  doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(...NEGRO);
  doc.text("ARQUEO DE CAJA", M + W / 2, y + 6.1, { align: "center", charSpace: 0.4 });
  y += 14;

  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(85, 85, 85);
  doc.text(pdfTxt(`Caja ${c.numero_caja} · ${estadoCajaLabel(c.estado)}`), M + W / 2, y, { align: "center" });
  y += 5.5;

  // Línea meta: "Etiqueta: valor" con el valor en negrita, centrada.
  const meta: [string, string][] = [
    ["Apertura: ", fechaHora(c.fecha_apertura)],
    ["Cierre: ", c.fecha_cierre ? fechaHora(c.fecha_cierre) : "— en curso"],
  ];
  if (c.abierta_por_nombre) meta.push(["Abrió: ", c.abierta_por_nombre]);
  if (c.cerrada_por_nombre) meta.push(["Cerró: ", c.cerrada_por_nombre]);
  doc.setFontSize(8);
  const anchoPar = ([l, v]: [string, string]) =>
    doc.setFont("helvetica", "normal").getTextWidth(pdfTxt(l)) + doc.setFont("helvetica", "bold").getTextWidth(pdfTxt(v));
  const sep = 6;
  const total = meta.reduce((a, p) => a + anchoPar(p), 0) + sep * (meta.length - 1);
  let x = M + (W - total) / 2;
  for (const p of meta) {
    doc.setFont("helvetica", "normal").setTextColor(...GRIS);
    doc.text(pdfTxt(p[0]), x, y);
    x += doc.getTextWidth(pdfTxt(p[0]));
    doc.setFont("helvetica", "bold").setTextColor(...NEGRO);
    doc.text(pdfTxt(p[1]), x, y);
    x += doc.getTextWidth(pdfTxt(p[1])) + sep;
  }
  y += 11;

  // ── Resumen gerencial: dos bloques tipo estado contable ────────────────────
  //   izq: ventas por medio de pago (con participación) → total vendido
  //   der: conciliación del efectivo → esperado vs. contado → diferencia
  const dif = c.diferencia;
  const colW = (W - 8) / 2;
  const xIzq = M;
  const xDer = M + colW + 8;
  const FILA = 5.6;
  const titulo = (txt: string, x: number, yy: number) => {
    doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(...TEAL);
    doc.text(txt, x, yy, { charSpace: 0.2 });
    doc.setDrawColor(...TEAL).setLineWidth(0.35).line(x, yy + 1.6, x + colW, yy + 1.6);
  };
  const fila = (
    x: number, yy: number, label: string, valor: string,
    o: { bold?: boolean; color?: RGB; tam?: number; gris?: boolean } = {},
  ) => {
    doc.setFont("helvetica", o.bold ? "bold" : "normal").setFontSize(o.tam ?? 8.2).setTextColor(...(o.gris ? GRIS : NEGRO));
    doc.text(pdfTxt(label), x, yy);
    doc.setTextColor(...(o.color ?? (o.gris ? GRIS : NEGRO)));
    doc.text(pdfTxt(valor), x + colW, yy, { align: "right" });
  };
  const linea = (x: number, yy: number, grosor = 0.2, color: RGB = [210, 214, 220]) =>
    doc.setDrawColor(...color).setLineWidth(grosor).line(x, yy, x + colW, yy);

  const y0 = y;

  // Bloque izquierdo: ventas por medio de pago.
  titulo("VENTAS POR MEDIO DE PAGO", xIzq, y0);
  const contado = c.total_efectivo + c.total_tarjeta + c.total_pos + c.total_transferencia + c.total_otros;
  const medios: [string, number][] = [
    ["Efectivo", c.total_efectivo],
    ["Tarjeta", c.total_tarjeta],
    ["POS", c.total_pos],
    ["Transferencia", c.total_transferencia],
  ];
  if (c.total_otros) medios.push(["Otros medios", c.total_otros]);
  let yi = y0 + 7;
  doc.setFont("helvetica", "bold").setFontSize(6.6).setTextColor(...GRIS_CLARO);
  doc.text("MEDIO", xIzq, yi);
  doc.text("PARTICIPACIÓN", xIzq + 30, yi);
  doc.text("MONTO", xIzq + colW, yi, { align: "right" });
  yi += 5;
  const barX = xIzq + 30;
  const barW = colW - 30 - 34;
  for (const [lbl, v] of medios) {
    const pct = contado > 0 ? v / contado : 0;
    fila(xIzq, yi, lbl, `Gs. ${gs(v)}`, { gris: v === 0 });
    // Barra de participación sobre lo cobrado de contado.
    doc.setFillColor(236, 240, 241).rect(barX, yi - 2.4, barW, 2.6, "F");
    if (pct > 0) doc.setFillColor(...TEAL).rect(barX, yi - 2.4, Math.max(0.6, barW * pct), 2.6, "F");
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...GRIS);
    doc.text(`${Math.round(pct * 100)}%`, barX + barW + 2, yi);
    yi += FILA;
  }
  linea(xIzq, yi - 3.6);
  yi += 1;
  fila(xIzq, yi, "Ventas de contado", `Gs. ${gs(contado)}`, { bold: true });
  yi += FILA;
  fila(xIzq, yi, "Crédito (no ingresa a caja)", `Gs. ${gs(c.total_credito)}`, { gris: c.total_credito === 0 });
  yi += 2.2;
  linea(xIzq, yi, 0.5, NEGRO);
  yi += 4.8;
  fila(xIzq, yi, `TOTAL VENDIDO · ${c.cantidad_ventas} venta${c.cantidad_ventas === 1 ? "" : "s"}`, `Gs. ${gs(c.total_vendido)}`, { bold: true, tam: 9, color: TEAL });
  yi += 2;

  // Bloque derecho: conciliación del efectivo.
  titulo("CONCILIACIÓN DEL EFECTIVO", xDer, y0);
  let yd = y0 + 12;
  const signo = (v: number, neg = false) => (v === 0 ? "Gs. 0" : `${neg ? "- " : "+ "}Gs. ${gs(Math.abs(v))}`);
  fila(xDer, yd, "Fondo de apertura", `Gs. ${gs(c.monto_apertura)}`);
  yd += FILA;
  fila(xDer, yd, "(+) Ventas en efectivo", signo(c.total_efectivo), { gris: c.total_efectivo === 0 });
  yd += FILA;
  fila(xDer, yd, "(+) Ingresos manuales", signo(c.ingresos_efectivo), { gris: c.ingresos_efectivo === 0 });
  yd += FILA;
  fila(xDer, yd, "(-) Egresos", signo(c.egresos_efectivo, true), { gris: c.egresos_efectivo === 0, color: c.egresos_efectivo ? ROJO : undefined });
  yd += FILA;
  fila(xDer, yd, "(-) Retiros", signo(c.retiros_efectivo, true), { gris: c.retiros_efectivo === 0, color: c.retiros_efectivo ? ROJO : undefined });
  yd += FILA;
  if (c.ajustes_efectivo) {
    fila(xDer, yd, "(±) Ajustes", signo(c.ajustes_efectivo, c.ajustes_efectivo < 0));
    yd += FILA;
  }
  linea(xDer, yd - 3.6);
  yd += 1;
  fila(xDer, yd, "= Efectivo esperado", `Gs. ${gs(c.efectivo_esperado)}`, { bold: true });
  yd += FILA;
  fila(xDer, yd, "Efectivo contado al cierre", c.monto_cierre_contado == null ? "—" : `Gs. ${gs(c.monto_cierre_contado)}`);
  yd += 2.2;
  linea(xDer, yd, 0.5, NEGRO);
  yd += 1.6;

  // Diferencia: franja de color con el estado (cuadra / faltante / sobrante).
  const est =
    dif == null ? { txt: "TURNO ABIERTO", col: GRIS, fondo: [243, 244, 246] as RGB }
    : dif === 0 ? { txt: "CUADRA", col: VERDE, fondo: [236, 253, 245] as RGB }
    : dif < 0 ? { txt: "FALTANTE", col: ROJO, fondo: [254, 242, 242] as RGB }
    : { txt: "SOBRANTE", col: [180, 83, 9] as RGB, fondo: [255, 251, 235] as RGB };
  doc.setFillColor(...est.fondo).rect(xDer, yd, colW, 7, "F");
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(...est.col);
  doc.text(`DIFERENCIA · ${est.txt}`, xDer + 2, yd + 4.7);
  doc.text(dif == null ? "—" : `${dif > 0 ? "+ " : dif < 0 ? "- " : ""}Gs. ${gs(Math.abs(dif))}`, xDer + colW - 2, yd + 4.7, { align: "right" });
  yd += 7;

  y = Math.max(yi, yd) + 9;

  // Movimientos del turno.
  doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(...TEAL);
  doc.text("MOVIMIENTOS DEL TURNO", M, y, { charSpace: 0.2 });
  y += 2.5;

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, bottom: 16 },
    head: [["HORA", "MOVIMIENTO", "DETALLE", "MÉTODO", "MONTO"]],
    body: timeline.map((r) => [
      pdfTxt(horaTurno(r.ts, conDia)),
      r.tipo,
      pdfTxt(r.detalle + (r.tachado ? " (anulada)" : "")),
      pdfTxt(r.medio),
      `${r.signo < 0 ? "-" : "+"}${gs(r.monto)}`,
    ]),
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8, cellPadding: { top: 1.6, bottom: 1.6, left: 2.2, right: 2.2 }, lineColor: [220, 220, 220], lineWidth: 0.2, textColor: NEGRO, valign: "middle" },
    headStyles: { fillColor: [244, 247, 247], textColor: TEAL, fontStyle: "bold", fontSize: 7 },
    columnStyles: {
      0: { font: "courier", cellWidth: conDia ? 32 : 23, overflow: "visible" },
      1: { cellWidth: 22 },
      3: { cellWidth: 28 },
      4: { halign: "right", cellWidth: 24 },
    },
    didParseCell: (h) => {
      if (h.section === "head" && h.column.index === 4) h.cell.styles.halign = "right";
      if (h.section !== "body") return;
      const r = timeline[h.row.index];
      if (r.tachado) h.cell.styles.textColor = ROJO;
      else if (h.column.index === 4) h.cell.styles.textColor = r.signo < 0 ? ROJO : VERDE;
    },
    didDrawCell: (h) => {
      // Venta anulada: tachado sobre el texto, como en pantalla.
      if (h.section !== "body" || !timeline[h.row.index].tachado) return;
      const tw = doc.getTextWidth(String(h.cell.text.join(" ")));
      const ty = h.cell.y + h.cell.height / 2;
      const x0 = h.cell.styles.halign === "right" ? h.cell.x + h.cell.width - 2.2 - tw : h.cell.x + 2.2;
      doc.setDrawColor(...ROJO).setLineWidth(0.2).line(x0, ty, x0 + tw, ty);
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;

  // Observación de cierre.
  if (c.observacion_cierre) {
    doc.setFontSize(8);
    const lineas = doc.splitTextToSize(pdfTxt(`Observación de cierre: ${c.observacion_cierre}`), W - 6) as string[];
    const alto = lineas.length * 3.6 + 4;
    if (y + alto > 297 - 18) { doc.addPage(); y = M; }
    doc.setDrawColor(...BORDE).setFillColor(250, 250, 250).setLineWidth(0.25).roundedRect(M, y, W, alto, 1.2, 1.2, "FD");
    const etiqueta = "Observación de cierre: ";
    doc.setFont("helvetica", "bold").setTextColor(...NEGRO).text(etiqueta, M + 3, y + 4.6);
    const anchoEtq = doc.getTextWidth(etiqueta); // medido en negrita, que es como se dibujó
    const resto = doc.splitTextToSize(pdfTxt(c.observacion_cierre), W - 6 - anchoEtq) as string[];
    doc.setFont("helvetica", "normal").text(resto, M + 3 + anchoEtq, y + 4.6, { lineHeightFactor: 1.25 });
    y += alto + 4;
  }

  // Pie en todas las páginas: leyenda + numeración.
  const paginas = doc.getNumberOfPages();
  const generado = fechaHora(new Date().toISOString());
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p);
    doc.setDrawColor(187, 187, 187).setLineWidth(0.2).setLineDashPattern([0.8, 0.8], 0).line(M, 297 - 12, der, 297 - 12).setLineDashPattern([], 0);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...GRIS);
    doc.text(pdfTxt(`Arqueo generado desde ${clienteConfig.nombre} · ${generado} · Documento no fiscal`), M, 297 - 8);
    doc.text(`Página ${p} de ${paginas}`, der, 297 - 8, { align: "right" });
  }

  const nombre = `arqueo-caja-${c.numero_caja}-${dia(c.fecha_apertura)}.pdf`;
  return new Response(doc.output("arraybuffer"), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${nombre}"`,
      "cache-control": "no-store",
    },
  });
});
