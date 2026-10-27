/**
 * Existencias por depósito en PDF (A4 apaisado): una columna por depósito, Total y Valor (con
 * "ver costos"), pie con unidades y valor por depósito. Mismos filtros y búsqueda que la pantalla.
 */
import autoTable from "jspdf-autotable";
import { datosEmpresa } from "@/modules/empresa/server";
import { withTenant } from "@/lib/api/with-tenant";
import { ERR } from "@/lib/api/responses";
import { hoyPY } from "@/lib/fecha/paraguay";
import { COLOR, encabezado, gs, M, medidas, nuevoDocumento, pdfTxt, pieDePagina, respuestaPdf } from "@/lib/pdf/documento";
import {
  buscarExistencias, describirFiltrosExistencias, filtrosExistencias, reporteExistencias, textoGenerado, totalesExistencias,
  type ReporteExistencias,
} from "@/modules/reportes/server/existencias";

export const runtime = "nodejs";

const cant = (n: number) => Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });

export const GET = withTenant(
  async (ctx, req) => {
    const f = filtrosExistencias(new URL(req.url).searchParams);
    let r: ReporteExistencias;
    let sub: string;
    try {
      r = await reporteExistencias(ctx.db, f);
      sub = `Existencias al ${textoGenerado(r.generado)} · ${await describirFiltrosExistencias(ctx.db, r, f)}`;
    } catch {
      return ERR.server();
    }
    const items = buscarExistencias(r.items, f.q);
    const t = totalesExistencias(r, items);
    const costos = r.ver_costos;
    const deps = r.depositos;

    const doc = nuevoDocumento(await datosEmpresa(ctx.db), { apaisado: true });
    const { W } = medidas(doc);
    let y = await encabezado(doc, "EXISTENCIAS POR DEPÓSITO", sub);

    // Cifras en una línea.
    const cifras: [string, string][] = [
      ["Productos", cant(t.productos)],
      ["Unidades", cant(t.unidades)],
      ...(costos ? [["Valor del stock", `Gs. ${gs(t.valor ?? 0)}`] as [string, string]] : []),
      ["Bajo el mínimo", cant(t.bajo)],
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

    if (!items.length) {
      doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...COLOR.gris);
      doc.text("No hay productos con estos filtros.", M + W / 2, y + 10, { align: "center" });
    } else {
      const muchas = deps.length > 7;
      const iTotal = 1 + deps.length;
      const head = [[
        "PRODUCTO",
        ...deps.map((d) => pdfTxt(`${d.sucursal}\n${d.nombre}`.toUpperCase())),
        "TOTAL",
        ...(costos ? ["VALOR"] : []),
      ]];
      const body = items.map((i) => [
        pdfTxt(`${i.nombre}${i.sku ? `\n${i.sku}` : ""}`),
        ...deps.map((d) => (i.c[d.id] != null ? cant(i.c[d.id]) : "0")),
        pdfTxt(`${cant(i.total)} ${i.unidad_medida}`),
        ...(costos ? [`Gs. ${gs(i.valor ?? 0)}`] : []),
      ]);
      const foot = [[
        `TOTAL (${t.productos})`,
        ...deps.map((d) => cant(t.porDep[d.id]?.unidades ?? 0)),
        cant(t.unidades),
        ...(costos ? [`Gs. ${gs(t.valor ?? 0)}`] : []),
      ]];
      if (costos) foot.push(["VALOR", ...deps.map((d) => `Gs. ${gs(t.porDep[d.id]?.valor ?? 0)}`), "", ""]);
      autoTable(doc, {
        startY: y,
        margin: { left: M, right: M, bottom: 16 },
        head, body, foot,
        showFoot: "lastPage",
        theme: "grid",
        styles: { font: "helvetica", fontSize: muchas ? 6.6 : 7.6, cellPadding: { top: 1.4, bottom: 1.4, left: 1.8, right: 1.8 }, lineColor: [220, 220, 220], lineWidth: 0.2, textColor: COLOR.negro, valign: "middle" },
        headStyles: { fillColor: [244, 247, 247], textColor: COLOR.teal, fontStyle: "bold", fontSize: muchas ? 5.8 : 6.6, halign: "right" },
        footStyles: { fillColor: [244, 247, 247], textColor: COLOR.negro, fontStyle: "bold", halign: "right" },
        columnStyles: { 0: { cellWidth: muchas ? 52 : 64, halign: "left" } },
        didParseCell: (h) => {
          if (h.column.index === 0) { h.cell.styles.halign = "left"; return; }
          h.cell.styles.halign = "right";
          if (h.section !== "body") return;
          const it = items[h.row.index];
          const q = h.column.index < iTotal ? Number(it.c[deps[h.column.index - 1].id] ?? 0) : h.column.index === iTotal ? Number(it.total) : null;
          if (q == null) return;
          if (q < 0) h.cell.styles.textColor = COLOR.rojo;
          else if (q === 0) h.cell.styles.textColor = [180, 180, 180];
          else if (Number(it.stock_minimo) > 0 && q < Number(it.stock_minimo)) h.cell.styles.textColor = COLOR.ambar;
          if (h.column.index === iTotal) h.cell.styles.fontStyle = "bold";
        },
      });
    }

    const nota = costos
      ? "Valor = costo de cada compra que queda en stock (capas PEPS y lotes); lo que no tiene compra registrada, al costo promedio. Ámbar: bajo el mínimo."
      : "Ámbar: bajo el mínimo del producto.";
    const yFin = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 5;
    if (yFin < medidas(doc).H - 20) {
      doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...COLOR.gris);
      doc.text(pdfTxt(nota), M, yFin, { maxWidth: W });
    }

    pieDePagina(doc, "Existencias por depósito");
    return respuestaPdf(doc, `existencias-${hoyPY()}.pdf`);
  },
  { permiso: ["ver_reportes_financieros", "exportar"] },
);
