/**
 * Piezas de PDF para los reportes (sobre documento.ts): tabla con título de sección,
 * tarjetas de números clave y renglones "concepto ...... monto". Solo servidor.
 */
import autoTable, { type UserOptions } from "jspdf-autotable";
import type { jsPDF } from "jspdf";
import { asegurarEspacio, COLOR, M, pdfTxt, tituloSeccion, W, type RGB } from "@/lib/pdf/documento";

/** Tabla con su título. Devuelve la Y siguiente. */
export function tablaPdf(
  doc: jsPDF, y: number, titulo: string, head: string[], body: (string | number)[][], derecha: number[],
  extra: Partial<UserOptions> & { pie?: (string | number)[] } = {},
): number {
  y = asegurarEspacio(doc, y, 22);
  tituloSeccion(doc, titulo, M, y);
  const { pie, ...resto } = extra;
  autoTable(doc, {
    startY: y + 3,
    margin: { left: M, right: M, bottom: 16 },
    head: [head],
    body: body.length ? body.map((r) => r.map((c) => pdfTxt(String(c)))) : [[{ content: "Sin datos", colSpan: head.length, styles: { halign: "center", textColor: COLOR.gris } }]],
    foot: pie ? [pie.map((c) => pdfTxt(String(c)))] : undefined,
    theme: "grid",
    styles: { font: "helvetica", fontSize: 7.6, cellPadding: { top: 1.3, bottom: 1.3, left: 1.8, right: 1.8 }, lineColor: [220, 220, 220], lineWidth: 0.2, textColor: COLOR.negro },
    headStyles: { fillColor: [244, 247, 247], textColor: COLOR.teal, fontStyle: "bold", fontSize: 6.9 },
    footStyles: { fillColor: [248, 250, 252], textColor: COLOR.negro, fontStyle: "bold" },
    columnStyles: Object.fromEntries(derecha.map((i) => [i, { halign: "right" as const }])),
    didParseCell: (h) => {
      if ((h.section === "head" || h.section === "foot") && derecha.includes(h.column.index)) h.cell.styles.halign = "right";
    },
    ...resto,
  });
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
}

/** Tarjetas de números clave (4 por fila). */
export function kpisPdf(doc: jsPDF, y: number, items: { label: string; valor: string; sub?: string; color?: RGB }[], porFila = 4): number {
  const gap = 3;
  const w = (W - gap * (porFila - 1)) / porFila;
  const h = 15;
  for (let i = 0; i < items.length; i++) {
    const col = i % porFila;
    if (col === 0 && i > 0) y += h + gap;
    if (col === 0) y = asegurarEspacio(doc, y, h + 2);
    const x = M + col * (w + gap);
    const it = items[i];
    doc.setDrawColor(...COLOR.borde).setLineWidth(0.3).roundedRect(x, y, w, h, 1.5, 1.5);
    doc.setFont("helvetica", "bold").setFontSize(6.4).setTextColor(...COLOR.grisClaro);
    doc.text(pdfTxt(it.label.toUpperCase()), x + 2.5, y + 4.2);
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...(it.color ?? COLOR.negro));
    doc.text(pdfTxt(it.valor), x + 2.5, y + 9.6);
    if (it.sub) {
      doc.setFont("helvetica", "normal").setFontSize(6.4).setTextColor(...COLOR.gris);
      doc.text(pdfTxt(it.sub), x + 2.5, y + 13.2, { maxWidth: w - 4 });
    }
  }
  return y + h + 7;
}

/** Renglón "concepto ......... monto" (estado de resultados). */
export function renglon(doc: jsPDF, y: number, label: string, valor: string, o: { bold?: boolean; color?: RGB; gris?: boolean; sangria?: number; linea?: boolean; x?: number; ancho?: number } = {}) {
  const x = o.x ?? M;
  const ancho = o.ancho ?? W;
  if (o.linea) doc.setDrawColor(...COLOR.negro).setLineWidth(0.4).line(x, y - 3.8, x + ancho, y - 3.8);
  doc.setFont("helvetica", o.bold ? "bold" : "normal").setFontSize(o.bold ? 8.8 : 8.2).setTextColor(...(o.gris ? COLOR.gris : COLOR.negro));
  doc.text(pdfTxt(label), x + (o.sangria ?? 0), y);
  doc.setTextColor(...(o.color ?? (o.gris ? COLOR.gris : COLOR.negro)));
  doc.text(pdfTxt(valor), x + ancho, y, { align: "right" });
  return y + 5.4;
}
