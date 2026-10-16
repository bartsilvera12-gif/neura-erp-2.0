/**
 * PDF del presupuesto (solo servidor). Lo usan la ruta interna (/api/presupuestos/[id]/pdf)
 * y la pública (/p/[token]/pdf): las dos le pasan el MISMO documento (presupuesto_json),
 * que trae solo campos públicos + el membrete (`emisor`: empresa, sucursal y contacto del
 * vendedor). Es lo que recibe el cliente final: diseño comercial, A4 vertical, márgenes
 * generosos, color de marca con moderación. Nunca muestra el estado interno (enviado,
 * aceptado…); solo la versión interna marca discretamente un presupuesto vencido.
 */
import autoTable, { type CellHookData } from "jspdf-autotable";
import type { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { clienteConfig } from "@/cliente.config";
import { COLOR, logoDoc, nuevoDocumento, pdfTxt, type RGB } from "@/lib/pdf/documento";
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
  respuesta_online: boolean | null;
  ruc?: string | null;
  email?: string | null;
  web?: string | null;
};
export type OpcionesPdfPresupuesto = {
  /** Link público completo (/p/<token>); si viene y el presupuesto está enviado, va el bloque "Aceptá online" con QR. */
  link?: string | null;
  /** Versión interna (descarga desde el ERP): marca discreta si está vencido. */
  interno?: boolean;
};

// ── Geometría y paleta ─────────────────────────────────────────────────────────
const PW = 210, PH = 297;
const MX = 18; // margen lateral
const ANCHO = PW - MX * 2;
const TOP_SIG = 26; // arriba en páginas 2+ (debajo del encabezado corrido)
const PIE = 24; // reservado abajo para el pie

const mezcla = (c: RGB, con: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(c[i] * (1 - t) + con[i] * t)) as RGB;
const BLANCO: RGB = [255, 255, 255];
const MARCA = COLOR.teal;
const MARCA_OSC = mezcla(MARCA, [0, 0, 0], 0.25);
const TINTE = mezcla(MARCA, BLANCO, 0.9);
const TINTE_SUAVE = mezcla(MARCA, BLANCO, 0.95);
const TINTA: RGB = [31, 41, 55];
const TEXTO: RGB = [75, 85, 99];
const APAGADO: RGB = [107, 114, 128];
const TENUE: RGB = [156, 163, 175];
const LINEA: RGB = [229, 231, 235];
const FONDO_GRIS: RGB = [248, 249, 250];
const AMBAR: RGB = [180, 83, 9];

/** Alto de renglón en mm para un cuerpo en pt (interlineado 1.25). */
const alto = (pt: number) => pt * 0.3528 * 1.25;
/** Desde el tope de un renglón hasta su línea base. */
const base = (pt: number) => pt * 0.3528 * 0.86;

type Renglon = { t: string; pt: number; bold?: boolean; color: RGB };

const lleno = (s: string | null | undefined): s is string => !!s && s.trim() !== "";

function etiqueta(doc: jsPDF, txt: string, x: number, y: number, color: RGB = MARCA) {
  doc.setFont("helvetica", "bold").setFontSize(6.8).setTextColor(...color);
  doc.text(pdfTxt(txt.toUpperCase()), x, y, { charSpace: 0.45 });
}

export async function pdfPresupuesto(p: PresupuestoDoc & { emisor?: EmisorPresupuesto | null }, opciones: OpcionesPdfPresupuesto = {}) {
  const doc = nuevoDocumento();
  const m = (v: number) => monto(v, p.moneda);
  const em = p.emisor ?? null;
  const empresa = em?.empresa || clienteConfig.nombre;
  const web = em?.web || clienteConfig.dominio;
  const ubicacion = [em?.direccion, em?.ciudad].filter(lleno).join(", ");
  const numeroTxt = `N° ${p.numero}`;
  const hayDescLinea = p.items.some((i) => Number(i.descuento_pct) > 0);
  const vencido = p.estado === "vencido";
  const enviado = p.estado === "enviado";
  const link = opciones.link && enviado ? opciones.link : null;

  // ── 1. Membrete ──────────────────────────────────────────────────────────────
  let y = 16;
  const logo = await logoDoc();
  let altoLogo = 0;
  if (logo) {
    const h = 15;
    const w = Math.min(42, (logo.w / logo.h) * h);
    const hh = (w * logo.h) / logo.w;
    doc.addImage(logo.data, "PNG", MX, y, w, hh, "logo", "FAST");
    altoLogo = hh;
  }
  const der = MX + ANCHO;
  doc.setFont("helvetica", "bold").setFontSize(11.5).setTextColor(...TINTA);
  doc.text(pdfTxt(empresa), der, y + 4, { align: "right" });
  let yd = y + 4 + 4.6;
  const datosEmpresa = [
    lleno(em?.ruc) ? `RUC ${em!.ruc}` : null,
    ubicacion || null,
    [lleno(em?.telefono) ? `Tel. ${em!.telefono}` : null, lleno(em?.email) ? em!.email : null].filter(Boolean).join("  ·  ") || null,
    web,
  ].filter(lleno);
  doc.setFont("helvetica", "normal").setFontSize(7.8).setTextColor(...APAGADO);
  for (const l of datosEmpresa) {
    doc.text(pdfTxt(l), der, yd, { align: "right" });
    yd += 3.7;
  }
  y = Math.max(y + altoLogo, yd - 2) + 7;
  doc.setDrawColor(...LINEA).setLineWidth(0.25).line(MX, y, der, y);
  y += 10;

  // ── 2. Título + metadatos (derecha) · 3. Preparado para (izquierda) ─────────
  const anchoMeta = 76;
  const xMeta = der - anchoMeta;
  const anchoIzq = ANCHO - anchoMeta - 8;
  const yBloque = y;

  doc.setFont("helvetica", "normal").setFontSize(27).setTextColor(...TINTA);
  doc.text("Presupuesto", MX - 0.6, y + 8.5);
  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...MARCA);
  doc.text(pdfTxt(numeroTxt), MX, y + 15.5);
  let xNum = MX + doc.getTextWidth(pdfTxt(numeroTxt));
  if (p.revision > 1) {
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...APAGADO);
    const r = `   ·   Revisión ${p.revision}`;
    doc.text(r, xNum, y + 15.5);
    xNum += doc.getTextWidth(r);
  }
  if (opciones.interno && vencido) {
    doc.setFont("helvetica", "bold").setFontSize(6.8);
    const t = "VENCIDO";
    const w = doc.getTextWidth(t) + 5;
    doc.setDrawColor(...AMBAR).setLineWidth(0.3).roundedRect(xNum + 4, y + 12.4, w, 4.4, 1, 1);
    doc.setTextColor(...AMBAR).text(t, xNum + 4 + w / 2, y + 15.5, { align: "center", charSpace: 0.3 });
  }

  // Metadatos: cada dato una sola vez.
  const metas: { l: string; v: string; sub?: string[] }[] = [
    { l: "Fecha de emisión", v: diaCorto(p.fecha) },
    { l: "Válido hasta", v: diaCorto(p.valido_hasta), sub: [`${p.validez_dias} día${p.validez_dias === 1 ? "" : "s"}`] },
    { l: "Condición de pago", v: condicionTexto(p.condicion, p.plazo_dias) },
    p.moneda === "USD"
      ? { l: "Moneda", v: "Dólares (US$)", sub: Number(p.tipo_cambio) > 0 ? [`T.C. ref. Gs. ${Math.round(p.tipo_cambio).toLocaleString("es-PY")}`] : [] }
      : { l: "Moneda", v: "Guaraníes (Gs.)" },
  ];
  if (lleno(p.vendedor_nombre)) {
    metas.push({ l: "Atendido por", v: p.vendedor_nombre, sub: [em?.vendedor_telefono, em?.vendedor_email].filter(lleno) });
  }
  const padM = 5;
  const anchoValor = anchoMeta - padM * 2 - 28;
  // Primero medir para dibujar la caja detrás.
  const medidas = metas.map((r) => {
    doc.setFont("helvetica", "bold").setFontSize(8.4);
    const v = doc.splitTextToSize(pdfTxt(r.v), anchoValor) as string[];
    return { ...r, lineas: v, h: v.length * alto(8.4) + (r.sub?.length ?? 0) * alto(7) + 2.6 };
  });
  const altoMetaNatural = padM * 2 - 2.6 + medidas.reduce((a, r) => a + r.h, 0);

  // Tarjeta del cliente: se mide igual.
  const c = p.cliente;
  const padC = 5.5;
  const anchoTxtC = anchoIzq - padC * 2;
  const yTarjeta = yBloque + 23;
  doc.setFont("helvetica", "bold").setFontSize(11);
  const nombreC = doc.splitTextToSize(pdfTxt(c.nombre || "Consumidor final"), anchoTxtC) as string[];
  const lineasC: Renglon[] = [];
  const datoC = (txt: string) => {
    doc.setFont("helvetica", "normal").setFontSize(8.2);
    for (const l of doc.splitTextToSize(pdfTxt(txt), anchoTxtC) as string[]) lineasC.push({ t: l, pt: 8.2, color: TEXTO });
  };
  if (lleno(c.ruc)) datoC(`RUC / CI: ${c.ruc}`);
  if (lleno(c.direccion)) datoC(c.direccion);
  const contactoC = [lleno(c.telefono) ? `Tel. ${c.telefono}` : null, lleno(c.email) ? c.email : null].filter(Boolean).join("   ·   ");
  if (contactoC) datoC(contactoC);
  const altoTarjetaNatural = padC + 3 + 4 + nombreC.length * alto(11) + lineasC.length * alto(8.2) + padC - 1;

  const fondo = Math.max(yBloque + altoMetaNatural, yTarjeta + altoTarjetaNatural);
  const altoMeta = fondo - yBloque;
  const altoTarjeta = fondo - yTarjeta;

  doc.setFillColor(...TINTE_SUAVE).roundedRect(xMeta, yBloque, anchoMeta, altoMeta, 2, 2, "F");
  let ym = yBloque + padM + (altoMeta - altoMetaNatural) / 2;
  for (const r of medidas) {
    doc.setFont("helvetica", "normal").setFontSize(7.6).setTextColor(...APAGADO);
    doc.text(pdfTxt(r.l), xMeta + padM, ym + base(8.4));
    doc.setFont("helvetica", "bold").setFontSize(8.4).setTextColor(...TINTA);
    r.lineas.forEach((l, i) => doc.text(l, xMeta + anchoMeta - padM, ym + base(8.4) + i * alto(8.4), { align: "right" }));
    let ys = ym + r.lineas.length * alto(8.4);
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...APAGADO);
    for (const s of r.sub ?? []) {
      doc.text(pdfTxt(s), xMeta + anchoMeta - padM, ys + base(7), { align: "right" });
      ys += alto(7);
    }
    ym += r.h;
  }

  doc.setDrawColor(...LINEA).setLineWidth(0.3).roundedRect(MX, yTarjeta, anchoIzq, altoTarjeta, 2, 2, "S");
  doc.setFillColor(...MARCA).rect(MX, yTarjeta + 4, 0.9, altoTarjeta - 8, "F");
  let yc = yTarjeta + padC + 2.4;
  etiqueta(doc, "Preparado para", MX + padC, yc);
  yc += 4;
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...TINTA);
  for (const l of nombreC) {
    doc.text(l, MX + padC, yc + base(11));
    yc += alto(11);
  }
  yc += 0.6;
  doc.setFont("helvetica", "normal").setFontSize(8.2).setTextColor(...TEXTO);
  for (const r of lineasC) {
    doc.text(r.t, MX + padC, yc + base(8.2));
    yc += alto(8.2);
  }
  y = fondo + 10;

  // ── 4. Ítems ────────────────────────────────────────────────────────────────
  const anchos = { n: 8, cant: 19, precio: 29, desc: hayDescLinea ? 15 : 0, total: 31 };
  const anchoDesc = ANCHO - anchos.n - anchos.cant - anchos.precio - anchos.desc - anchos.total;
  const COL = { n: 0, desc: 1, cant: 2, precio: 3, ...(hayDescLinea ? { dcto: 4, total: 5 } : { dcto: -1, total: 4 }) };
  const PAD = { top: 2.8, bottom: 2.8, left: 2.4, right: 2.4 };
  const head = ["#", "Descripción", "Cant.", "Precio unit.", ...(hayDescLinea ? ["Desc."] : []), "Total"].map((h) => h.toUpperCase());
  const ivaTxt = (t: string) => (t === "EXENTA" ? "Exenta" : `IVA ${t}`);

  // Celdas "ricas" (varias tipografías): se miden acá y se dibujan en didDrawCell.
  const ricas = new Map<string, { lineas: Renglon[]; derecha: boolean }>();
  const medirRica = (lineas: Renglon[]) => lineas.reduce((a, l) => a + alto(l.pt), 0) + PAD.top + PAD.bottom - 0.6;
  const filas = p.items.map((it, n) => {
    doc.setFont("helvetica", "bold").setFontSize(8.6);
    const nombre = (doc.splitTextToSize(pdfTxt(it.descripcion), anchoDesc - PAD.left - PAD.right) as string[]).map(
      (t): Renglon => ({ t, pt: 8.6, bold: true, color: TINTA }),
    );
    const extra = [lleno(it.sku) ? `Cód. ${it.sku}` : null, lleno(it.detalle) ? it.detalle : null].filter(Boolean).join("  ·  ");
    doc.setFont("helvetica", "normal").setFontSize(7.2);
    const sub = extra
      ? (doc.splitTextToSize(pdfTxt(extra), anchoDesc - PAD.left - PAD.right) as string[]).map((t): Renglon => ({ t, pt: 7.2, color: APAGADO }))
      : [];
    ricas.set(`${n}-${COL.desc}`, { lineas: [...nombre, ...sub], derecha: false });
    const unidad = lleno(it.unidad) && it.unidad !== "Unidad" ? it.unidad : null;
    ricas.set(`${n}-${COL.cant}`, {
      lineas: [{ t: cantidad(it.cantidad), pt: 8.6, color: TINTA }, ...(unidad ? [{ t: pdfTxt(unidad), pt: 6.8, color: TENUE }] : [])],
      derecha: true,
    });
    ricas.set(`${n}-${COL.precio}`, {
      lineas: [{ t: pdfTxt(m(it.precio_unitario)), pt: 8.6, color: TINTA }, { t: ivaTxt(it.tipo_iva), pt: 6.8, color: TENUE }],
      derecha: true,
    });
    return [
      String(n + 1),
      "",
      "",
      "",
      ...(hayDescLinea ? [Number(it.descuento_pct) > 0 ? pct(it.descuento_pct) : "—"] : []),
      pdfTxt(m(it.total)),
    ];
  });

  const encabezadoCorrido = () => {
    doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...TINTA);
    doc.text(pdfTxt(empresa), MX, 15);
    doc.setFont("helvetica", "normal").setFontSize(7.8).setTextColor(...APAGADO);
    doc.text(pdfTxt(`Presupuesto ${numeroTxt}${p.revision > 1 ? ` · Rev. ${p.revision}` : ""}`), der, 15, { align: "right" });
    doc.setDrawColor(...LINEA).setLineWidth(0.25).line(MX, 18, der, 18);
  };

  autoTable(doc, {
    startY: y,
    margin: { left: MX, right: MX, top: TOP_SIG, bottom: PIE },
    head: [head],
    body: filas,
    theme: "plain",
    showHead: "everyPage",
    rowPageBreak: "avoid",
    styles: {
      font: "helvetica", fontSize: 8.6, textColor: TINTA, cellPadding: PAD, valign: "top", overflow: "linebreak",
      lineColor: LINEA, lineWidth: { bottom: 0.2 },
    },
    headStyles: {
      fillColor: TINTE, textColor: MARCA_OSC, fontStyle: "bold", fontSize: 6.9, valign: "middle",
      cellPadding: { top: 2.6, bottom: 2.6, left: PAD.left, right: PAD.right }, lineWidth: 0.3, lineColor: TINTE,
    },
    columnStyles: {
      [COL.n]: { cellWidth: anchos.n, halign: "center", textColor: TENUE, fontSize: 7.6 },
      [COL.desc]: { cellWidth: anchoDesc },
      [COL.cant]: { cellWidth: anchos.cant, halign: "right" },
      [COL.precio]: { cellWidth: anchos.precio, halign: "right" },
      ...(hayDescLinea ? { [COL.dcto]: { cellWidth: anchos.desc, halign: "right" as const, textColor: TEXTO } } : {}),
      [COL.total]: { cellWidth: anchos.total, halign: "right", fontStyle: "bold" },
    },
    didParseCell: (h: CellHookData) => {
      if (h.section === "head") {
        h.cell.styles.halign = h.column.index === COL.n ? "center" : h.column.index === COL.desc ? "left" : "right";
        return;
      }
      const r = ricas.get(`${h.row.index}-${h.column.index}`);
      if (r) {
        h.cell.text = [""];
        h.cell.styles.minCellHeight = medirRica(r.lineas);
      }
    },
    didDrawCell: (h: CellHookData) => {
      if (h.section !== "body") return;
      const r = ricas.get(`${h.row.index}-${h.column.index}`);
      if (!r) return;
      let yy = h.cell.y + PAD.top;
      for (const l of r.lineas) {
        doc.setFont("helvetica", l.bold ? "bold" : "normal").setFontSize(l.pt).setTextColor(...l.color);
        const x = r.derecha ? h.cell.x + h.cell.width - PAD.right : h.cell.x + PAD.left;
        doc.text(l.t, x, yy + base(l.pt), r.derecha ? { align: "right" } : undefined);
        yy += alto(l.pt);
      }
    },
    didDrawPage: () => {
      if (doc.getCurrentPageInfo().pageNumber > 1) encabezadoCorrido();
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 9;

  const nuevaPagina = () => {
    doc.addPage();
    encabezadoCorrido();
    return TOP_SIG;
  };
  const limite = PH - PIE;

  // ── 5. Totales (derecha) + condiciones comerciales (izquierda) ──────────────
  const anchoTot = 80;
  const xTot = der - anchoTot;
  const anchoCond = ANCHO - anchoTot - 12;

  const renglonesTot: [string, string][] = [];
  if (Number(p.descuento_lineas) > 0 || Number(p.descuento_global) > 0) {
    renglonesTot.push(["Subtotal", m(p.subtotal_bruto)]);
    if (Number(p.descuento_lineas) > 0) renglonesTot.push(["Descuentos", `- ${m(p.descuento_lineas)}`]);
    if (Number(p.descuento_global) > 0) renglonesTot.push([`Descuento general (${pct(p.descuento_pct)})`, `- ${m(p.descuento_global)}`]);
  }
  const ivas: [string, number, number | null][] = [];
  if (Number(p.total_10)) ivas.push(["Gravado 10%", p.total_10, p.iva_10]);
  if (Number(p.total_5)) ivas.push(["Gravado 5%", p.total_5, p.iva_5]);
  if (Number(p.total_exenta)) ivas.push(["Exento", p.total_exenta, null]);
  const altoIva = 4 + 4.4 + ivas.length * 4 + 5 + 2.5;
  const altoTotales = renglonesTot.length * 5.4 + (renglonesTot.length ? 3 : 0) + 13 + 4 + altoIva;

  // Texto de la izquierda: condiciones + validez.
  const notaValidez =
    `Esta propuesta es válida hasta el ${diaCorto(p.valido_hasta)} (${p.validez_dias} día${p.validez_dias === 1 ? "" : "s"} desde su emisión). ` +
    `Pasada esa fecha, los precios y la disponibilidad quedan sujetos a confirmación. Precios con IVA incluido` +
    `${p.moneda === "USD" ? ", expresados en dólares americanos" : ", expresados en guaraníes"}.`;
  doc.setFont("helvetica", "normal").setFontSize(8);
  const condLineas = lleno(p.condiciones) ? (doc.splitTextToSize(pdfTxt(p.condiciones), anchoCond) as string[]) : [];
  const validezLineas = doc.splitTextToSize(pdfTxt(notaValidez), anchoCond) as string[];
  const altoCondPrimero = (condLineas.length ? 6 + Math.min(condLineas.length, 8) * 3.9 + 5 : 0) + 6 + validezLineas.length * 3.9;

  if (y + Math.max(altoTotales, Math.min(altoCondPrimero, 60)) > limite) y = nuevaPagina() + 2;
  const yIni = y;

  // Totales
  let yt = y + 1;
  doc.setFontSize(8.4);
  for (const [l, v] of renglonesTot) {
    doc.setFont("helvetica", "normal").setTextColor(...APAGADO).text(pdfTxt(l), xTot, yt);
    doc.setTextColor(...TINTA).text(pdfTxt(v), der, yt, { align: "right" });
    yt += 5.4;
  }
  if (renglonesTot.length) yt += 1.6;
  doc.setDrawColor(...MARCA).setLineWidth(0.5).line(xTot, yt - 1.4, der, yt - 1.4);
  etiqueta(doc, "Total", xTot, yt + 6.6, TINTA);
  doc.setFont("helvetica", "bold").setFontSize(17).setTextColor(...MARCA);
  doc.text(pdfTxt(m(p.total)), der, yt + 7.6, { align: "right" });
  yt += 13.4;

  // IVA incluido (tabla chica gris)
  doc.setFillColor(...FONDO_GRIS).roundedRect(xTot, yt, anchoTot, altoIva, 1.6, 1.6, "F");
  const xBase = der - 30, xIva = der - 3.5;
  let yi = yt + 4.6;
  doc.setFont("helvetica", "bold").setFontSize(6.6).setTextColor(...APAGADO);
  doc.text("IVA INCLUIDO", xTot + 3.5, yi, { charSpace: 0.35 });
  doc.text("GRAVADO", xBase, yi, { align: "right", charSpace: 0.35 });
  doc.text("IVA", xIva, yi, { align: "right", charSpace: 0.35 });
  yi += 4.6;
  doc.setFont("helvetica", "normal").setFontSize(7.4);
  for (const [l, b, iva] of ivas) {
    doc.setTextColor(...APAGADO).text(l, xTot + 3.5, yi);
    doc.setTextColor(...TEXTO).text(pdfTxt(m(b)), xBase, yi, { align: "right" });
    doc.text(iva == null ? "—" : pdfTxt(m(iva)), xIva, yi, { align: "right" });
    yi += 4;
  }
  doc.setDrawColor(...LINEA).setLineWidth(0.2).line(xTot + 3.5, yi - 2.6, xIva, yi - 2.6);
  yi += 1;
  doc.setFont("helvetica", "bold").setFontSize(7.4).setTextColor(...TEXTO);
  doc.text("Total IVA", xTot + 3.5, yi);
  doc.text(pdfTxt(m(p.total_iva)), xIva, yi, { align: "right" });
  yt += altoIva;

  // Condiciones comerciales + validez (izquierda; si son largas siguen en la página siguiente)
  let yc2 = yIni + 1;
  const parrafo = (titulo: string, lineas: string[]) => {
    if (yc2 + 10 > limite) yc2 = nuevaPagina() + 2;
    etiqueta(doc, titulo, MX, yc2);
    yc2 += 5;
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...TEXTO);
    for (const l of lineas) {
      if (yc2 > limite) {
        yc2 = nuevaPagina() + 2;
        doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...TEXTO);
      }
      doc.text(l, MX, yc2);
      yc2 += 3.9;
    }
    yc2 += 4;
  };
  const paginaTotales = doc.getCurrentPageInfo().pageNumber;
  if (condLineas.length) parrafo("Condiciones comerciales", condLineas);
  parrafo("Validez de la oferta", validezLineas);
  const mismaPagina = doc.getCurrentPageInfo().pageNumber === paginaTotales;
  y = (mismaPagina ? Math.max(yt, yc2) : yc2) + 8;
  if (!mismaPagina) doc.setPage(doc.getNumberOfPages());

  // ── 6. Aceptación online + firma ────────────────────────────────────────────
  const altoCierre = 36;
  if (y + altoCierre > limite) y = nuevaPagina() + 4;
  const anchoFirma = 66;
  const xFirma = der - anchoFirma;
  const anchoOnline = ANCHO - anchoFirma - 12;

  if (link) {
    let qr: string | null = null;
    try {
      qr = await QRCode.toDataURL(link, { margin: 0, width: 360, errorCorrectionLevel: "M", color: { dark: "#1F2937", light: "#FFFFFF" } });
    } catch {
      qr = null;
    }
    const lado = 24;
    const padO = 5;
    doc.setDrawColor(...mezcla(MARCA, BLANCO, 0.6)).setLineWidth(0.3).roundedRect(MX, y, anchoOnline, lado + padO * 2, 2, 2, "S");
    if (qr) doc.addImage(qr, "PNG", MX + padO, y + padO, lado, lado, "qr", "FAST");
    const xt = MX + padO + (qr ? lado + 5 : 0);
    const anchoT = anchoOnline - (xt - MX) - padO;
    const responde = em?.respuesta_online !== false;
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...TINTA);
    doc.text(responde ? "Aceptá este presupuesto online" : "Consultá este presupuesto online", xt, y + padO + 4.2);
    doc.setFont("helvetica", "normal").setFontSize(7.6).setTextColor(...APAGADO);
    const explic = responde
      ? `${qr ? "Escaneá el código o abrí el link" : "Abrí el link"} para ver el detalle y confirmarlo con un clic, sin imprimir ni firmar.`
      : `${qr ? "Escaneá el código o abrí el link" : "Abrí el link"} para ver el detalle siempre actualizado.`;
    const le = doc.splitTextToSize(pdfTxt(explic), anchoT) as string[];
    doc.text(le, xt, y + padO + 9.4);
    const corto = link.replace(/^https?:\/\//, "").replace(/(\/p\/[0-9a-f]{10})[0-9a-f]+$/i, "$1…");
    doc.setFont("helvetica", "bold").setFontSize(7.8).setTextColor(...MARCA);
    doc.textWithLink(pdfTxt(corto), xt, y + padO + 9.4 + le.length * 3.4 + 2.6, { url: link });
  } else {
    // Sin link: contacto para consultas.
    etiqueta(doc, "¿Consultas?", MX, y + 12);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...TEXTO);
    const quien = lleno(p.vendedor_nombre) ? `Contactá a ${p.vendedor_nombre}` : `Contactanos`;
    const medios = [em?.vendedor_telefono || em?.telefono, em?.vendedor_email || em?.email].filter(lleno);
    const t = doc.splitTextToSize(pdfTxt(`${quien}${medios.length ? `: ${medios.join(" · ")}` : ""}. Será un gusto atenderte.`), anchoOnline) as string[];
    doc.text(t, MX, y + 17);
    doc.setFont("helvetica", "normal").setFontSize(7.4).setTextColor(...APAGADO);
    doc.text("Gracias por tu confianza.", MX, y + 17 + t.length * 3.9 + 1.5);
  }

  // Firma del cliente
  const yLinea = y + 22;
  doc.setDrawColor(...TENUE).setLineWidth(0.25).line(xFirma, yLinea, der, yLinea);
  doc.setFont("helvetica", "normal").setFontSize(7.2).setTextColor(...APAGADO);
  doc.text("Firma del cliente", xFirma, yLinea + 3.8);
  const yAcl = yLinea + 11;
  doc.line(xFirma, yAcl, der - 26, yAcl);
  doc.line(der - 22, yAcl, der, yAcl);
  doc.text("Aclaración", xFirma, yAcl + 3.8);
  doc.text("Fecha", der - 22, yAcl + 3.8);

  // ── 8. Pie en cada página ───────────────────────────────────────────────────
  const total = doc.getNumberOfPages();
  const contacto = [empresa, ubicacion || null, lleno(em?.telefono) ? `Tel. ${em!.telefono}` : null, lleno(em?.email) ? em!.email : null, web]
    .filter(lleno)
    .join("   ·   ");
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(...MARCA).setLineWidth(0.35).line(MX, PH - 15, der, PH - 15);
    doc.setFont("helvetica", "normal").setFontSize(6.9).setTextColor(...APAGADO);
    doc.text(pdfTxt(contacto), MX, PH - 10.5, { maxWidth: ANCHO - 26 });
    doc.text(`Página ${i} de ${total}`, der, PH - 10.5, { align: "right" });
  }
  return doc;
}

export { nombreArchivoPresupuesto } from "@/modules/presupuestos/tipos";
