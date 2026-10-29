/**
 * Nota de crédito en PDF A4 (receta 99), con el membrete y el logo de la empresa: venta que
 * corrige, cliente, motivo, productos devueltos (si volvieron al stock) o el descuento, IVA,
 * total y a dónde fue la plata (deuda de la venta, devolución desde caja, saldo a favor).
 * Hasta que se envíe a la SET es un documento interno (no fiscal). Solo servidor.
 */
import type { DatosEmpresa } from "@/modules/empresa/tipos";
import autoTable from "jspdf-autotable";
import { COLOR, encabezado, fechaHoraPY, gs, M, nuevoDocumento, pdfTxt, pieDePagina, tituloSeccion, W } from "@/lib/pdf/documento";
import { numeroEnLetras } from "@/lib/pdf/letras";
import type { NotaCreditoDetalle } from "@/modules/caja/notas-credito";

const fechaCorta = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
const finY = (doc: unknown) => (doc as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
const FORMA: Record<string, string> = {
  efectivo: "efectivo", transferencia: "transferencia", tarjeta_debito: "tarjeta de débito", tarjeta_credito: "tarjeta de crédito",
  qr: "QR / billetera", cheque: "cheque", otro: "otra forma",
};
const cant = (n: number) => Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });

export async function pdfNotaCredito(d: NotaCreditoDetalle, empresa?: DatosEmpresa | null) {
  const n = d.nota;
  const doc = nuevoDocumento(empresa);
  let y = await encabezado(doc, `NOTA DE CRÉDITO ${n.numero}`, fechaHoraPY(n.fecha));

  if (n.estado === "anulada") {
    doc.setDrawColor(...COLOR.rojo).setLineWidth(0.6).rect(M, y, W, 12);
    doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(...COLOR.rojo);
    doc.text(pdfTxt(`ANULADA${n.anulada_motivo ? ` · ${n.anulada_motivo}` : ""}`), M + W / 2, y + 7.8, { align: "center", maxWidth: W - 6 });
    y += 18;
  }

  // ── Datos (recuadro, dos columnas) ─────────────────────────────────────────
  const col = (W - 8) / 2;
  const filas = (lista: [string, string][], x: number, y0: number) => {
    let yy = y0;
    for (const [l, v] of lista) {
      doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...COLOR.gris);
      doc.text(pdfTxt(l), x, yy);
      doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(...COLOR.negro);
      const txt = doc.splitTextToSize(pdfTxt(v || "—"), col - 34) as string[];
      doc.text(txt, x + 30, yy);
      yy += 4.6 * txt.length;
    }
    return yy;
  };
  const ruc = d.cliente?.documento || d.venta.receptor_ruc;
  const yFin = Math.max(
    filas([
      ["Cliente", d.cliente_nombre],
      ["RUC / CI", ruc ?? "—"],
      ["Tipo", n.tipo === "descuento" ? "Descuento / bonificación" : "Devolución de productos"],
    ], M + 3, y + 5),
    filas([
      ["Corrige la venta", `${d.venta.numero_control} · ${fechaCorta(d.venta.fecha.slice(0, 10))}`],
      ["Documento", d.venta.tipo_documento === "factura" ? "Factura" : "Ticket"],
      ["Emitida por", n.usuario_nombre ?? "—"],
    ], M + col + 8, y + 5),
  );
  doc.setDrawColor(...COLOR.borde).setLineWidth(0.25).roundedRect(M, y, W, yFin - y - 0.5, 1.2, 1.2, "S");
  y = yFin + 4;

  // Motivo
  doc.setFontSize(8.5);
  const et = "Motivo: ";
  const ancho = doc.setFont("helvetica", "bold").getTextWidth(et);
  const resto = doc.setFont("helvetica", "normal").splitTextToSize(pdfTxt(n.motivo), W - 6 - ancho) as string[];
  const alto = resto.length * 3.8 + 4.2;
  doc.setDrawColor(...COLOR.borde).setFillColor(250, 250, 250).setLineWidth(0.25).roundedRect(M, y, W, alto, 1.2, 1.2, "FD");
  doc.setFont("helvetica", "bold").setTextColor(...COLOR.negro).text(et, M + 3, y + 4.8);
  doc.setFont("helvetica", "normal").text(resto, M + 3 + ancho, y + 4.8, { lineHeightFactor: 1.25 });
  y += alto + 7;

  // ── Detalle ────────────────────────────────────────────────────────────────
  const devolucion = n.tipo === "devolucion";
  tituloSeccion(doc, devolucion ? "PRODUCTOS DEVUELTOS" : "DETALLE", M, y);
  autoTable(doc, {
    startY: y + 3,
    margin: { left: M, right: M, bottom: 18 },
    head: [devolucion ? ["PRODUCTO", "CANT.", "PRECIO", "IVA", "TOTAL", "STOCK"] : ["CONCEPTO", "IVA", "TOTAL"]],
    body: d.items.map((i) =>
      devolucion
        ? [pdfTxt(`${i.producto_nombre}${i.sku ? ` · ${i.sku}` : ""}`), cant(i.cantidad), gs(i.precio_unitario), pdfTxt(i.tipo_iva ?? "—"), gs(i.total_linea),
           !i.mueve_stock ? "—" : i.vuelve_stock ? "Volvió" : "No volvió"]
        : [pdfTxt(i.producto_nombre), pdfTxt(i.tipo_iva ?? "—"), gs(i.total_linea)],
    ),
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8.2, cellPadding: { top: 1.7, bottom: 1.7, left: 2.2, right: 2.2 }, lineColor: [220, 220, 220], lineWidth: 0.2, textColor: COLOR.negro, valign: "middle" },
    headStyles: { fillColor: [244, 247, 247], textColor: COLOR.teal, fontStyle: "bold", fontSize: 7 },
    columnStyles: devolucion
      ? { 1: { halign: "right", cellWidth: 16 }, 2: { halign: "right", cellWidth: 26 }, 3: { cellWidth: 16 }, 4: { halign: "right", cellWidth: 28, fontStyle: "bold" }, 5: { cellWidth: 22 } }
      : { 1: { cellWidth: 22 }, 2: { halign: "right", cellWidth: 34, fontStyle: "bold" } },
    didParseCell: (h) => {
      if (h.section === "head" && (devolucion ? [1, 2, 4] : [2]).includes(h.column.index)) h.cell.styles.halign = "right";
      if (devolucion && h.section === "body" && h.column.index === 5 && d.items[h.row.index]?.mueve_stock && !d.items[h.row.index]?.vuelve_stock) {
        h.cell.styles.textColor = COLOR.ambar;
      }
    },
  });
  y = finY(doc) + 5;

  // ── Totales (IVA por tasa) ─────────────────────────────────────────────────
  const tasa = (t: string | null) => (t === "10%" ? "10" : t === "5%" ? "5" : "ex");
  const por = { "10": { total: 0, iva: 0 }, "5": { total: 0, iva: 0 }, ex: { total: 0, iva: 0 } };
  for (const i of d.items) { por[tasa(i.tipo_iva)].total += Number(i.total_linea); por[tasa(i.tipo_iva)].iva += Number(i.monto_iva); }
  const xT = M + W - 78;
  const fila = (label: string, valor: string, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(bold ? 10 : 8.2).setTextColor(...(bold ? COLOR.negro : COLOR.gris));
    doc.text(pdfTxt(label), xT, y);
    doc.setTextColor(...COLOR.negro).text(pdfTxt(valor), M + W, y, { align: "right" });
    y += bold ? 6 : 4.8;
  };
  if (por["10"].total) fila("Gravado 10% (IVA incluido)", `Gs. ${gs(por["10"].total)}`);
  if (por["5"].total) fila("Gravado 5% (IVA incluido)", `Gs. ${gs(por["5"].total)}`);
  if (por.ex.total) fila("Exento", `Gs. ${gs(por.ex.total)}`);
  if (por["10"].iva) fila("IVA 10%", `Gs. ${gs(por["10"].iva)}`);
  if (por["5"].iva) fila("IVA 5%", `Gs. ${gs(por["5"].iva)}`);
  doc.setDrawColor(...COLOR.negro).setLineWidth(0.5).line(xT, y - 2.6, M + W, y - 2.6);
  y += 1.4;
  fila("TOTAL NOTA DE CRÉDITO", `Gs. ${gs(n.total)}`, true);
  doc.setFont("helvetica", "italic").setFontSize(7.8).setTextColor(...COLOR.gris);
  const letras = doc.splitTextToSize(pdfTxt(`Son guaraníes ${numeroEnLetras(Number(n.total))}.`), W) as string[];
  doc.text(letras, M + W, y, { align: "right" });
  y += letras.length * 3.8 + 6;

  // ── A dónde fue la plata ───────────────────────────────────────────────────
  tituloSeccion(doc, "CÓMO SE ACREDITA", M, y);
  y += 7;
  const linea = (label: string, valor: string, sub?: string) => {
    doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...COLOR.negro);
    doc.text(pdfTxt(label), M, y);
    doc.setFont("helvetica", "bold").text(pdfTxt(valor), M + W, y, { align: "right" });
    y += 4.6;
    if (sub) {
      doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...COLOR.gris);
      const t = doc.splitTextToSize(pdfTxt(sub), W - 40) as string[];
      doc.text(t, M + 3, y);
      y += t.length * 3.6 + 1;
    }
  };
  if (n.a_cuenta > 0) {
    linea("Se descontó de la deuda de la venta", `Gs. ${gs(n.a_cuenta)}`,
      d.aplicaciones.length ? d.aplicaciones.map((a) => `${a.numero} (vence ${fechaCorta(a.vencimiento)}): Gs. ${gs(a.monto)}`).join(" · ") : undefined);
  }
  if (n.devuelto > 0) {
    linea(`Devuelto en ${FORMA[n.metodo_devolucion ?? "efectivo"] ?? "efectivo"}`, `Gs. ${gs(n.devuelto)}`,
      [d.caja ? `Desde ${d.caja.etiqueta}${d.caja.numero_caja ? ` · turno N° ${d.caja.numero_caja}` : ""}` : null,
       n.referencia_devolucion ? `Ref. ${n.referencia_devolucion}` : null].filter(Boolean).join(" · ") || undefined);
  }
  if (n.a_favor > 0) linea("Queda como saldo a favor del cliente", `Gs. ${gs(n.a_favor)}`, "Lo puede usar para pagar su próxima compra o su deuda.");

  // ── Firmas ─────────────────────────────────────────────────────────────────
  y = Math.max(y + 22, 235);
  const fw = 70;
  doc.setDrawColor(...COLOR.negro).setLineWidth(0.3);
  doc.line(M + 5, y, M + 5 + fw, y);
  doc.line(M + W - fw - 5, y, M + W - 5, y);
  doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...COLOR.gris);
  doc.text(pdfTxt(`Emitida por${n.usuario_nombre ? ` · ${n.usuario_nombre}` : ""}`), M + 5 + fw / 2, y + 4, { align: "center" });
  doc.text(pdfTxt("Recibí conforme (cliente)"), M + W - 5 - fw / 2, y + 4, { align: "center" });

  pieDePagina(doc, `Nota de crédito ${n.numero} · Documento interno (no fiscal)`);
  return doc;
}
