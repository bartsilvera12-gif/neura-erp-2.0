/**
 * PDF del presupuesto (solo servidor). Lo usan la ruta interna (/api/presupuestos/[id]/pdf)
 * y la pública (/p/[token]/pdf): las dos le pasan el MISMO documento (presupuesto_json),
 * que trae solo campos públicos + el membrete (`emisor`: empresa, sucursal y contacto del
 * vendedor). Diseño de FACTURA A4 paraguaya (estilo KuDE / preimpresa: recuadros y líneas
 * finas, valor de venta repartido en Exentas · 5% · 10%, total en letras y liquidación
 * del IVA), pero como presupuesto: sin timbrado, CDC, QR ni leyendas fiscales. Se crea, se
 * descarga y se manda como archivo: no lleva links ni firmas. Nunca muestra el estado
 * interno; solo la versión interna marca discretamente un presupuesto vencido.
 */
import autoTable, { type CellHookData, type RowInput } from "jspdf-autotable";
import type { jsPDF } from "jspdf";
import { clienteConfig } from "@/cliente.config";
import { COLOR, logoDoc, nuevoDocumento, pdfTxt, type RGB } from "@/lib/pdf/documento";
import { numeroEnLetras } from "@/lib/pdf/letras";
import { cantidad, condicionTexto, diaCorto, monto, pct, type PresupuestoDoc } from "@/modules/presupuestos/tipos";

/** Membrete que arma presupuesto_json (puede faltar en documentos viejos). */
export type EmisorPresupuesto = {
  empresa: string | null;
  sucursal: string | null;
  direccion: string | null;
  ciudad: string | null;
  telefono: string | null;
  vendedor_telefono: string | null;
  vendedor_email: string | null;
  respuesta_online?: boolean | null;
  ruc?: string | null;
  email?: string | null;
  web?: string | null;
  actividad?: string | null;
};
export type OpcionesPdfPresupuesto = {
  /** Versión interna (descarga desde el ERP): marca discreta si está vencido. */
  interno?: boolean;
  /** Sin uso: el PDF no lleva links (se manda como archivo). Se acepta para no romper llamadas viejas. */
  link?: string | null;
};

// ── Geometría y paleta ─────────────────────────────────────────────────────────
const PW = 210, PH = 297;
const MX = 13; // margen lateral
const ANCHO = PW - MX * 2;
const TOP_SIG = 24; // arriba en páginas 2+ (debajo del encabezado corrido)
const PIE = 22; // reservado abajo para el pie

const mezcla = (c: RGB, con: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(c[i] * (1 - t) + con[i] * t)) as RGB;
const BLANCO: RGB = [255, 255, 255];
const MARCA = COLOR.teal;
const MARCA_OSC = mezcla(MARCA, [0, 0, 0], 0.3);
const TINTE = mezcla(MARCA, BLANCO, 0.9);
const TINTE_SUAVE = mezcla(MARCA, BLANCO, 0.955);
const TINTA: RGB = [31, 41, 55];
const TEXTO: RGB = [75, 85, 99];
const APAGADO: RGB = [107, 114, 128];
const BORDE: RGB = [196, 202, 210];
const LINEA: RGB = [222, 226, 231];
const AMBAR: RGB = [180, 83, 9];

/** Alto de renglón en mm para un cuerpo en pt (interlineado 1.22). */
const alto = (pt: number) => pt * 0.3528 * 1.22;
/** Desde el tope de un renglón hasta su línea base. */
const base = (pt: number) => pt * 0.3528 * 0.86;

const lleno = (s: string | null | undefined): s is string => !!s && s.trim() !== "";

type Renglon = { t: string; pt: number; bold?: boolean; color: RGB };
type Campo = { l: string; v: string; completo?: boolean; normal?: boolean };

/** Monto en letras, como en la factura. */
export function totalEnLetras(v: number, moneda: "GS" | "USD"): string {
  const n = Math.abs(Number(v) || 0);
  if (moneda === "USD") {
    let entero = Math.floor(n);
    let cent = Math.round((n - entero) * 100);
    if (cent === 100) { entero += 1; cent = 0; }
    return `Son dólares americanos: ${numeroEnLetras(entero)} con ${String(cent).padStart(2, "0")}/100.`;
  }
  return `Son guaraníes: ${numeroEnLetras(Math.round(n))}.`;
}

export async function pdfPresupuesto(p: PresupuestoDoc & { emisor?: EmisorPresupuesto | null }, opciones: OpcionesPdfPresupuesto = {}) {
  const doc = nuevoDocumento();
  const usd = p.moneda === "USD";
  const num = (v: number | null | undefined) =>
    usd ? (Number(v) || 0).toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(Number(v) || 0).toLocaleString("es-PY");
  const em = p.emisor ?? null;
  const empresa = em?.empresa || clienteConfig.nombre;
  const web = em?.web || clienteConfig.dominio;
  const ubicacion = [em?.direccion, em?.ciudad].filter(lleno).join(", ");
  const der = MX + ANCHO;
  const vencido = p.estado === "vencido";

  // ── Piezas de dibujo ────────────────────────────────────────────────────────
  const recuadro = (x: number, y: number, w: number, h: number) =>
    doc.setDrawColor(...BORDE).setLineWidth(0.3).rect(x, y, w, h, "S");
  const ALTO_BARRA = 5.4;
  const barraTitulo = (txt: string, x: number, y: number, w: number) => {
    doc.setFillColor(...TINTE).rect(x, y, w, ALTO_BARRA, "F");
    doc.setDrawColor(...BORDE).setLineWidth(0.25).line(x, y + ALTO_BARRA, x + w, y + ALTO_BARRA);
    doc.setFont("helvetica", "bold").setFontSize(6.6).setTextColor(...MARCA_OSC);
    doc.text(pdfTxt(txt.toUpperCase()), x + 3, y + 3.75, { charSpace: 0.45 });
  };
  /** "Etiqueta: valor" con sangría colgante. Devuelve el alto. */
  const campo = (x: number, y: number, w: number, c: Campo, dibujar: boolean) => {
    const l = `${c.l}:`;
    doc.setFont("helvetica", "normal").setFontSize(7.4);
    const lw = doc.getTextWidth(pdfTxt(l)) + 1.6;
    const peso = c.normal ? "normal" : "bold";
    doc.setFont("helvetica", peso).setFontSize(7.8);
    const lineas = doc.splitTextToSize(pdfTxt(c.v), Math.max(10, w - lw)) as string[];
    if (dibujar) {
      doc.setFont("helvetica", "normal").setFontSize(7.4).setTextColor(...APAGADO);
      doc.text(pdfTxt(l), x, y + base(7.8));
      doc.setFont("helvetica", peso).setFontSize(7.8).setTextColor(...(c.normal ? TEXTO : TINTA));
      lineas.forEach((t, i) => doc.text(t, x + lw, y + base(7.8) + i * alto(7.8)));
    }
    return lineas.length * alto(7.8);
  };
  /** Grilla de campos en `cols` columnas (los "completos" ocupan la fila entera). */
  const grilla = (campos: Campo[], x: number, y: number, w: number, cols: number, dibujar: boolean) => {
    const gap = 6;
    const wc = (w - gap * (cols - 1)) / cols;
    let yy = y;
    let fila: Campo[] = [];
    const cerrar = () => {
      if (!fila.length) return;
      let h = 0;
      fila.forEach((c, i) => {
        h = Math.max(h, campo(x + i * (wc + gap), yy, c.completo ? w : wc, c, dibujar));
      });
      yy += h + 2;
      fila = [];
    };
    for (const c of campos) {
      if (c.completo) {
        cerrar();
        fila = [c];
        cerrar();
      } else {
        fila.push(c);
        if (fila.length === cols) cerrar();
      }
    }
    cerrar();
    return yy - y - 2;
  };

  // ── 1. Encabezado: emisor (izq.) | presupuesto (der.) ───────────────────────
  let y = 13;
  const gapCab = 3;
  const wIzq = Math.round(ANCHO * 0.62);
  const wDer = ANCHO - wIzq - gapCab;
  const xDerCab = MX + wIzq + gapCab;

  const logo = await logoDoc();
  let wLogo = 0, hLogo = 0;
  if (logo) {
    hLogo = 17;
    wLogo = Math.min(34, (logo.w / logo.h) * hLogo);
    hLogo = (wLogo * logo.h) / logo.w;
  }
  const xTxt = MX + 5 + (logo ? wLogo + 6 : 0);
  const wTxt = MX + wIzq - 4 - xTxt;
  doc.setFont("helvetica", "bold").setFontSize(11.5);
  const nombreEmp = doc.splitTextToSize(pdfTxt(empresa), wTxt) as string[];
  const lineasEmp = [
    lleno(em?.actividad) ? em!.actividad : null,
    lleno(em?.ruc) ? `RUC: ${em!.ruc}` : null,
    ubicacion || null,
    lleno(em?.telefono) ? `Tel.: ${em!.telefono}` : null,
    lleno(em?.email) ? em!.email : null,
    web,
  ].filter(lleno);
  const altoTxtEmp = nombreEmp.length * alto(11.5) + 1 + lineasEmp.length * alto(7.6);

  const rev = p.revision > 1;
  const marcaVencido = !!opciones.interno && vencido;
  const altoDerNat = 6 + 4.6 + 7 + (rev || marcaVencido ? 4.2 : 0) + 3.5 + 2 * 4.6 + 3;
  const altoCab = Math.max(32, hLogo + 10, altoTxtEmp + 10, altoDerNat);

  recuadro(MX, y, wIzq, altoCab);
  if (logo) doc.addImage(logo.data, "PNG", MX + 5, y + (altoCab - hLogo) / 2, wLogo, hLogo, "logo", "FAST");
  let ye = y + (altoCab - altoTxtEmp) / 2;
  doc.setFont("helvetica", "bold").setFontSize(11.5).setTextColor(...TINTA);
  for (const l of nombreEmp) {
    doc.text(l, xTxt, ye + base(11.5));
    ye += alto(11.5);
  }
  ye += 1;
  doc.setFont("helvetica", "normal").setFontSize(7.6).setTextColor(...TEXTO);
  for (const l of lineasEmp) {
    doc.text(pdfTxt(l), xTxt, ye + base(7.6), { maxWidth: wTxt });
    ye += alto(7.6);
  }

  recuadro(xDerCab, y, wDer, altoCab);
  doc.setFillColor(...MARCA).rect(xDerCab, y, wDer, 1.2, "F");
  const cx = xDerCab + wDer / 2;
  let yr = y + (altoCab - altoDerNat) / 2 + 6 + 3.2;
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...TINTA);
  doc.text("PRESUPUESTO", cx, yr, { align: "center", charSpace: 1.2 });
  yr += 7.4;
  doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(...MARCA);
  doc.text(pdfTxt(`N° ${p.numero}`), cx, yr, { align: "center" });
  if (rev || marcaVencido) {
    // "Revisión N" y/o la marca interna "VENCIDO", centrados bajo el número.
    yr += 4.4;
    doc.setFont("helvetica", "normal").setFontSize(7.6);
    const tRev = rev ? `Revisión ${p.revision}` : "";
    const wRev = rev ? doc.getTextWidth(tRev) : 0;
    doc.setFont("helvetica", "bold").setFontSize(6.2);
    const wTag = marcaVencido ? doc.getTextWidth("VENCIDO") + 4.5 : 0;
    const gap = rev && marcaVencido ? 3 : 0;
    let xs = cx - (wRev + gap + wTag) / 2;
    if (rev) {
      doc.setFont("helvetica", "normal").setFontSize(7.6).setTextColor(...APAGADO).text(tRev, xs, yr);
      xs += wRev + gap;
    }
    if (marcaVencido) {
      doc.setDrawColor(...AMBAR).setLineWidth(0.3).roundedRect(xs, yr - 3, wTag, 4, 0.8, 0.8);
      doc.setFont("helvetica", "bold").setFontSize(6.2).setTextColor(...AMBAR).text("VENCIDO", xs + wTag / 2, yr - 0.15, { align: "center", charSpace: 0.3 });
    }
  }
  yr += 3.2;
  doc.setDrawColor(...LINEA).setLineWidth(0.25).line(xDerCab + 5, yr, xDerCab + wDer - 5, yr);
  yr += 4.4;
  const filaCab = (l: string, v: string) => {
    doc.setFont("helvetica", "normal").setFontSize(7.4).setTextColor(...APAGADO);
    doc.text(pdfTxt(l), xDerCab + 5, yr);
    doc.setFont("helvetica", "bold").setFontSize(7.8).setTextColor(...TINTA);
    doc.text(pdfTxt(v), xDerCab + wDer - 5, yr, { align: "right" });
    yr += 4.6;
  };
  filaCab("Fecha de emisión", diaCorto(p.fecha));
  filaCab("Válido hasta", `${diaCorto(p.valido_hasta)} (${p.validez_dias} día${p.validez_dias === 1 ? "" : "s"})`);
  y += altoCab + 3;

  // ── 2. Datos de la operación (+ condiciones y validez) ──────────────────────
  const padB = 3;
  const xB = MX + padB, wB = ANCHO - padB * 2;
  const operacion: Campo[] = [
    { l: "Condición de venta", v: condicionTexto(p.condicion, p.plazo_dias) },
    {
      l: "Moneda",
      v: usd ? `Dólares (US$)${Number(p.tipo_cambio) > 0 ? ` · T.C. Gs. ${Math.round(p.tipo_cambio).toLocaleString("es-PY")}` : ""}` : "Guaraníes (Gs.)",
    },
  ];
  if (lleno(p.vendedor_nombre)) {
    const contacto = [em?.vendedor_telefono, em?.vendedor_email].filter(lleno).join(" · ");
    operacion.push({ l: "Atendido por", v: `${p.vendedor_nombre}${contacto ? ` · ${contacto}` : ""}` });
  }
  const notaValidez =
    `Hasta el ${diaCorto(p.valido_hasta)} (${p.validez_dias} día${p.validez_dias === 1 ? "" : "s"} desde su emisión). ` +
    `Pasada esa fecha, precios y disponibilidad quedan sujetos a confirmación. Precios con IVA incluido.`;
  // Renglones de las condiciones en un párrafo ("." al final de cada uno si no tiene).
  const condTxt = lleno(p.condiciones)
    ? p.condiciones.split(/\n+/).map((s) => s.trim()).filter(Boolean).map((s) => (/[.:;!?]$/.test(s) ? s : `${s}.`)).join(" ")
    : null;
  const condiciones: Campo[] = [
    ...(condTxt ? [{ l: "Condiciones comerciales", v: condTxt, completo: true, normal: true }] : []),
    { l: "Validez de la oferta", v: notaValidez, completo: true, normal: true },
  ];
  const altoCond = grilla(condiciones, xB, 0, wB, 1, false);
  const condAparte = altoCond > 16; // largas: van en su propio recuadro, debajo del cliente

  const hOp = grilla(operacion, xB, 0, wB, 3, false);
  const altoOp = ALTO_BARRA + padB + hOp + padB - 0.4 + (condAparte ? 0 : altoCond + padB + 1.4);
  recuadro(MX, y, ANCHO, altoOp);
  barraTitulo("Datos de la operación", MX, y, ANCHO);
  let yb = y + ALTO_BARRA + padB;
  yb += grilla(operacion, xB, yb, wB, 3, true) + padB - 0.4;
  if (!condAparte) {
    doc.setDrawColor(...LINEA).setLineWidth(0.2).line(MX, yb, der, yb);
    doc.setFillColor(...TINTE_SUAVE).rect(MX + 0.15, yb + 0.1, ANCHO - 0.3, y + altoOp - yb - 0.25, "F");
    grilla(condiciones, xB, yb + padB - 0.4, wB, 1, true);
  }
  y += altoOp + 3;

  // ── 3. Datos del cliente ────────────────────────────────────────────────────
  const c = p.cliente;
  const cliente: Campo[] = [{ l: "Nombre o razón social", v: c.nombre || "Consumidor final", completo: true }];
  if (lleno(c.ruc)) cliente.push({ l: "RUC / CI", v: c.ruc });
  if (lleno(c.telefono)) cliente.push({ l: "Teléfono", v: c.telefono });
  if (lleno(c.direccion)) cliente.push({ l: "Dirección", v: c.direccion });
  if (lleno(c.email)) cliente.push({ l: "Email", v: c.email });
  const hCli = grilla(cliente, xB, 0, wB, 2, false);
  const altoCli = ALTO_BARRA + padB + hCli + padB - 0.4;
  recuadro(MX, y, ANCHO, altoCli);
  barraTitulo("Datos del cliente", MX, y, ANCHO);
  grilla(cliente, xB, y + ALTO_BARRA + padB, wB, 2, true);
  y += altoCli + 3;

  if (condAparte) {
    const altoC = ALTO_BARRA + padB + altoCond + padB - 0.4;
    recuadro(MX, y, ANCHO, altoC);
    barraTitulo("Condiciones comerciales y validez", MX, y, ANCHO);
    grilla(condiciones, xB, y + ALTO_BARRA + padB, wB, 1, true);
    y += altoC + 3;
  }

  // ── 4. Detalle (Valor de venta: Exentas · 5% · 10%) ────────────────────────
  const W = { cod: 19, cant: 13, precio: 23, dto: 15, tasa: 21 };
  const wDesc = ANCHO - W.cod - W.cant - W.precio - W.dto - W.tasa * 3;
  const columnStyles = {
    0: { cellWidth: W.cod },
    1: { cellWidth: W.cant, halign: "right" as const },
    2: { cellWidth: wDesc },
    3: { cellWidth: W.precio, halign: "right" as const },
    4: { cellWidth: W.dto, halign: "right" as const },
    5: { cellWidth: W.tasa, halign: "right" as const },
    6: { cellWidth: W.tasa, halign: "right" as const },
    7: { cellWidth: W.tasa, halign: "right" as const },
  };
  const PAD = { top: 1.9, bottom: 1.9, left: 1.8, right: 1.8 };
  const estiloBase = {
    font: "helvetica", fontSize: 7.6, textColor: TINTA, cellPadding: PAD, valign: "top" as const,
    overflow: "linebreak" as const, lineColor: BORDE, lineWidth: 0.2,
  };
  const encabezadoCorrido = () => {
    doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...TINTA);
    doc.text(pdfTxt(empresa), MX, 14);
    doc.setFont("helvetica", "normal").setFontSize(7.8).setTextColor(...APAGADO);
    doc.text(pdfTxt(`Presupuesto N° ${p.numero}${rev ? ` · Rev. ${p.revision}` : ""}`), der, 14, { align: "right" });
    doc.setDrawColor(...BORDE).setLineWidth(0.25).line(MX, 17, der, 17);
  };

  const ricas = new Map<number, Renglon[]>();
  const sub = { ex: 0, c5: 0, c10: 0 };
  const filas = p.items.map((it, n) => {
    doc.setFont("helvetica", "normal").setFontSize(7.6);
    const nombre = (doc.splitTextToSize(pdfTxt(it.descripcion), wDesc - PAD.left - PAD.right) as string[]).map(
      (t): Renglon => ({ t, pt: 7.6, color: TINTA }),
    );
    doc.setFontSize(6.6);
    const det = lleno(it.detalle)
      ? (doc.splitTextToSize(pdfTxt(it.detalle), wDesc - PAD.left - PAD.right) as string[]).map((t): Renglon => ({ t, pt: 6.6, color: APAGADO }))
      : [];
    ricas.set(n, [...nombre, ...det]);
    const t = Number(it.total) || 0;
    if (it.tipo_iva === "EXENTA") sub.ex += t;
    else if (it.tipo_iva === "5%") sub.c5 += t;
    else sub.c10 += t;
    const unidad = lleno(it.unidad) && it.unidad !== "Unidad" ? ` ${it.unidad}` : "";
    return [
      pdfTxt(it.sku ?? ""),
      pdfTxt(`${cantidad(it.cantidad)}${unidad}`),
      "",
      num(it.precio_unitario),
      Number(it.descuento_pct) > 0 ? pct(it.descuento_pct) : "",
      it.tipo_iva === "EXENTA" ? num(t) : "",
      it.tipo_iva === "5%" ? num(t) : "",
      it.tipo_iva === "10%" ? num(t) : "",
    ];
  });

  const sp2 = { rowSpan: 2, styles: { valign: "middle" as const } };
  const head: RowInput[] = [
    [
      { content: "CÓD.", ...sp2 },
      { content: "CANT.", ...sp2, styles: { valign: "middle", halign: "right" } },
      { content: "DESCRIPCIÓN", ...sp2 },
      { content: "PRECIO UNIT.", ...sp2, styles: { valign: "middle", halign: "right" } },
      { content: "DESC.", ...sp2, styles: { valign: "middle", halign: "right" } },
      { content: "VALOR DE VENTA", colSpan: 3, styles: { halign: "center" } },
    ],
    [
      { content: "EXENTAS", styles: { halign: "right" } },
      { content: "5%", styles: { halign: "right" } },
      { content: "10%", styles: { halign: "right" } },
    ],
  ];

  autoTable(doc, {
    startY: y,
    margin: { left: MX, right: MX, top: TOP_SIG, bottom: PIE },
    head,
    body: filas,
    theme: "grid",
    showHead: "everyPage",
    rowPageBreak: "avoid",
    styles: estiloBase,
    headStyles: { fillColor: TINTE, textColor: MARCA_OSC, fontStyle: "bold", fontSize: 6.4, cellPadding: { top: 1.7, bottom: 1.7, left: PAD.left, right: PAD.right }, lineColor: BORDE, lineWidth: 0.2 },
    columnStyles: { ...columnStyles, 0: { ...columnStyles[0], textColor: APAGADO, fontSize: 6.8 } },
    didParseCell: (h: CellHookData) => {
      if (h.section !== "body" || h.column.index !== 2) return;
      const r = ricas.get(h.row.index);
      if (r) {
        h.cell.text = [""];
        h.cell.styles.minCellHeight = r.reduce((a, l) => a + alto(l.pt), 0) + PAD.top + PAD.bottom - 0.3;
      }
    },
    didDrawCell: (h: CellHookData) => {
      if (h.section !== "body" || h.column.index !== 2) return;
      const r = ricas.get(h.row.index);
      if (!r) return;
      let yy = h.cell.y + PAD.top;
      for (const l of r) {
        doc.setFont("helvetica", l.bold ? "bold" : "normal").setFontSize(l.pt).setTextColor(...l.color);
        doc.text(l.t, h.cell.x + PAD.left, yy + base(l.pt));
        yy += alto(l.pt);
      }
    },
    didDrawPage: () => {
      if (doc.getCurrentPageInfo().pageNumber > 1) encabezadoCorrido();
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  // ── 5. Totales (mismas columnas que el detalle, pegado debajo) ─────────────
  const etiquetaFila = (txt: string, extra: Record<string, unknown> = {}) => ({
    content: pdfTxt(txt), colSpan: 5, styles: { halign: "right" as const, fontStyle: "bold" as const, textColor: TEXTO, ...extra },
  });
  const tres = (txt: string, extra: Record<string, unknown> = {}) => ({ content: pdfTxt(txt), colSpan: 3, styles: { halign: "right" as const, ...extra } });
  const cuerpoTot: RowInput[] = [[etiquetaFila("Subtotal"), num(sub.ex), num(sub.c5), num(sub.c10)]];
  if (Number(p.descuento_lineas) > 0) {
    cuerpoTot.push([
      etiquetaFila("Descuentos por línea (ya aplicados en el detalle)", { fontStyle: "normal", textColor: APAGADO }),
      tres(num(p.descuento_lineas), { textColor: APAGADO }),
    ]);
  }
  if (Number(p.descuento_global) > 0) {
    const d = (a: number, b: number) => (a - (Number(b) || 0) > 0.0001 ? `- ${num(a - (Number(b) || 0))}` : "");
    cuerpoTot.push([
      etiquetaFila(`Descuento general (${pct(p.descuento_pct)})`),
      d(sub.ex, p.total_exenta), d(sub.c5, p.total_5), d(sub.c10, p.total_10),
    ]);
  }
  cuerpoTot.push([
    etiquetaFila("TOTAL DEL PRESUPUESTO", { textColor: TINTA, fontSize: 8.6, valign: "middle", fillColor: TINTE_SUAVE }),
    tres(monto(p.total, p.moneda), { fontStyle: "bold", fontSize: 11.5, textColor: MARCA, valign: "middle", fillColor: TINTE_SUAVE, cellPadding: { top: 2.4, bottom: 2.4, left: PAD.left, right: PAD.right } }),
  ]);
  cuerpoTot.push([
    { content: pdfTxt(`Total en letras: ${totalEnLetras(p.total, p.moneda)}`), colSpan: 8, styles: { fontStyle: "italic", textColor: TEXTO } },
  ]);
  const ivaCelda = (l: string, v: string) => ({ content: pdfTxt(`${l}: ${v}`), colSpan: 2, styles: { halign: "right" as const } });
  cuerpoTot.push([
    { content: "LIQUIDACIÓN DEL IVA", colSpan: 2, styles: { fontStyle: "bold", fontSize: 6.6, textColor: MARCA_OSC, fillColor: TINTE, valign: "middle" } },
    ivaCelda("IVA 5%", num(p.iva_5)),
    { content: pdfTxt(`IVA 10%: ${num(p.iva_10)}`), colSpan: 2, styles: { halign: "right" } },
    { content: pdfTxt(`Total IVA: ${num(p.total_iva)}`), colSpan: 2, styles: { halign: "right", fontStyle: "bold" } },
  ]);

  autoTable(doc, {
    startY: y,
    margin: { left: MX, right: MX, top: TOP_SIG, bottom: PIE },
    body: cuerpoTot,
    theme: "grid",
    pageBreak: "avoid",
    rowPageBreak: "avoid",
    styles: estiloBase,
    columnStyles,
    didDrawPage: () => {
      if (doc.getCurrentPageInfo().pageNumber > 1) encabezadoCorrido();
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // ── 6. Consultas ────────────────────────────────────────────────────────────
  const medios = [em?.vendedor_telefono || em?.telefono, em?.vendedor_email || em?.email].filter(lleno);
  if (lleno(p.vendedor_nombre) || medios.length) {
    if (y + 8 > PH - PIE) {
      doc.addPage();
      encabezadoCorrido();
      y = TOP_SIG;
    }
    const quien = lleno(p.vendedor_nombre) ? `contactá a ${p.vendedor_nombre}` : "contactanos";
    doc.setFont("helvetica", "bold").setFontSize(7.8).setTextColor(...TINTA);
    doc.text("¿Consultas?", MX, y);
    const wl = doc.getTextWidth("¿Consultas?") + 1.6;
    doc.setFont("helvetica", "normal").setTextColor(...TEXTO);
    doc.text(pdfTxt(`${quien[0].toUpperCase()}${quien.slice(1)}${medios.length ? `: ${medios.join(" · ")}` : ""}. Gracias por tu confianza.`), MX + wl, y, { maxWidth: ANCHO - wl });
  }

  // ── 7. Pie en cada página ───────────────────────────────────────────────────
  const total = doc.getNumberOfPages();
  const contacto = [empresa, ubicacion || null, lleno(em?.telefono) ? `Tel. ${em!.telefono}` : null, lleno(em?.email) ? em!.email : null, web]
    .filter(lleno)
    .join("   ·   ");
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(...MARCA).setLineWidth(0.35).line(MX, PH - 14, der, PH - 14);
    doc.setFont("helvetica", "normal").setFontSize(6.9).setTextColor(...APAGADO);
    doc.text(pdfTxt(contacto), MX, PH - 9.5, { maxWidth: ANCHO - 26 });
    doc.text(`Página ${i} de ${total}`, der, PH - 9.5, { align: "right" });
  }
  return doc;
}

export { nombreArchivoPresupuesto } from "@/modules/presupuestos/tipos";
