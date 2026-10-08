/**
 * Stock mínimo en PDF: sirve de lista de reposición/compra (con columna "Pedido" en
 * blanco para anotar a mano). Mismo diseño que los demás reportes. ADMIN.
 */
import autoTable from "jspdf-autotable";
import { withTenant } from "@/lib/api/with-tenant";
import { ERR } from "@/lib/api/responses";
import { hoyPY } from "@/lib/fecha/paraguay";
import { COLOR, encabezado, gs, M, nuevoDocumento, pdfTxt, pieDePagina, respuestaPdf, W } from "@/lib/pdf/documento";
import { categoriaDeUrl, reporteStockMinimo } from "@/modules/reportes/server/stock";

export const runtime = "nodejs";

const cant = (n: number) => Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    const categoria = categoriaDeUrl(sp);
    const soloSinStock = sp.get("sin_stock") === "1";
    let r;
    let nombreCat: string | null = null;
    try {
      r = await reporteStockMinimo(ctx.db, categoria, soloSinStock);
      if (categoria && categoria !== "__sin__") {
        // "Bebidas › Gaseosas" si es subcategoría
        const c = await ctx.db.rpc<string>("categoria_ruta", { p_id: categoria });
        nombreCat = c.data ?? null;
      }
    } catch {
      return ERR.server();
    }
    const hoy = hoyPY();
    const sub = [
      `Al ${hoy.slice(8, 10)}/${hoy.slice(5, 7)}/${hoy.slice(0, 4)}`,
      categoria ? `Categoría: ${categoria === "__sin__" ? "Sin categoría" : (nombreCat ?? "—")}` : null,
      soloSinStock ? "Solo sin stock" : null,
    ].filter(Boolean).join(" · ");

    const doc = nuevoDocumento();
    let y = await encabezado(doc, "REPOSICIÓN · STOCK MÍNIMO", sub);

    // Resumen en una línea de cifras.
    const t = r.totales;
    const cifras: [string, string][] = [
      ["Productos bajo el mínimo", cant(t.productos)],
      ["Sin stock", cant(t.sin_stock)],
      ["Costo estimado de reposición", `Gs. ${gs(t.costo_reposicion)}`],
    ];
    const cw = W / cifras.length;
    cifras.forEach(([l, v], i) => {
      const x = M + i * cw + cw / 2;
      doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...COLOR.teal);
      doc.text(pdfTxt(l.toUpperCase()), x, y + 3, { align: "center" });
      doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(...COLOR.negro);
      doc.text(pdfTxt(v), x, y + 9, { align: "center" });
    });
    y += 15;

    if (!r.items.length) {
      doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...COLOR.gris);
      doc.text("No hay productos por debajo del stock mínimo.", M + W / 2, y + 10, { align: "center" });
    } else {
      autoTable(doc, {
        startY: y,
        margin: { left: M, right: M, bottom: 16 },
        head: [["PRODUCTO", "CATEGORÍA", "STOCK", "MÍNIMO", "FALTANTE", "VEND. 30D", "COSTO REPOS.", "PEDIDO"]],
        body: r.items.map((i) => [
          pdfTxt(`${i.nombre}${i.sku ? `\n${i.sku}` : ""}`),
          pdfTxt(i.categoria ?? "—"),
          cant(i.stock_actual),
          cant(i.stock_minimo),
          pdfTxt(`${cant(i.faltante)} ${i.unidad_medida}`),
          cant(i.vendido_30d),
          Number(i.costo) ? `Gs. ${gs(i.costo_reposicion)}` : "sin costo",
          "",
        ]),
        theme: "grid",
        styles: { font: "helvetica", fontSize: 7.8, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 }, lineColor: [220, 220, 220], lineWidth: 0.2, textColor: COLOR.negro, valign: "middle" },
        headStyles: { fillColor: [244, 247, 247], textColor: COLOR.teal, fontStyle: "bold", fontSize: 6.8 },
        columnStyles: {
          0: { cellWidth: 52 },
          2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right", fontStyle: "bold" },
          5: { halign: "right" }, 6: { halign: "right" }, 7: { cellWidth: 18 },
        },
        didParseCell: (h) => {
          if (h.section === "head" && h.column.index >= 2 && h.column.index <= 6) h.cell.styles.halign = "right";
          if (h.section === "body" && h.column.index === 2) h.cell.styles.textColor = COLOR.rojo;
          if (h.section === "body" && h.column.index === 4) h.cell.styles.textColor = COLOR.ambar;
        },
      });
    }

    pieDePagina(doc, "Stock mínimo · Lista de reposición");
    return respuestaPdf(doc, `stock-minimo-${hoy}.pdf`);
  },
  { roles: ["ADMIN"] },
);
