/**
 * Nota de remisión de un traslado (A4, jsPDF). Lleva los datos que pide SIFEN para la
 * remisión electrónica (motivo, fecha de inicio, puntos de partida y llegada, vehículo,
 * chofer y transportista) para pasarla a electrónica más adelante sin cambiar el modelo.
 * Por ahora es un comprobante interno numerado (establecimiento-punto-número). Solo servidor.
 */
import type { DatosEmpresa } from "@/modules/empresa/tipos";
import autoTable from "jspdf-autotable";
import { COLOR, encabezado, fechaHoraPY, gs, M, nuevoDocumento, pdfTxt, pieDePagina, tituloSeccion, W } from "@/lib/pdf/documento";
import { dia, motivoTraslado, type TrasladoDetalle } from "@/modules/inventario/documentos";

const cant = (n: number | null | undefined) => Number(n ?? 0).toLocaleString("es-PY", { maximumFractionDigits: 3 });

export async function pdfRemision(t: TrasladoDetalle, empresa?: DatosEmpresa | null) {
  const doc = nuevoDocumento(empresa);
  const estado =
    t.estado === "anulado" ? " · ANULADO"
    : t.estado === "en_transito" ? " · En tránsito"
    : t.estado === "recibido_con_diferencias" ? " · Recibido con diferencias" : " · Recibido";
  let y = await encabezado(doc, `NOTA DE REMISIÓN N° ${t.remision_numero}`, `Traslado ${t.numero}${estado}`);

  // ── Datos del traslado + transporte (dos columnas) ───────────────────────
  const col = (W - 8) / 2;
  const filas = (lista: [string, string | null | undefined][], x: number, y0: number) => {
    let yy = y0;
    for (const [l, v] of lista) {
      doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...COLOR.gris);
      doc.text(pdfTxt(l), x, yy);
      doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(...COLOR.negro);
      const txt = doc.splitTextToSize(pdfTxt(v || "—"), col - 32) as string[];
      doc.text(txt, x + 32, yy);
      yy += 4.6 * txt.length;
    }
    return yy;
  };
  tituloSeccion(doc, "DATOS DEL TRASLADO", M, y, col);
  tituloSeccion(doc, "TRANSPORTE", M + col + 8, y, col);
  y += 6;
  const izq: [string, string | null | undefined][] = [
    ["Motivo", t.motivo_codigo === 99 && t.motivo_descripcion ? `Otro: ${t.motivo_descripcion}` : motivoTraslado(t.motivo_codigo)],
    ["Fecha de inicio", dia(t.fecha_inicio)],
    ["Llegada estimada", t.fecha_fin_estimada ? dia(t.fecha_fin_estimada) : null],
    ["Documento interno", t.numero],
    ["Emitido por", `${t.usuario_nombre ?? "—"} · ${fechaHoraPY(t.created_at)}`],
  ];
  const der: [string, string | null | undefined][] = [
    ["Vehículo", t.vehiculo_marca],
    ["Chapa", t.vehiculo_chapa],
    ["Chofer", t.chofer_nombre],
    ["CI del chofer", t.chofer_documento],
    ["Transportista", [t.transportista_nombre, t.transportista_ruc ? `RUC ${t.transportista_ruc}` : null].filter(Boolean).join(" · ") || null],
  ];
  y = Math.max(filas(izq, M, y), filas(der, M + col + 8, y)) + 3;

  // ── Puntos de partida y llegada ──────────────────────────────────────────
  tituloSeccion(doc, "PUNTO DE PARTIDA", M, y, col);
  tituloSeccion(doc, "PUNTO DE LLEGADA", M + col + 8, y, col);
  y += 6;
  const partida: [string, string | null | undefined][] = [
    ["Sucursal", t.origen.sucursal],
    ["Depósito", t.origen.nombre],
    ["Dirección", t.punto_partida],
    ["Ciudad", t.ciudad_partida],
  ];
  const llegada: [string, string | null | undefined][] = [
    ["Sucursal", t.destino.sucursal],
    ["Depósito", t.destino.nombre],
    ["Dirección", t.punto_llegada],
    ["Ciudad", t.ciudad_llegada],
  ];
  y = Math.max(filas(partida, M, y), filas(llegada, M + col + 8, y)) + 4;

  // ── Mercadería ───────────────────────────────────────────────────────────
  const recibido = t.estado === "recibido" || t.estado === "recibido_con_diferencias";
  const head = ["#", "CÓDIGO", "DESCRIPCIÓN", "LOTE / VENCE", "UNIDAD", "CANTIDAD", ...(recibido ? ["RECIBIDO"] : [])];
  const body: string[][] = [];
  t.items.forEach((it, n) => {
    const lotes = it.lotes.filter((l) => l.lote_numero || it.controla_lotes);
    const loteTxt = lotes.length === 1
      ? lotes[0].lote_numero ? `${lotes[0].lote_numero} · ${dia(lotes[0].vencimiento)}` : "Sin lote"
      : lotes.length > 1 ? `${lotes.length} lotes` : "—";
    body.push([
      String(n + 1),
      pdfTxt(it.producto_sku ?? ""),
      pdfTxt(it.producto_nombre),
      pdfTxt(loteTxt),
      pdfTxt(it.unidad_medida ?? "Unidad"),
      cant(it.cantidad),
      ...(recibido ? [cant(it.cantidad_recibida)] : []),
    ]);
    // Varios lotes: una línea por lote debajo del producto.
    if (lotes.length > 1) {
      for (const l of lotes) {
        body.push(["", "", pdfTxt(`   Lote ${l.lote_numero ?? "sin lote"}`), pdfTxt(l.lote_numero ? dia(l.vencimiento) : "—"), "", cant(l.cantidad),
          ...(recibido ? [cant(l.cantidad_recibida)] : [])]);
      }
    }
  });
  const totalEnv = t.items.reduce((a, x) => a + Number(x.cantidad), 0);
  const totalRec = t.items.reduce((a, x) => a + Number(x.cantidad_recibida ?? 0), 0);
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, bottom: 16 },
    head: [head],
    body,
    foot: [["", "", `${t.items.length} producto(s)`, "", "TOTAL", cant(totalEnv), ...(recibido ? [cant(totalRec)] : [])]],
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8.2, cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 }, lineColor: [220, 220, 220], lineWidth: 0.2, textColor: COLOR.negro, valign: "middle" },
    headStyles: { fillColor: [244, 247, 247], textColor: COLOR.teal, fontStyle: "bold", fontSize: 7 },
    footStyles: { fillColor: [255, 255, 255], textColor: COLOR.negro, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: 24 },
      3: { cellWidth: 32 },
      4: { cellWidth: 18 },
      5: { halign: "right", cellWidth: 20 },
      6: { halign: "right", cellWidth: 20 },
    },
    didParseCell: (h) => {
      if ((h.section === "head" || h.section === "foot") && h.column.index >= 5) h.cell.styles.halign = "right";
      if (h.section === "body" && (h.row.raw as string[])[0] === "") { h.cell.styles.textColor = COLOR.gris; h.cell.styles.fontSize = 7.5; }
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  if (recibido && Number(t.diferencia_unidades) > 0) {
    doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(...COLOR.ambar);
    const txt = doc.splitTextToSize(pdfTxt(`Diferencia en la recepción: ${cant(t.diferencia_unidades)} unidad(es) (Gs. ${gs(t.diferencia_valor)} al costo). Motivo: ${t.diferencia_motivo ?? "—"}`), W) as string[];
    doc.text(txt, M, y);
    y += txt.length * 4.2 + 3;
  }
  const notas = [t.observacion, t.estado === "anulado" && t.anulado_motivo ? `Anulado: ${t.anulado_motivo}` : null, t.recepcion_observacion ? `Recepción: ${t.recepcion_observacion}` : null].filter(Boolean) as string[];
  if (notas.length) {
    tituloSeccion(doc, "OBSERVACIONES", M, y);
    y += 5;
    doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...COLOR.negro);
    const txt = doc.splitTextToSize(pdfTxt(notas.join("\n")), W) as string[];
    doc.text(txt, M, y);
    y += txt.length * 4.2 + 4;
  }
  if (recibido && t.recibido_at) {
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...COLOR.gris);
    doc.text(pdfTxt(`Recibido por ${t.recibido_por_nombre ?? "—"} el ${fechaHoraPY(t.recibido_at)}`), M, y);
    y += 5;
  }

  // ── Firmas ───────────────────────────────────────────────────────────────
  y = Math.max(y + 16, 236);
  if (y > 268) { doc.addPage(); y = 60; }
  const fw = 52;
  const gap = (W - fw * 3) / 2;
  for (const [i, l] of ["Entregado por (origen)", "Chofer / transportista", "Recibido por (destino)"].entries()) {
    const x = M + i * (fw + gap);
    doc.setDrawColor(...COLOR.grisClaro).setLineWidth(0.3).line(x, y, x + fw, y);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...COLOR.gris);
    doc.text(pdfTxt(l), x + fw / 2, y + 4, { align: "center" });
    doc.text(pdfTxt("Aclaración y CI"), x + fw / 2, y + 8, { align: "center" });
  }
  doc.setFont("helvetica", "italic").setFontSize(7).setTextColor(...COLOR.grisClaro);
  doc.text(pdfTxt("Comprobante interno de traslado de mercaderías. La nota de remisión electrónica (SIFEN) se emitirá cuando se habilite la facturación electrónica."), M, 297 - 17);

  pieDePagina(doc, `Nota de remisión ${t.remision_numero} · ${t.numero}`);
  return doc;
}
