/**
 * Orden de compra en PDF, para mandarle al proveedor. GET /api/ordenes-compra/[id]/pdf
 * Mismo diseño que los demás documentos: membrete, datos del proveedor y del pedido,
 * productos con cantidad y costo, total, observación y firmas.
 */
import autoTable from "jspdf-autotable";
import { withTenant } from "@/lib/api/with-tenant";
import { ERR } from "@/lib/api/responses";
import { COLOR, encabezado, gs, M, nuevoDocumento, pdfTxt, pieDePagina, respuestaPdf, tituloSeccion, W } from "@/lib/pdf/documento";
import { COLS_OC, COLS_OC_ITEM, type OrdenCompra, type OrdenItem } from "@/modules/compras/ordenes";

export const runtime = "nodejs";

const cant = (n: number) => Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });
const dia = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export const GET = withTenant(async (ctx, req) => {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segs[segs.indexOf("ordenes-compra") + 1];
  if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id de la orden");
  const [o, i] = await Promise.all([
    ctx.db.select("ordenes_compra", COLS_OC).eq("id", id).limit(1),
    ctx.db.select("ordenes_compra_items", COLS_OC_ITEM).eq("orden_compra_id", id).order("orden", { ascending: true }),
  ]);
  if (o.error || i.error) return ERR.server();
  const oc = o.data?.[0] as unknown as OrdenCompra | undefined;
  if (!oc) return ERR.notFound("orden de compra");
  const items = (i.data ?? []) as unknown as OrdenItem[];
  const pr = await ctx.db.select("proveedores", "nombre, nombre_comercial, ruc, telefono, email, direccion, ciudad, contacto, contacto_telefono").eq("id", oc.proveedor_id).limit(1);
  const prov = (pr.data?.[0] ?? {}) as Record<string, string | null>;

  const doc = nuevoDocumento();
  const fechaOc = new Date(oc.fecha).toLocaleDateString("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric" });
  let y = await encabezado(doc, `ORDEN DE COMPRA ${oc.numero_oc}`, `Emitida el ${fechaOc}${oc.estado === "cancelada" ? " · CANCELADA" : ""}`);

  // Dos columnas: proveedor | pedido.
  const col = (W - 8) / 2;
  tituloSeccion(doc, "PROVEEDOR", M, y, col);
  tituloSeccion(doc, "PEDIDO", M + col + 8, y, col);
  y += 6;
  const izq: [string, string | null | undefined][] = [
    ["Razón social", prov.nombre],
    ["RUC", prov.ruc],
    ["Contacto", [prov.contacto, prov.contacto_telefono].filter(Boolean).join(" · ") || null],
    ["Teléfono", prov.telefono],
    ["Email", prov.email],
    ["Dirección", [prov.direccion, prov.ciudad].filter(Boolean).join(", ") || null],
  ];
  const der: [string, string | null | undefined][] = [
    ["Número", oc.numero_oc],
    ["Entrega esperada", oc.fecha_entrega ? dia(oc.fecha_entrega) : "A coordinar"],
    ["Condición de pago", oc.tipo_pago === "credito" ? `Crédito${oc.plazo_dias ? ` ${oc.plazo_dias} días` : ""}` : "Contado"],
    ["Moneda", oc.moneda === "USD" ? `Dólares (1 US$ = Gs. ${gs(oc.tipo_cambio)})` : "Guaraníes"],
    ["Pedido por", oc.usuario_nombre],
  ];
  const filas = (lista: [string, string | null | undefined][], x: number, y0: number) => {
    let yy = y0;
    for (const [l, v] of lista) {
      if (!v) continue;
      doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...COLOR.gris);
      doc.text(pdfTxt(l), x, yy);
      doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(...COLOR.negro);
      const t = doc.splitTextToSize(pdfTxt(v), col - 30) as string[];
      doc.text(t, x + 30, yy);
      yy += 4.6 * t.length;
    }
    return yy;
  };
  y = Math.max(filas(izq, M, y), filas(der, M + col + 8, y)) + 4;

  const usd = oc.moneda === "USD";
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, bottom: 16 },
    head: [["#", "PRODUCTO", "CÓDIGO", "CANTIDAD", usd ? "COSTO US$" : "COSTO C/U", "TOTAL Gs."]],
    body: items.map((it, n) => [
      String(n + 1),
      pdfTxt(it.producto_nombre),
      pdfTxt(it.producto_sku ?? ""),
      cant(it.cantidad),
      usd ? Number(it.costo_unitario_original).toLocaleString("es-PY", { minimumFractionDigits: 2 }) : Number(it.costo_unitario) ? gs(it.costo_unitario) : "—",
      Number(it.total) ? gs(it.total) : "—",
    ]),
    foot: [["", "", "", cant(items.reduce((a, x) => a + Number(x.cantidad), 0)), "TOTAL", Number(oc.total) ? `Gs. ${gs(oc.total)}` : "—"]],
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8.2, cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 }, lineColor: [220, 220, 220], lineWidth: 0.2, textColor: COLOR.negro, valign: "middle" },
    headStyles: { fillColor: [244, 247, 247], textColor: COLOR.teal, fontStyle: "bold", fontSize: 7 },
    footStyles: { fillColor: [255, 255, 255], textColor: COLOR.negro, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 8, halign: "center" }, 2: { cellWidth: 28 }, 3: { halign: "right", cellWidth: 22 }, 4: { halign: "right", cellWidth: 26 }, 5: { halign: "right", cellWidth: 30 } },
    didParseCell: (h) => {
      if ((h.section === "head" || h.section === "foot") && h.column.index >= 3) h.cell.styles.halign = "right";
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...COLOR.gris);
  doc.text(pdfTxt("Costos estimados con IVA incluido. Los importes finales son los de su factura."), M, y);
  y += 6;
  if (oc.observacion) {
    tituloSeccion(doc, "OBSERVACIONES", M, y);
    y += 5;
    doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...COLOR.negro);
    const t = doc.splitTextToSize(pdfTxt(oc.observacion), W) as string[];
    doc.text(t, M, y);
    y += t.length * 4.2 + 4;
  }

  // Firmas.
  y = Math.max(y + 18, 240);
  if (y > 270) { doc.addPage(); y = 60; }
  const fw = 70;
  for (const [x, l] of [[M, "Autorizado por"], [M + W - fw, "Recibido por el proveedor"]] as [number, string][]) {
    doc.setDrawColor(...COLOR.grisClaro).setLineWidth(0.3).line(x, y, x + fw, y);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...COLOR.gris);
    doc.text(pdfTxt(l), x + fw / 2, y + 4, { align: "center" });
  }

  pieDePagina(doc, `Orden de compra ${oc.numero_oc}`);
  return respuestaPdf(doc, `orden-compra-${oc.numero_oc}.pdf`);
});
