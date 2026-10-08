/** Productos vendidos en PDF (resumen por producto), mismo diseño que los demás reportes. ADMIN. */
import autoTable from "jspdf-autotable";
import { withTenant } from "@/lib/api/with-tenant";
import { ERR } from "@/lib/api/responses";
import { COLOR, encabezado, gs, M, nuevoDocumento, pdfTxt, pieDePagina, respuestaPdf, W } from "@/lib/pdf/documento";
import { filtrosProductos, resumenProductos } from "@/modules/reportes/server/productos";

export const runtime = "nodejs";

const cant = (n: number) => Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
const d = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;

export const GET = withTenant(
  async (ctx, req) => {
    const f = filtrosProductos(new URL(req.url).searchParams);
    let r;
    let nombreCat: string | null = null;
    let nombreProd: string | null = null;
    try {
      r = await resumenProductos(ctx.db, f);
      if (f.categoria && f.categoria !== "__sin__") {
        const c = await ctx.db.select("categorias_productos", "nombre").eq("id", f.categoria).limit(1);
        nombreCat = (c.data?.[0] as { nombre?: string } | undefined)?.nombre ?? null;
      }
      if (f.producto) {
        const p = await ctx.db.select("productos", "nombre").eq("id", f.producto).limit(1);
        nombreProd = (p.data?.[0] as { nombre?: string } | undefined)?.nombre ?? null;
      }
    } catch {
      return ERR.server();
    }
    const t = r.totales;
    const sub = [
      `${d(f.desde)} al ${d(f.hasta)}`,
      f.categoria ? `Categoría: ${f.categoria === "__sin__" ? "Sin categoría" : (nombreCat ?? "—")}` : null,
      f.producto ? `Producto: ${nombreProd ?? "—"}` : null,
      f.sinVentas ? "Incluye productos sin ventas" : null,
    ].filter(Boolean).join(" · ");

    const doc = nuevoDocumento();
    let y = await encabezado(doc, "PRODUCTOS VENDIDOS", sub);

    const cifras: [string, string][] = [
      ["Productos vendidos", cant(t.productos_vendidos)],
      ["Unidades", cant(t.unidades)],
      ["Total vendido", `Gs. ${gs(t.total)}`],
      ["Ganancia", `Gs. ${gs(t.ganancia)} · ${pct(t.ganancia, t.total)}`],
    ];
    if (f.sinVentas) cifras.push(["Sin ventas (stock inmovilizado)", `${cant(t.productos_sin_ventas)} · Gs. ${gs(t.valor_stock_sin_ventas)}`]);
    const cw = W / cifras.length;
    cifras.forEach(([l, v], i) => {
      const x = M + i * cw + cw / 2;
      doc.setFont("helvetica", "normal").setFontSize(6.6).setTextColor(...COLOR.teal);
      doc.text(pdfTxt(l.toUpperCase()), x, y + 3, { align: "center", maxWidth: cw - 2 });
      doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...COLOR.negro);
      doc.text(pdfTxt(v), x, y + 9, { align: "center", maxWidth: cw - 2 });
    });
    y += 15;

    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M, bottom: 16 },
      head: [["PRODUCTO", "CATEGORÍA", "UNID.", "VENTAS", "TOTAL", "%", "PRECIO PROM.", "GANANCIA", "MARGEN", "STOCK"]],
      body: r.items.map((i) => [
        pdfTxt(`${i.nombre}${i.sin_costo ? " *" : ""}${i.sku ? `\n${i.sku}` : ""}`),
        pdfTxt(i.categoria ?? "—"),
        cant(i.unidades),
        cant(i.ventas),
        `Gs. ${gs(i.total)}`,
        pct(Number(i.total), Number(t.total)),
        Number(i.unidades) ? `Gs. ${gs(i.precio_promedio)}` : "—",
        Number(i.unidades) ? `Gs. ${gs(i.ganancia)}` : "—",
        Number(i.unidades) ? pct(Number(i.ganancia), Number(i.total)) : "—",
        i.controla_stock ? cant(Number(i.stock_actual)) : "—",
      ]),
      theme: "grid",
      styles: { font: "helvetica", fontSize: 7.4, cellPadding: { top: 1.4, bottom: 1.4, left: 1.8, right: 1.8 }, lineColor: [220, 220, 220], lineWidth: 0.2, textColor: COLOR.negro, valign: "middle" },
      headStyles: { fillColor: [244, 247, 247], textColor: COLOR.teal, fontStyle: "bold", fontSize: 6.6 },
      columnStyles: { 0: { cellWidth: 44 }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" }, 9: { halign: "right" } },
      didParseCell: (h) => {
        if (h.section === "head" && h.column.index >= 2) h.cell.styles.halign = "right";
        if (h.section === "body" && !Number(r.items[h.row.index]?.unidades)) h.cell.styles.textColor = COLOR.grisClaro;
      },
    });

    if (r.items.some((i) => i.sin_costo)) {
      const yy = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
      doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...COLOR.gris);
      doc.text("* Vendido al menos una vez sin costo cargado: su ganancia está sobreestimada.", M, yy);
    }

    pieDePagina(doc, "Productos vendidos · Documento no fiscal");
    return respuestaPdf(doc, `productos-vendidos-${f.desde}_${f.hasta}.pdf`);
  },
  { roles: ["ADMIN"] },
);
