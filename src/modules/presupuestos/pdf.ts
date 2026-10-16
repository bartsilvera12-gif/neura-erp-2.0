/**
 * PDF del presupuesto (solo servidor). Lo usan la ruta interna (/api/presupuestos/[id]/pdf)
 * y la pública (/p/[token]/pdf): las dos le pasan el MISMO documento (presupuesto_json),
 * que trae solo campos públicos + el membrete (`emisor`: empresa, sucursal y contacto del
 * vendedor). Es lo que recibe el cliente final (se crea, se descarga y se manda el PDF):
 * diseño comercial, A4 vertical, márgenes generosos, color de marca con moderación.
 * Nunca muestra el estado interno (enviado, aceptado…); solo la versión interna marca
 * discretamente un presupuesto vencido.
 */
import autoTable, { type CellHookData } from "jspdf-autotable";
import type { jsPDF } from "jspdf";
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
  respuesta_online?: boolean | null;
  ruc?: string | null;
  email?: string | null;
  web?: string | null;
};
export type OpcionesPdfPresupuesto = {
  /** Versión interna (descarga desde el ERP): marca discreta si está vencido. */
  interno?: boolean;
  /** Sin uso: el PDF no lleva links (se manda como archivo). Se acepta para no romper llamadas viejas. */
  link?: string | null;
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
const TINTE_SUAVE = mezcla(MARCA, BLANCO, 0.955);
const TINTA: RGB = [31, 41, 55];
const TEXTO: RGB = [75, 85, 99];
const APAGADO: RGB = [107, 114, 128];
const TENUE: RGB = [156, 163, 175];
const LINEA: RGB = [229, 231, 235];
const AMBAR: RGB = [180, 83, 9];

/** Alto de renglón en mm para un cuerpo en pt (interlineado 1.25). */
const alto = (pt: number) => pt * 0.3528 * 1.25;
/** Desde el tope de un renglón hasta su línea base. */
const base = (pt: number) => pt * 0.3528 * 0.86;

type Renglon = { t: string; pt: number; bold?: boolean; color: RGB };

const lleno = (s: string | null | undefined): s is string => !!s && s.trim() !== "";

function etiqueta(doc: jsPDF, txt: string, x: number, y: number, color: RGB = MARCA, align: "left" | "right" = "left") {
  doc.setFont("helvetica", "bold").setFontSize(6.6).setTextColor(...color);
  doc.text(pdfTxt(txt.toUpperCase()), x, y, { charSpace: 0.45, align });
}

/** Recuadro redondeado con una franja inferior de otro color (desde `yFranja`). */
function recuadroConFranja(doc: jsPDF, x: number, y: number, w: number, h: number, yFranja: number | null, r = 2.2) {
  if (yFranja != null && yFranja < y + h) {
    doc.setFillColor(...TINTE_SUAVE).roundedRect(x, y, w, h, r, r, "F");
    doc.setFillColor(...BLANCO).roundedRect(x, y, w, yFranja - y, r, r, "F");
    doc.rect(x, yFranja - r, w, r, "F");
    doc.setDrawColor(...LINEA).setLineWidth(0.25).line(x, yFranja, x + w, yFranja);
  }
  doc.setDrawColor(...LINEA).setLineWidth(0.3).roundedRect(x, y, w, h, r, r, "S");
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
  const der = MX + ANCHO;

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
  y = Math.max(y + altoLogo, yd - 2) + 8;

  // ── 2. Cuadro del documento: título + N° · cliente | datos · condiciones | validez ──
  const pad = 7;
  const xIn = MX + pad;
  const anchoIn = ANCHO - pad * 2;
  const anchoMeta = 74;
  const gapCol = 12;
  const anchoCli = anchoIn - anchoMeta - gapCol;
  const xMeta = der - pad - anchoMeta;
  const xDiv = xMeta - gapCol / 2;

  // Medidas: fila del título
  const yCaja = y;
  const altoTitulo = 20;
  const yCuerpo = yCaja + altoTitulo;

  // Cliente
  const c = p.cliente;
  doc.setFont("helvetica", "bold").setFontSize(11);
  const nombreC = doc.splitTextToSize(pdfTxt(c.nombre || "Consumidor final"), anchoCli) as string[];
  const lineasC: string[] = [];
  const datoC = (txt: string) => {
    doc.setFont("helvetica", "normal").setFontSize(8.2);
    lineasC.push(...(doc.splitTextToSize(pdfTxt(txt), anchoCli) as string[]));
  };
  if (lleno(c.ruc)) datoC(`RUC / CI: ${c.ruc}`);
  if (lleno(c.direccion)) datoC(c.direccion);
  if (lleno(c.telefono)) datoC(`Tel. ${c.telefono}`);
  if (lleno(c.email)) datoC(c.email);
  const altoCli = 4.4 + nombreC.length * alto(11) + 0.6 + lineasC.length * alto(8.2);

  // Datos del presupuesto (cada dato una sola vez)
  const metas: { l: string; v: string; sub?: string[] }[] = [
    { l: "Fecha de emisión", v: diaCorto(p.fecha) },
    { l: "Válido hasta", v: `${diaCorto(p.valido_hasta)}  (${p.validez_dias} día${p.validez_dias === 1 ? "" : "s"})` },
    { l: "Condición de pago", v: condicionTexto(p.condicion, p.plazo_dias) },
    p.moneda === "USD"
      ? { l: "Moneda", v: "Dólares (US$)", sub: Number(p.tipo_cambio) > 0 ? [`T.C. ref. Gs. ${Math.round(p.tipo_cambio).toLocaleString("es-PY")}`] : [] }
      : { l: "Moneda", v: "Guaraníes (Gs.)" },
  ];
  if (lleno(p.vendedor_nombre)) {
    metas.push({ l: "Atendido por", v: p.vendedor_nombre, sub: [em?.vendedor_telefono, em?.vendedor_email].filter(lleno) });
  }
  const anchoValor = anchoMeta - 30;
  const medidas = metas.map((r) => {
    doc.setFont("helvetica", "bold").setFontSize(8.3);
    const v = doc.splitTextToSize(pdfTxt(r.v), anchoValor) as string[];
    return { ...r, lineas: v, h: v.length * alto(8.3) + (r.sub?.length ?? 0) * alto(7) + 2 };
  });
  const altoMeta = 4.4 + medidas.reduce((a, r) => a + r.h, 0) - 2;
  const altoCuerpo = pad + Math.max(altoCli, altoMeta) + pad - 1;

  // Franja inferior: condiciones comerciales | validez de la oferta
  const notaValidez =
    `Válido hasta el ${diaCorto(p.valido_hasta)} (${p.validez_dias} día${p.validez_dias === 1 ? "" : "s"} desde su emisión). ` +
    `Pasada esa fecha, precios y disponibilidad quedan sujetos a confirmación. Precios con IVA incluido` +
    `${p.moneda === "USD" ? ", en dólares americanos" : ", en guaraníes"}.`;
  const hayCond = lleno(p.condiciones);
  const anchoCond = hayCond ? anchoCli : 0;
  const anchoVal = hayCond ? anchoMeta : anchoIn;
  doc.setFont("helvetica", "normal").setFontSize(7.8);
  const condLineas = hayCond ? (doc.splitTextToSize(pdfTxt(p.condiciones!), anchoCond) as string[]) : [];
  const valLineas = doc.splitTextToSize(pdfTxt(notaValidez), anchoVal) as string[];
  const altoFranja = 5.5 + 4.2 + Math.max(condLineas.length, valLineas.length) * alto(7.8) + 3.5;

  const yFranja = yCuerpo + altoCuerpo;
  const altoCaja = altoTitulo + altoCuerpo + altoFranja;
  recuadroConFranja(doc, MX, yCaja, ANCHO, altoCaja, yFranja);

  // Fila del título
  doc.setFont("helvetica", "normal").setFontSize(23).setTextColor(...TINTA);
  doc.text("Presupuesto", xIn - 0.4, yCaja + 13.2);
  etiqueta(doc, "Número", der - pad, yCaja + 7.6, APAGADO, "right");
  doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(...MARCA);
  const numDer = `${p.numero}${p.revision > 1 ? `  ·  Rev. ${p.revision}` : ""}`;
  doc.text(pdfTxt(numDer), der - pad, yCaja + 13.4, { align: "right" });
  if (opciones.interno && vencido) {
    const wNum = doc.getTextWidth(pdfTxt(numDer));
    doc.setFont("helvetica", "bold").setFontSize(6.6);
    const t = "VENCIDO";
    const w = doc.getTextWidth(t) + 5;
    const xT = der - pad - wNum - 4 - w;
    doc.setDrawColor(...AMBAR).setLineWidth(0.3).roundedRect(xT, yCaja + 10.3, w, 4.4, 1, 1);
    doc.setTextColor(...AMBAR).text(t, xT + w / 2, yCaja + 13.4, { align: "center", charSpace: 0.3 });
  }
  doc.setDrawColor(...LINEA).setLineWidth(0.25).line(MX, yCuerpo, der, yCuerpo);
  // acento de marca bajo el título
  doc.setFillColor(...MARCA).rect(xIn, yCuerpo - 0.35, 16, 0.7, "F");

  // Cuerpo: cliente (izq.) | datos (der.), con divisor vertical
  doc.setDrawColor(...LINEA).setLineWidth(0.25).line(xDiv, yCuerpo + pad - 1, xDiv, yFranja - pad + 1);
  let yc = yCuerpo + pad + 1.6;
  etiqueta(doc, "Preparado para", xIn, yc);
  yc += 2.8;
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...TINTA);
  for (const l of nombreC) {
    doc.text(l, xIn, yc + base(11));
    yc += alto(11);
  }
  yc += 0.6;
  doc.setFont("helvetica", "normal").setFontSize(8.2).setTextColor(...TEXTO);
  for (const l of lineasC) {
    doc.text(l, xIn, yc + base(8.2));
    yc += alto(8.2);
  }

  let ym = yCuerpo + pad + 1.6;
  etiqueta(doc, "Datos del presupuesto", xMeta, ym);
  ym += 2.8;
  for (const r of medidas) {
    doc.setFont("helvetica", "normal").setFontSize(7.6).setTextColor(...APAGADO);
    doc.text(pdfTxt(r.l), xMeta, ym + base(8.3));
    doc.setFont("helvetica", "bold").setFontSize(8.3).setTextColor(...TINTA);
    r.lineas.forEach((l, i) => doc.text(l, der - pad, ym + base(8.3) + i * alto(8.3), { align: "right" }));
    let ys = ym + r.lineas.length * alto(8.3);
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...APAGADO);
    for (const s of r.sub ?? []) {
      doc.text(pdfTxt(s), der - pad, ys + base(7), { align: "right" });
      ys += alto(7);
    }
    ym += r.h;
  }

  // Franja: condiciones | validez
  const yF = yFranja + 5.5;
  const columnaFranja = (titulo: string, lineas: string[], x: number) => {
    etiqueta(doc, titulo, x, yF);
    doc.setFont("helvetica", "normal").setFontSize(7.8).setTextColor(...TEXTO);
    lineas.forEach((l, i) => doc.text(l, x, yF + 4.2 + base(7.8) - 1 + i * alto(7.8)));
  };
  if (hayCond) {
    columnaFranja("Condiciones comerciales", condLineas, xIn);
    columnaFranja("Validez de la oferta", valLineas, xMeta);
  } else {
    columnaFranja("Validez de la oferta", valLineas, xIn);
  }
  y = yCaja + altoCaja + 9;

  // ── 3. Ítems ────────────────────────────────────────────────────────────────
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
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;

  const limite = PH - PIE;
  const nuevaPagina = () => {
    doc.addPage();
    encabezadoCorrido();
    return TOP_SIG + 2;
  };

  // ── 4. Totales: un recuadro del ancho de la tabla (IVA incluido | resumen y total) ──
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

  const padT = 6;
  const anchoIvaCol = 82;
  const xDivT = MX + padT + anchoIvaCol + 6;
  const xRes = xDivT + 8;
  const altoIvaCont = 4.4 + ivas.length * 4.4 + 1.2 + 4.4;
  const altoResCont = renglonesTot.length * 5.4 + (renglonesTot.length ? 2.4 : 0) + 11;
  const altoTot = padT * 2 + Math.max(altoIvaCont, altoResCont);
  if (y + altoTot + 16 > limite) y = nuevaPagina();
  const yT = y;
  doc.setDrawColor(...LINEA).setLineWidth(0.3).roundedRect(MX, yT, ANCHO, altoTot, 2.2, 2.2, "S");
  // Mitad izquierda con tinte suave
  doc.setFillColor(...TINTE_SUAVE).roundedRect(MX + 0.15, yT + 0.15, xDivT - MX, altoTot - 0.3, 2.1, 2.1, "F");
  doc.setFillColor(...TINTE_SUAVE).rect(xDivT - 3, yT + 0.15, 3, altoTot - 0.3, "F");
  doc.setDrawColor(...LINEA).setLineWidth(0.25).line(xDivT, yT, xDivT, yT + altoTot);

  // IVA incluido
  const xI = MX + padT;
  const xBase = xI + anchoIvaCol - 30, xIva = xI + anchoIvaCol;
  let yi = yT + padT + 2.4 + (altoTot - padT * 2 - altoIvaCont) / 2;
  doc.setFont("helvetica", "bold").setFontSize(6.6).setTextColor(...MARCA);
  doc.text("IVA INCLUIDO", xI, yi, { charSpace: 0.45 });
  doc.setTextColor(...APAGADO);
  doc.text("GRAVADO", xBase, yi, { align: "right", charSpace: 0.45 });
  doc.text("IVA", xIva, yi, { align: "right", charSpace: 0.45 });
  yi += 4.6;
  doc.setFont("helvetica", "normal").setFontSize(7.6);
  for (const [l, b, iva] of ivas) {
    doc.setTextColor(...APAGADO).text(l, xI, yi);
    doc.setTextColor(...TEXTO).text(pdfTxt(m(b)), xBase, yi, { align: "right" });
    doc.text(iva == null ? "—" : pdfTxt(m(iva)), xIva, yi, { align: "right" });
    yi += 4.4;
  }
  doc.setDrawColor(...mezcla(MARCA, BLANCO, 0.75)).setLineWidth(0.2).line(xI, yi - 2.8, xIva, yi - 2.8);
  yi += 1.2;
  doc.setFont("helvetica", "bold").setFontSize(7.6).setTextColor(...TINTA);
  doc.text("Total IVA", xI, yi);
  doc.text(pdfTxt(m(p.total_iva)), xIva, yi, { align: "right" });

  // Resumen y total (abajo a la derecha)
  const xResDer = der - padT;
  let yr = yT + padT + (altoTot - padT * 2 - altoResCont) + 2.6;
  doc.setFontSize(8.4);
  for (const [l, v] of renglonesTot) {
    doc.setFont("helvetica", "normal").setTextColor(...APAGADO).text(pdfTxt(l), xRes, yr);
    doc.setTextColor(...TINTA).text(pdfTxt(v), xResDer, yr, { align: "right" });
    yr += 5.4;
  }
  if (renglonesTot.length) {
    doc.setDrawColor(...MARCA).setLineWidth(0.45).line(xRes, yr - 2.6, xResDer, yr - 2.6);
    yr += 2.4;
  }
  etiqueta(doc, "Total", xRes, yr + 4.6, TINTA);
  doc.setFont("helvetica", "bold").setFontSize(17).setTextColor(...MARCA);
  doc.text(pdfTxt(m(p.total)), xResDer, yr + 5.6, { align: "right" });
  y = yT + altoTot + 9;

  // ── 5. Consultas ────────────────────────────────────────────────────────────
  const medios = [em?.vendedor_telefono || em?.telefono, em?.vendedor_email || em?.email].filter(lleno);
  if (lleno(p.vendedor_nombre) || medios.length) {
    if (y + 12 > limite) y = nuevaPagina();
    const quien = lleno(p.vendedor_nombre) ? `Contactá a ${p.vendedor_nombre}` : "Contactanos";
    etiqueta(doc, "¿Consultas?", MX, y);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...TEXTO);
    const t = doc.splitTextToSize(pdfTxt(`${quien}${medios.length ? `: ${medios.join(" · ")}` : ""}. Gracias por tu confianza.`), ANCHO) as string[];
    doc.text(t, MX, y + 4.6);
  }

  // ── 6. Pie en cada página ───────────────────────────────────────────────────
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
