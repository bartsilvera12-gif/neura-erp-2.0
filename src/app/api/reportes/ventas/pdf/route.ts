/**
 * Reporte "Ventas del período" en PDF gerencial (A4). ADMIN.
 *   GET /api/reportes/ventas/pdf?desde&hasta&cajero&tipo&medio&categoria → descarga
 * Resultado del período + IVA (estado tipo contable), medios de pago, cajeros, días,
 * productos más vendidos y categorías. Mismo diseño que el arqueo de caja.
 */
import autoTable, { type UserOptions } from "jspdf-autotable";
import { withTenant } from "@/lib/api/with-tenant";
import { ERR } from "@/lib/api/responses";
import {
  asegurarEspacio, COLOR, encabezado, gs, M, nuevoDocumento, pdfTxt, pieDePagina, respuestaPdf, tituloSeccion, W,
} from "@/lib/pdf/documento";
import { describirFiltros, filtrosVentas, MEDIO_NOMBRE, resumenVentas } from "@/modules/reportes/server/ventas";

export const runtime = "nodejs";

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
const dia = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;

export const GET = withTenant(
  async (ctx, req) => {
    const f = filtrosVentas(new URL(req.url).searchParams);
    let r;
    const nombres: { cajero?: string | null; categoria?: string | null } = {};
    try {
      r = await resumenVentas(ctx.db, f);
      if (f.cajero) {
        const u = await ctx.db.select("usuarios", "nombre").eq("auth_user_id", f.cajero).limit(1);
        nombres.cajero = (u.data?.[0] as { nombre?: string } | undefined)?.nombre ?? null;
      }
      if (f.categoria && f.categoria !== "__sin__") {
        const c = await ctx.db.select("categorias_productos", "nombre").eq("id", f.categoria).limit(1);
        nombres.categoria = (c.data?.[0] as { nombre?: string } | undefined)?.nombre ?? null;
      }
    } catch {
      return ERR.server();
    }
    const k = r.kpis;
    const ticket = k.cantidad_ventas ? k.ventas_netas / k.cantidad_ventas : 0;

    const doc = nuevoDocumento();
    let y = await encabezado(doc, "REPORTE DE VENTAS", describirFiltros(f, nombres));
    y += 3;

    // ── Dos bloques tipo estado contable ──────────────────────────────────────
    const colW = (W - 8) / 2;
    const xI = M;
    const xD = M + colW + 8;
    const FILA = 5.6;
    const fila = (x: number, yy: number, l: string, v: string, o: { bold?: boolean; color?: [number, number, number]; tam?: number; gris?: boolean } = {}) => {
      doc.setFont("helvetica", o.bold ? "bold" : "normal").setFontSize(o.tam ?? 8.2).setTextColor(...(o.gris ? COLOR.gris : COLOR.negro));
      doc.text(pdfTxt(l), x, yy);
      doc.setTextColor(...(o.color ?? (o.gris ? COLOR.gris : COLOR.negro)));
      doc.text(pdfTxt(v), x + colW, yy, { align: "right" });
    };
    const linea = (x: number, yy: number, g = 0.2, c: [number, number, number] = [210, 214, 220]) => doc.setDrawColor(...c).setLineWidth(g).line(x, yy, x + colW, yy);

    tituloSeccion(doc, "RESULTADO DEL PERÍODO", xI, y, colW);
    tituloSeccion(doc, "IVA INCLUIDO EN LAS VENTAS", xD, y, colW);
    let yi = y + 8;
    fila(xI, yi, `Ventas netas (${k.cantidad_ventas} venta${k.cantidad_ventas === 1 ? "" : "s"})`, `Gs. ${gs(k.ventas_netas)}`); yi += FILA;
    fila(xI, yi, "(-) Costo de lo vendido", `- Gs. ${gs(k.costo)}`, { gris: true }); yi += 2.2;
    linea(xI, yi, 0.5, COLOR.negro); yi += 4.8;
    fila(xI, yi, `GANANCIA BRUTA · ${pct(k.ganancia, k.ventas_netas)}`, `Gs. ${gs(k.ganancia)}`, { bold: true, tam: 9, color: COLOR.teal }); yi += FILA + 1;
    fila(xI, yi, "Ticket promedio", `Gs. ${gs(ticket)}`, { gris: true }); yi += FILA;
    fila(xI, yi, "Unidades vendidas", gs(k.unidades), { gris: true }); yi += FILA;
    fila(xI, yi, `Anuladas (${r.anuladas.cantidad})`, `Gs. ${gs(r.anuladas.monto)}`, { gris: !r.anuladas.cantidad, color: r.anuladas.cantidad ? COLOR.rojo : undefined });

    let yd = y + 8;
    doc.setFont("helvetica", "bold").setFontSize(6.6).setTextColor(...COLOR.grisClaro);
    doc.text("TASA", xD, yd);
    doc.text("VENTAS", xD + colW - 34, yd, { align: "right" });
    doc.text("IVA", xD + colW, yd, { align: "right" });
    yd += 5;
    for (const t of r.iva) {
      doc.setFont("helvetica", "normal").setFontSize(8.2).setTextColor(...COLOR.negro);
      doc.text(t.tipo === "EXENTA" ? "Exentas" : `Gravadas ${t.tipo}`, xD, yd);
      doc.text(`Gs. ${gs(t.total)}`, xD + colW - 34, yd, { align: "right" });
      doc.text(t.tipo === "EXENTA" ? "—" : `Gs. ${gs(t.iva)}`, xD + colW, yd, { align: "right" });
      yd += FILA;
    }
    yd -= 3.4;
    linea(xD, yd, 0.5, COLOR.negro);
    yd += 4.8;
    fila(xD, yd, "TOTAL IVA (débito fiscal)", `Gs. ${gs(k.iva_total)}`, { bold: true, tam: 9, color: COLOR.teal });
    yd += FILA;
    doc.setFont("helvetica", "normal").setFontSize(6.8).setTextColor(...COLOR.grisClaro);
    doc.text("IVA incluido en el precio: 10% = total/11 · 5% = total/21", xD, yd);

    y = Math.max(yi, yd) + 8;
    if (k.productos_sin_costo) {
      doc.setFillColor(255, 251, 235).rect(M, y - 3.5, W, 6.5, "F");
      doc.setFont("helvetica", "bold").setFontSize(7.6).setTextColor(...COLOR.ambar);
      doc.text(pdfTxt(`Atención: ${k.productos_sin_costo} producto(s) se vendieron sin costo cargado; su ganancia figura como el total de la venta.`), M + 2, y + 0.6);
      y += 8;
    }

    // ── Tablas ───────────────────────────────────────────────────────────────
    const tabla = (titulo: string, head: string[], body: (string | number)[][], derecha: number[], extra: Partial<UserOptions> = {}) => {
      y = asegurarEspacio(doc, y, 22);
      tituloSeccion(doc, titulo, M, y);
      autoTable(doc, {
        startY: y + 3,
        margin: { left: M, right: M, bottom: 16 },
        head: [head],
        body: body.map((r) => r.map((c) => pdfTxt(String(c)))),
        theme: "grid",
        styles: { font: "helvetica", fontSize: 7.8, cellPadding: { top: 1.4, bottom: 1.4, left: 2, right: 2 }, lineColor: [220, 220, 220], lineWidth: 0.2, textColor: COLOR.negro },
        headStyles: { fillColor: [244, 247, 247], textColor: COLOR.teal, fontStyle: "bold", fontSize: 7 },
        columnStyles: Object.fromEntries(derecha.map((i) => [i, { halign: "right" as const }])),
        didParseCell: (h) => { if (h.section === "head" && derecha.includes(h.column.index)) h.cell.styles.halign = "right"; },
        ...extra,
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    };

    const totalMedios = r.por_medio.reduce((a, m) => a + Number(m.monto), 0);
    tabla("VENTAS POR MEDIO DE PAGO", ["MEDIO", "VENTAS", "MONTO", "PARTICIPACIÓN"],
      r.por_medio.map((m) => [MEDIO_NOMBRE[m.medio] ?? m.medio, m.ventas, `Gs. ${gs(m.monto)}`, pct(m.monto, totalMedios)]), [1, 2, 3]);

    tabla("VENTAS POR CAJERO", ["CAJERO", "VENTAS", "MONTO", "TICKET PROM.", "GANANCIA", "ANULADAS"],
      r.por_cajero.map((c) => [c.nombre, c.cantidad, `Gs. ${gs(c.ventas)}`, `Gs. ${gs(c.cantidad ? c.ventas / c.cantidad : 0)}`, `Gs. ${gs(c.ganancia)}`, c.anuladas]), [1, 2, 3, 4, 5]);

    tabla("VENTAS POR DÍA", ["DÍA", "VENTAS", "MONTO", "TICKET PROM.", "GANANCIA"],
      r.por_dia.map((d) => [dia(d.dia), d.cantidad, `Gs. ${gs(d.ventas)}`, `Gs. ${gs(d.cantidad ? d.ventas / d.cantidad : 0)}`, `Gs. ${gs(d.ganancia)}`]), [1, 2, 3, 4]);

    tabla(`PRODUCTOS MÁS VENDIDOS${r.productos.length > 30 ? " (TOP 30)" : ""}`, ["PRODUCTO", "SKU", "UNIDADES", "MONTO", "GANANCIA", "MARGEN"],
      r.productos.slice(0, 30).map((p) => [p.nombre + (p.sin_costo ? " *" : ""), p.sku ?? "", gs(p.unidades), `Gs. ${gs(p.monto)}`, `Gs. ${gs(p.ganancia)}`, pct(p.ganancia, p.monto)]), [2, 3, 4, 5]);

    tabla("VENTAS POR CATEGORÍA", ["CATEGORÍA", "UNIDADES", "MONTO", "PARTICIPACIÓN", "GANANCIA", "MARGEN"],
      r.por_categoria.map((c) => [c.nombre, gs(c.unidades), `Gs. ${gs(c.monto)}`, pct(c.monto, k.ventas_netas), `Gs. ${gs(c.ganancia)}`, pct(c.ganancia, c.monto)]), [1, 2, 3, 4, 5]);

    if (r.productos.some((p) => p.sin_costo)) {
      y = asegurarEspacio(doc, y, 6);
      doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...COLOR.gris);
      doc.text("* Vendido al menos una vez sin costo cargado: su ganancia está sobreestimada.", M, y - 4);
    }

    pieDePagina(doc, "Reporte de ventas · Documento no fiscal");
    return respuestaPdf(doc, `ventas-${f.desde}_${f.hasta}.pdf`);
  },
  { roles: ["ADMIN"] },
);
