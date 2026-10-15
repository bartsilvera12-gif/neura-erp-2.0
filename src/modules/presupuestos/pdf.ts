/**
 * PDF del presupuesto (solo servidor). Lo usan la ruta interna (/api/presupuestos/[id]/pdf)
 * y la pública (/p/[token]/pdf): las dos le pasan el MISMO documento (presupuesto_json),
 * que trae solo campos públicos. Diseño de la casa (membrete con logo, recuadro del título,
 * secciones en turquesa), A4 vertical.
 */
import autoTable from "jspdf-autotable";
import { COLOR, encabezado, M, nuevoDocumento, pdfTxt, pieDePagina, tituloSeccion, W } from "@/lib/pdf/documento";
import { cantidad, condicionTexto, diaCorto, monto, numeroConRevision, pct, type PresupuestoDoc } from "@/modules/presupuestos/tipos";

const ESTADO_SELLO: Partial<Record<PresupuestoDoc["estado"], { texto: string; color: [number, number, number] }>> = {
  aceptado: { texto: "ACEPTADO", color: COLOR.verde },
  convertido: { texto: "ACEPTADO", color: COLOR.verde },
  rechazado: { texto: "RECHAZADO", color: COLOR.rojo },
  vencido: { texto: "VENCIDO", color: COLOR.ambar },
};

export async function pdfPresupuesto(p: PresupuestoDoc) {
  const doc = nuevoDocumento();
  const m = (v: number) => monto(v, p.moneda);
  const numero = numeroConRevision(p.numero, p.revision);
  let y = await encabezado(doc, `PRESUPUESTO ${numero}`,
    `Emitido el ${diaCorto(p.fecha)} · Válido hasta el ${diaCorto(p.valido_hasta)} (${p.validez_dias} día${p.validez_dias === 1 ? "" : "s"})`);

  // Sello de estado (aceptado / rechazado / vencido), arriba a la derecha del título.
  const sello = ESTADO_SELLO[p.estado];
  if (sello) {
    doc.setFont("helvetica", "bold").setFontSize(9);
    const w = doc.getTextWidth(sello.texto) + 8;
    doc.setDrawColor(...sello.color).setLineWidth(0.5).roundedRect(M + W - w, y - 3, w, 6.5, 1.2, 1.2);
    doc.setTextColor(...sello.color).text(sello.texto, M + W - w / 2, y + 1.4, { align: "center" });
    y += 6;
  }

  // Dos columnas: cliente | propuesta.
  const col = (W - 8) / 2;
  tituloSeccion(doc, "CLIENTE", M, y, col);
  tituloSeccion(doc, "PROPUESTA", M + col + 8, y, col);
  y += 6;
  const izq: [string, string | null | undefined][] = [
    ["Nombre", p.cliente.nombre],
    ["RUC / CI", p.cliente.ruc],
    ["Teléfono", p.cliente.telefono],
    ["Email", p.cliente.email],
    ["Dirección", p.cliente.direccion],
  ];
  const der: [string, string | null | undefined][] = [
    ["Número", numero],
    ["Fecha", diaCorto(p.fecha)],
    ["Válido hasta", diaCorto(p.valido_hasta)],
    ["Condición", condicionTexto(p.condicion, p.plazo_dias)],
    ["Moneda", p.moneda === "USD" ? `Dólares (referencia: 1 US$ = Gs. ${Math.round(p.tipo_cambio).toLocaleString("es-PY")})` : "Guaraníes"],
    ["Atendido por", p.vendedor_nombre],
  ];
  const filas = (lista: [string, string | null | undefined][], x: number, y0: number) => {
    let yy = y0;
    for (const [l, v] of lista) {
      if (!v) continue;
      doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...COLOR.gris);
      doc.text(pdfTxt(l), x, yy);
      doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(...COLOR.negro);
      const t = doc.splitTextToSize(pdfTxt(v), col - 28) as string[];
      doc.text(t, x + 28, yy);
      yy += 4.6 * t.length;
    }
    return yy;
  };
  y = Math.max(filas(izq, M, y), filas(der, M + col + 8, y)) + 4;

  // Líneas. La descripción larga (detalle) va debajo, en la misma celda.
  const hayDesc = p.items.some((i) => Number(i.descuento_pct) > 0);
  const head = ["#", "DESCRIPCIÓN", "CANT.", "PRECIO UNIT.", ...(hayDesc ? ["DESC."] : []), "IVA", "TOTAL"];
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, bottom: 16 },
    head: [head],
    body: p.items.map((it, n) => [
      String(n + 1),
      pdfTxt(it.detalle ? `${it.descripcion}\n${it.detalle}` : it.descripcion),
      `${cantidad(it.cantidad)}${it.unidad && it.unidad !== "Unidad" ? ` ${it.unidad}` : ""}`,
      m(it.precio_unitario),
      ...(hayDesc ? [Number(it.descuento_pct) > 0 ? pct(it.descuento_pct) : "—"] : []),
      it.tipo_iva === "EXENTA" ? "Exenta" : it.tipo_iva,
      m(it.total),
    ]),
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8.2, cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 }, lineColor: [220, 220, 220], lineWidth: 0.2, textColor: COLOR.negro, valign: "middle" },
    headStyles: { fillColor: [244, 247, 247], textColor: COLOR.teal, fontStyle: "bold", fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      2: { halign: "right", cellWidth: 18 },
      3: { halign: "right", cellWidth: 27 },
      ...(hayDesc ? { 4: { halign: "right", cellWidth: 14 }, 5: { halign: "center", cellWidth: 14 }, 6: { halign: "right", cellWidth: 30 } }
                  : { 4: { halign: "center", cellWidth: 14 }, 5: { halign: "right", cellWidth: 30 } }),
    },
    didParseCell: (h) => {
      if (h.section === "head" && h.column.index >= 2) h.cell.styles.halign = h.column.raw === "IVA" ? "center" : "right";
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // Totales a la derecha; condiciones comerciales a la izquierda.
  const anchoTot = 78;
  const xTot = M + W - anchoTot;
  const totales: [string, string, boolean?][] = [];
  if (Number(p.descuento_lineas) > 0 || Number(p.descuento_global) > 0) {
    totales.push(["Subtotal", m(p.subtotal_bruto)]);
    if (Number(p.descuento_lineas) > 0) totales.push(["Descuentos por línea", `- ${m(p.descuento_lineas)}`]);
    if (Number(p.descuento_global) > 0) totales.push([`Descuento general (${pct(p.descuento_pct)})`, `- ${m(p.descuento_global)}`]);
  }
  if (y + 60 > 297 - 18) { doc.addPage(); y = M; }
  const yIni = y;
  let yt = y;
  doc.setFontSize(8.5);
  for (const [l, v] of totales) {
    doc.setFont("helvetica", "normal").setTextColor(...COLOR.gris).text(pdfTxt(l), xTot, yt);
    doc.setTextColor(...COLOR.negro).text(pdfTxt(v), M + W, yt, { align: "right" });
    yt += 5;
  }
  doc.setFillColor(...COLOR.teal).roundedRect(xTot - 2, yt - 4, anchoTot + 2, 9, 1.2, 1.2, "F");
  doc.setFont("helvetica", "bold").setFontSize(10.5).setTextColor(255, 255, 255);
  doc.text("TOTAL", xTot + 1, yt + 2);
  doc.text(pdfTxt(m(p.total)), M + W - 2, yt + 2, { align: "right" });
  yt += 11;
  // Liquidación del IVA (incluido en los precios).
  doc.setFont("helvetica", "bold").setFontSize(7).setTextColor(...COLOR.teal).text("IVA INCLUIDO", xTot, yt);
  yt += 4;
  const ivas: [string, number, number | null][] = [];
  if (Number(p.total_10)) ivas.push(["Gravado 10%", p.total_10, p.iva_10]);
  if (Number(p.total_5)) ivas.push(["Gravado 5%", p.total_5, p.iva_5]);
  if (Number(p.total_exenta)) ivas.push(["Exento", p.total_exenta, null]);
  doc.setFont("helvetica", "normal").setFontSize(7.5);
  for (const [l, base, iva] of ivas) {
    doc.setTextColor(...COLOR.gris).text(pdfTxt(`${l}: ${m(base)}`), xTot, yt);
    doc.setTextColor(...COLOR.negro).text(iva == null ? "—" : pdfTxt(`IVA ${m(iva)}`), M + W, yt, { align: "right" });
    yt += 4;
  }
  doc.setFont("helvetica", "bold").setTextColor(...COLOR.negro).text("Total IVA", xTot, yt);
  doc.text(pdfTxt(m(p.total_iva)), M + W, yt, { align: "right" });
  yt += 4;

  let yc = yIni;
  const anchoCond = W - anchoTot - 10;
  if (p.condiciones) {
    tituloSeccion(doc, "CONDICIONES COMERCIALES", M, yc, anchoCond);
    yc += 5;
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...COLOR.negro);
    const t = doc.splitTextToSize(pdfTxt(p.condiciones), anchoCond) as string[];
    for (const linea of t) {
      if (yc > 297 - 20) { doc.addPage(); yc = M; }
      doc.text(linea, M, yc);
      yc += 3.9;
    }
  }
  y = Math.max(yt, yc) + 6;
  if (y > 297 - 26) { doc.addPage(); y = M; }
  doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...COLOR.gris);
  const nota = `Precios con IVA incluido${p.moneda === "USD" ? ", en dólares americanos" : ""}. Presupuesto válido hasta el ${diaCorto(p.valido_hasta)}; pasada esa fecha los precios y la disponibilidad pueden cambiar.`;
  doc.text(doc.splitTextToSize(pdfTxt(nota), W) as string[], M, y);
  if (p.estado === "rechazado" && p.rechazo_motivo) {
    y += 8;
    doc.setTextColor(...COLOR.rojo).text(pdfTxt(`Rechazado: ${p.rechazo_motivo}`), M, y);
  }

  pieDePagina(doc, `Presupuesto ${numero}`);
  return doc;
}

export { nombreArchivoPresupuesto } from "@/modules/presupuestos/tipos";
