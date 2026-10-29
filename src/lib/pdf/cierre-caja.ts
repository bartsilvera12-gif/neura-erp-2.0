/**
 * Cierre de caja (arqueo de un turno) en PDF A4, listo para imprimir. Sale de resumen_turno
 * (receta 51). Orden de la hoja:
 *   1. membrete con el logo de la empresa, título y datos del turno;
 *   2. resumen en cuatro recuadros (vendido · efectivo esperado · contado · diferencia);
 *   3. arqueo por forma de pago (esperado / declarado / diferencia) con total;
 *   4. ventas del turno y conciliación del efectivo, lado a lado;
 *   5. crédito otorgado, conteo de billetes y observaciones (si hay);
 *   6. firmas (cajero y supervisor) — el resumen firmado queda junto;
 *   7. detalle de movimientos como anexo, con el neto al pie.
 * Con el turno abierto sale como "Arqueo parcial" (sin declarado ni diferencia). Solo servidor.
 */
import type { DatosEmpresa } from "@/modules/empresa/tipos";
import autoTable from "jspdf-autotable";
import type { jsPDF } from "jspdf";
import { TZ_PY } from "@/lib/fecha/paraguay";
import { asegurarEspacio, COLOR, encabezado, fechaHoraPY, gs, M, nuevoDocumento, pdfTxt, pieDePagina, tituloSeccion, W, type RGB } from "@/lib/pdf/documento";
import type { MovimientoTurno, ResumenTurno } from "@/modules/caja/turno";

const hora = (iso: string, conDia: boolean) =>
  new Intl.DateTimeFormat("es-PY", { timeZone: TZ_PY, ...(conDia ? { day: "2-digit", month: "2-digit" } : {}), hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(iso))
    .replace(",", "");
const dia = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ_PY });
const fechaCorta = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
const conSigno = (v: number) => (v === 0 ? "0" : `${v > 0 ? "+" : "-"}${gs(Math.abs(v))}`);
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const finY = (doc: jsPDF) => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

const ORIGEN: Record<string, string> = {
  venta: "Venta",
  devolucion: "Devolución",
  cobro: "Cobro",
  compra: "Compra",
  gasto: "Gasto",
  pago_proveedor: "Pago a proveedor",
};
const CADA: Record<string, string> = { mes: "mensuales", quincena: "quincenales", semana: "semanales" };

// Estilo común de las tablas (mismo que los demás reportes).
const TABLA = {
  theme: "grid" as const,
  styles: { font: "helvetica", fontSize: 7.8, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 }, lineColor: [220, 220, 220] as RGB, lineWidth: 0.2, textColor: COLOR.negro, valign: "middle" as const },
  headStyles: { fillColor: [244, 247, 247] as RGB, textColor: COLOR.teal, fontStyle: "bold" as const, fontSize: 7 },
  footStyles: { fillColor: [244, 247, 247] as RGB, textColor: COLOR.negro, fontStyle: "bold" as const, fontSize: 7.8 },
  margin: { left: M, right: M, bottom: 18 },
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
  const col = (W - 8) / 2;
  const e = r.efectivo;

  // ── 1. Datos del turno (recuadro, dos columnas) ────────────────────────────
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
  const yDatos = y;
  const yFinDatos = Math.max(
    filas([
      ["Apertura", `${fechaHoraPY(c.fecha_apertura)} · ${c.abierta_por_nombre ?? "—"}`],
      ["Cierre", c.fecha_cierre ? `${fechaHoraPY(c.fecha_cierre)} · ${c.cerrada_por_nombre ?? "—"}` : "En curso"],
      ["Depósito de salida", c.deposito_nombre],
    ], M + 3, yDatos + 5),
    filas([
      ["Monto inicial", `Gs. ${gs(c.monto_apertura)}`],
      ["Ventas", `${r.ventas.cantidad} · Gs. ${gs(r.ventas.total)}`],
      ["Anuladas", r.ventas.anuladas.cantidad ? `${r.ventas.anuladas.cantidad} · Gs. ${gs(r.ventas.anuladas.total)}` : "Ninguna"],
    ], M + col + 8, yDatos + 5),
  );
  doc.setDrawColor(...COLOR.borde).setLineWidth(0.25).roundedRect(M, yDatos, W, yFinDatos - yDatos - 0.5, 1.2, 1.2, "S");
  y = yFinDatos + 4;

  // ── 2. Resumen en cuatro recuadros ─────────────────────────────────────────
  const dif = e.diferencia;
  const est =
    dif == null ? { txt: "Turno abierto", col: COLOR.gris, fondo: [243, 244, 246] as RGB }
    : dif === 0 ? { txt: "Cuadra", col: COLOR.verde, fondo: [236, 253, 245] as RGB }
    : dif < 0 ? { txt: "Faltante", col: COLOR.rojo, fondo: [254, 242, 242] as RGB }
    : { txt: "Sobrante", col: COLOR.ambar, fondo: [255, 251, 235] as RGB };
  const otros = c.diferencia_otros ?? 0;
  const kpis: { l: string; v: string; sub: string; col?: RGB; fondo?: RGB }[] = [
    { l: "TOTAL VENDIDO", v: `Gs. ${gs(r.ventas.total)}`, sub: `${r.ventas.cantidad} venta${r.ventas.cantidad === 1 ? "" : "s"}` },
    { l: "EFECTIVO ESPERADO", v: `Gs. ${gs(e.esperado)}`, sub: "Lo que debería haber en el cajón" },
    { l: "EFECTIVO CONTADO", v: e.contado == null ? "—" : `Gs. ${gs(e.contado)}`, sub: e.contado == null ? "Se cuenta al cerrar" : "Declarado por el cajero" },
    {
      l: "DIFERENCIA",
      v: dif == null ? "—" : `${dif > 0 ? "+ " : dif < 0 ? "- " : ""}Gs. ${gs(Math.abs(dif))}`,
      sub: `Efectivo · ${est.txt.toLowerCase()}${cerrada && otros ? ` · otras formas ${conSigno(otros)}` : ""}`,
      col: est.col,
      fondo: est.fondo,
    },
  ];
  const anchoK = (W - 3 * 3) / 4;
  kpis.forEach((k, i) => {
    const x = M + i * (anchoK + 3);
    doc.setDrawColor(...COLOR.borde).setLineWidth(0.25).setFillColor(...(k.fondo ?? ([255, 255, 255] as RGB))).roundedRect(x, y, anchoK, 15.5, 1.2, 1.2, "FD");
    doc.setFont("helvetica", "bold").setFontSize(6.6).setTextColor(...COLOR.gris).text(k.l, x + 3, y + 4.5, { charSpace: 0.2 });
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...(k.col ?? COLOR.negro)).text(pdfTxt(k.v), x + 3, y + 9.8);
    doc.setFont("helvetica", "normal").setFontSize(6.6).setTextColor(...COLOR.gris).text(pdfTxt(k.sub), x + 3, y + 13.3, { maxWidth: anchoK - 5 });
  });
  y += 15.5 + 6.5;

  // ── 3. Arqueo por forma de pago ────────────────────────────────────────────
  tituloSeccion(doc, "ARQUEO POR FORMA DE PAGO", M, y);
  y += 2.5;
  const metodos = r.metodos;
  const sum = (f: (m: (typeof metodos)[number]) => number) => metodos.reduce((s, m) => s + f(m), 0);
  const entradas = (m: (typeof metodos)[number]) => m.ingresos + (m.metodo === "efectivo" ? c.monto_apertura : 0);
  autoTable(doc, {
    ...TABLA,
    startY: y,
    head: [["FORMA DE PAGO", "ENTRADAS", "SALIDAS", "ESPERADO", ...(cerrada ? ["DECLARADO", "DIFERENCIA"] : [])]],
    body: metodos.map((m) => [
      pdfTxt(m.metodo === "efectivo" ? `${m.label} (incluye monto inicial)` : m.label),
      gs(entradas(m)),
      m.egresos ? `-${gs(m.egresos)}` : "0",
      gs(m.esperado),
      ...(cerrada ? [gs(m.declarado ?? m.esperado), conSigno(m.diferencia ?? 0)] : []),
    ]),
    foot: metodos.length > 1
      ? [["TOTAL", gs(sum(entradas)), sum((m) => m.egresos) ? `-${gs(sum((m) => m.egresos))}` : "0", gs(sum((m) => m.esperado)),
          ...(cerrada ? [gs(sum((m) => m.declarado ?? m.esperado)), conSigno(sum((m) => m.diferencia ?? 0))] : [])]]
      : undefined,
    styles: { ...TABLA.styles, fontSize: 8, cellPadding: { top: 1.5, bottom: 1.5, left: 2.2, right: 2.2 } },
    columnStyles: { 0: { cellWidth: cerrada ? 52 : 70 }, 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right", fontStyle: "bold" }, 4: { halign: "right" }, 5: { halign: "right", fontStyle: "bold" } },
    didParseCell: (h) => {
      if (h.section !== "body" && h.column.index > 0) h.cell.styles.halign = "right";
      if (h.column.index === 5 && h.section !== "head") {
        const d = h.section === "body" ? metodos[h.row.index].diferencia ?? 0 : sum((m) => m.diferencia ?? 0);
        h.cell.styles.textColor = d === 0 ? COLOR.verde : d < 0 ? COLOR.rojo : COLOR.ambar;
      }
    },
  });
  y = finY(doc) + 6;

  // ── 4. Ventas (izq.) y conciliación del efectivo (der.) ────────────────────
  y = asegurarEspacio(doc, y, 70);
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
  tituloSeccion(doc, "CONCILIACIÓN DEL EFECTIVO", xDer, y, col);
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
  if (r.ventas.anuladas.cantidad) {
    fila(xIzq, yi, `Anuladas (${r.ventas.anuladas.cantidad}) · no suman`, `Gs. ${gs(r.ventas.anuladas.total)}`, { gris: true, tam: 7.6 });
    yi += FILA;
  }
  if (r.cobros.cantidad) {
    yi += 1;
    fila(xIzq, yi, `Cobros de cuentas (${r.cobros.cantidad})`, `Gs. ${gs(r.cobros.total)}`, { bold: true });
    yi += FILA;
    for (const m of r.cobros.por_metodo) {
      fila(xIzq + 3, yi, m.label, `Gs. ${gs(m.total)}`, { gris: true, tam: 7.6 });
      yi += 4.4;
    }
  }

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
  doc.setFillColor(...est.fondo).rect(xDer, yd, col, 7, "F");
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(...est.col);
  doc.text(`DIFERENCIA · ${est.txt.toUpperCase()}`, xDer + 2, yd + 4.7);
  doc.text(dif == null ? "—" : `${dif > 0 ? "+ " : dif < 0 ? "- " : ""}Gs. ${gs(Math.abs(dif))}`, xDer + col - 2, yd + 4.7, { align: "right" });
  yd += 11;
  y = Math.max(yi, yd) + 3;

  // ── 5a. Crédito otorgado ───────────────────────────────────────────────────
  if (r.credito.ventas.length) {
    y = asegurarEspacio(doc, y + 2, 24);
    tituloSeccion(doc, `CRÉDITO OTORGADO · ${r.credito.cantidad} venta${r.credito.cantidad === 1 ? "" : "s"} · Gs. ${gs(r.credito.total)}`, M, y);
    y += 2.5;
    const conCuotas = r.credito.ventas.some((v) => Number(v.cuotas ?? 1) > 1);
    autoTable(doc, {
      ...TABLA,
      startY: y,
      head: [["VENTA", "CLIENTE", ...(conCuotas ? ["CUOTAS"] : []), conCuotas ? "PRÓX. VENCE" : "VENCE", "TOTAL", "SALDO", "ESTADO"]],
      body: r.credito.ventas.map((v) => [
        v.numero_control,
        pdfTxt(`${v.cliente_nombre ?? "—"}${v.cliente_ruc ? ` (${v.cliente_ruc})` : ""}`),
        ...(conCuotas ? [Number(v.cuotas ?? 1) > 1 ? pdfTxt(`${v.cuotas} ${CADA[v.cuotas_cada ?? "mes"] ?? ""}`) : "1"] : []),
        fechaCorta(v.vencimiento),
        gs(v.total),
        v.estado === "anulada" ? "—" : gs(v.saldo ?? 0),
        v.estado === "anulada" ? "Anulada" : (v.estado_cuenta ?? "pendiente").replace(/^./, (x) => x.toUpperCase()),
      ]),
      columnStyles: conCuotas
        ? { 0: { font: "courier", cellWidth: 24 }, 2: { cellWidth: 22 }, 3: { cellWidth: 20 }, 4: { halign: "right", cellWidth: 22 }, 5: { halign: "right", cellWidth: 22 }, 6: { cellWidth: 19 } }
        : { 0: { font: "courier", cellWidth: 26 }, 2: { cellWidth: 20 }, 3: { halign: "right", cellWidth: 24 }, 4: { halign: "right", cellWidth: 24 }, 5: { cellWidth: 20 } },
      didParseCell: (h) => {
        const montos = conCuotas ? [4, 5] : [3, 4];
        if (h.section === "head" && montos.includes(h.column.index)) h.cell.styles.halign = "right";
        if (h.section === "body" && r.credito.ventas[h.row.index].estado === "anulada") h.cell.styles.textColor = COLOR.rojo;
      },
    });
    y = finY(doc) + 6;
  }

  // ── 5b. Conteo de billetes ─────────────────────────────────────────────────
  const billetes = Object.entries(c.billetes ?? {}).filter(([, n]) => Number(n) > 0).sort((a, b) => Number(b[0]) - Number(a[0]));
  if (billetes.length) {
    y = asegurarEspacio(doc, y + 2, 14 + Math.ceil(billetes.length / 2) * 6);
    tituloSeccion(doc, "CONTEO DEL EFECTIVO", M, y);
    y += 2.5;
    // Dos columnas de billetes por fila para que no ocupe media hoja.
    const mitad = Math.ceil(billetes.length / 2);
    const celda = (b?: [string, number]) => (b ? [`Gs. ${gs(Number(b[0]))}`, String(b[1]), gs(Number(b[0]) * Number(b[1]))] : ["", "", ""]);
    const totalBilletes = billetes.reduce((s, [d, n]) => s + Number(d) * Number(n), 0);
    autoTable(doc, {
      ...TABLA,
      startY: y,
      head: [["BILLETE / MONEDA", "CANT.", "SUBTOTAL", "BILLETE / MONEDA", "CANT.", "SUBTOTAL"]],
      body: Array.from({ length: mitad }, (_, i) => [...celda(billetes[i] as [string, number]), ...celda(billetes[i + mitad] as [string, number] | undefined)]),
      foot: [["", "", "", "TOTAL CONTADO", "", gs(totalBilletes)]],
      styles: { ...TABLA.styles, fontSize: 7.5, cellPadding: { top: 1.1, bottom: 1.1, left: 2, right: 2 } },
      footStyles: { ...TABLA.footStyles, fontSize: 7.5 },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
      didParseCell: (h) => {
        if (h.section !== "body" && [1, 2, 4, 5].includes(h.column.index)) h.cell.styles.halign = "right";
      },
    });
    y = finY(doc) + 6;
  }

  // ── 5c. Motivo de la diferencia / observaciones ────────────────────────────
  const notas: [string, string][] = [];
  if (c.motivo_diferencia) notas.push(["Motivo de la diferencia: ", c.motivo_diferencia]);
  if (c.observacion_cierre) notas.push(["Observación de cierre: ", c.observacion_cierre]);
  if (c.observacion_apertura) notas.push(["Observación de apertura: ", c.observacion_apertura]);
  if (notas.length) {
    // Un solo recuadro con una nota por renglón.
    doc.setFontSize(8);
    const lineas = notas.map(([et, txt]) => {
      const ancho = doc.setFont("helvetica", "bold").getTextWidth(et);
      return { et, ancho, resto: doc.setFont("helvetica", "normal").splitTextToSize(pdfTxt(txt), W - 6 - ancho) as string[] };
    });
    const alto = lineas.reduce((s, l) => s + l.resto.length * 3.6, 0) + (lineas.length - 1) * 1.4 + 4;
    y = asegurarEspacio(doc, y, alto);
    doc.setDrawColor(...COLOR.borde).setFillColor(250, 250, 250).setLineWidth(0.25).roundedRect(M, y, W, alto, 1.2, 1.2, "FD");
    let yn = y + 4.6;
    for (const l of lineas) {
      doc.setFont("helvetica", "bold").setTextColor(...COLOR.negro).text(l.et, M + 3, yn);
      doc.setFont("helvetica", "normal").text(l.resto, M + 3 + l.ancho, yn, { lineHeightFactor: 1.25 });
      yn += l.resto.length * 3.6 + 1.4;
    }
    y += alto + 3;
  }

  // ── 6. Firmas (junto al resumen) ───────────────────────────────────────────
  y = firmas(doc, y + 1, c.cerrada_por_nombre ?? c.abierta_por_nombre);

  // ── 7. Detalle de movimientos (anexo) ──────────────────────────────────────
  const movs = r.movimientos;
  // Si queda poco lugar, el anexo arranca en una hoja nueva (no se corta el título solo).
  y = asegurarEspacio(doc, y + 8, 40);
  tituloSeccion(doc, `DETALLE DE MOVIMIENTOS · ${movs.length}`, M, y);
  y += 2.5;
  const clientes = new Map(r.ventas_lista.map((v) => [v.numero_control, v.cliente_nombre]));
  const usuarios = new Set(movs.map((m) => m.usuario_nombre).filter(Boolean));
  const tipoMov = (m: MovimientoTurno) =>
    m.origen !== "manual" ? ORIGEN[m.origen] : m.tipo === "retiro" ? "Retiro" : m.tipo === "ingreso" ? "Ingreso" : m.tipo === "egreso" ? "Egreso" : "Ajuste";
  // El concepto viene "Venta VTA-000123 · Efectivo": el tipo, el documento y la forma ya tienen su columna.
  const detalle = (m: MovimientoTurno) => {
    let t = m.concepto ?? "";
    if (m.documento) t = t.replace(new RegExp(`^[^·]*?${escRe(m.documento)}\\s*(·\\s*)?`), "");
    if (m.metodo_label) t = t.replace(new RegExp(`\\s*·?\\s*${escRe(m.metodo_label)}$`), "");
    const partes = [
      t.trim(),
      m.origen === "venta" && m.documento ? clientes.get(m.documento) ?? "" : "",
      m.observacion ?? "",
      m.referencia ? `ref. ${m.referencia}` : "",
      usuarios.size > 1 ? m.usuario_nombre ?? "" : "",
      m.anulado ? "ANULADO" : "",
    ].filter(Boolean);
    return pdfTxt(partes.join(" · "));
  };
  const neto = movs.filter((m) => !m.anulado).reduce((s, m) => s + m.signo * m.monto, 0);
  autoTable(doc, {
    ...TABLA,
    startY: y,
    head: [["HORA", "TIPO", "DOCUMENTO", "DETALLE", "FORMA", "MONTO"]],
    body: movs.length
      ? movs.map((m) => [
          pdfTxt(hora(m.created_at, conDia)),
          tipoMov(m),
          m.documento ?? m.numero ?? "—",
          detalle(m),
          pdfTxt(m.metodo_label),
          `${m.signo < 0 ? "-" : "+"}${gs(m.monto)}`,
        ])
      : [["", "", "", "Sin movimientos", "", ""]],
    foot: movs.length ? [["", "", "", "NETO DEL TURNO (sin anulados)", "", conSigno(neto)]] : undefined,
    columnStyles: { 0: { font: "courier", cellWidth: conDia ? 24 : 15 }, 1: { cellWidth: 22 }, 2: { font: "courier", cellWidth: 26 }, 4: { cellWidth: 27 }, 5: { halign: "right", cellWidth: 22 } },
    didParseCell: (h) => {
      if (h.section !== "body" && h.column.index === 5) h.cell.styles.halign = "right";
      if (h.section !== "body" || !movs.length) return;
      const m = movs[h.row.index];
      if (m.anulado) h.cell.styles.textColor = COLOR.gris;
      else if (h.column.index === 5) h.cell.styles.textColor = m.signo < 0 ? COLOR.rojo : COLOR.verde;
    },
  });

  pieDePagina(doc, cerrada ? "Cierre de caja · Documento no fiscal" : "Arqueo parcial · Documento no fiscal");
  return doc;
}

/** Dos líneas de firma; devuelve la Y debajo. */
function firmas(doc: jsPDF, y0: number, cajero: string | null): number {
  const y = asegurarEspacio(doc, y0, 17) + 11;
  const ancho = 70;
  const lugares: [number, string][] = [[M + 5, `Cajero${cajero ? ` · ${cajero}` : ""}`], [M + W - ancho - 5, "Supervisor / Administración"]];
  for (const [x, txt] of lugares) {
    doc.setDrawColor(...COLOR.negro).setLineWidth(0.3).line(x, y, x + ancho, y);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...COLOR.gris);
    doc.text(pdfTxt(txt), x + ancho / 2, y + 4, { align: "center" });
  }
  return y + 6;
}
