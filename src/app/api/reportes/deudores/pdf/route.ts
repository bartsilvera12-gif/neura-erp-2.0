/**
 * Deudores en PDF: lista para salir a cobrar (con teléfono y columna "Gestión" en blanco
 * para anotar a mano). GET /api/reportes/deudores/pdf?vencidos=1
 */
import autoTable from "jspdf-autotable";
import { withTenant } from "@/lib/api/with-tenant";
import { ERR } from "@/lib/api/responses";
import { hoyPY } from "@/lib/fecha/paraguay";
import { COLOR, encabezado, gs, M, nuevoDocumento, pdfTxt, pieDePagina, respuestaPdf, W } from "@/lib/pdf/documento";
import { reporteDeudores } from "@/modules/reportes/server/deudores";

export const runtime = "nodejs";

export const GET = withTenant(
  async (ctx, req) => {
    const solo = new URL(req.url).searchParams.get("vencidos") === "1";
    let r;
    try {
      r = await reporteDeudores(ctx.db, solo);
    } catch {
      return ERR.server();
    }
    const hoy = hoyPY();
    const doc = nuevoDocumento();
    let y = await encabezado(doc, "DEUDORES · CUENTAS A COBRAR", `Al ${hoy.slice(8, 10)}/${hoy.slice(5, 7)}/${hoy.slice(0, 4)}${solo ? " · solo con deuda vencida" : ""}`);

    const t = r.totales;
    const cifras: [string, string, boolean][] = [
      ["Clientes", String(t.clientes), false],
      ["Deuda total", `Gs. ${gs(t.deuda)}`, false],
      ["Vencido", `Gs. ${gs(t.vencido)}`, t.vencido > 0],
      ["Más de 90 días", `Gs. ${gs(t.d90)}`, t.d90 > 0],
    ];
    const cw = W / cifras.length;
    cifras.forEach(([l, v, rojo], i) => {
      const x = M + i * cw + cw / 2;
      doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...COLOR.teal);
      doc.text(pdfTxt(l.toUpperCase()), x, y + 3, { align: "center" });
      doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(...(rojo ? COLOR.rojo : COLOR.negro));
      doc.text(pdfTxt(v), x, y + 9, { align: "center" });
    });
    y += 15;

    if (!r.rows.length) {
      doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...COLOR.gris);
      doc.text(solo ? "Nadie tiene deuda vencida." : "Nadie te debe nada.", M + W / 2, y + 10, { align: "center" });
    } else {
      autoTable(doc, {
        startY: y,
        margin: { left: M, right: M, bottom: 16 },
        head: [["CLIENTE", "TELÉFONO", "DEUDA", "VENCIDO", "ATRASO", "ÚLTIMO PAGO", "GESTIÓN"]],
        body: r.rows.map((f) => [
          pdfTxt(`${f.razon_social || f.nombre}${f.documento ? `\n${f.documento}` : ""}`),
          pdfTxt(f.telefono ?? "—"),
          gs(f.deuda),
          Number(f.vencido) ? gs(f.vencido) : "—",
          Number(f.max_atraso) ? `${f.max_atraso} días` : "al día",
          f.ultimo_cobro ? `${new Date(f.ultimo_cobro).toLocaleDateString("es-PY", { timeZone: "America/Asuncion" })}\nGs. ${gs(Number(f.ultimo_cobro_monto ?? 0))}` : "nunca",
          "",
        ]),
        theme: "grid",
        styles: { font: "helvetica", fontSize: 7.8, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 }, lineColor: [220, 220, 220], lineWidth: 0.2, textColor: COLOR.negro, valign: "middle" },
        headStyles: { fillColor: [244, 247, 247], textColor: COLOR.teal, fontStyle: "bold", fontSize: 6.8 },
        columnStyles: { 0: { cellWidth: 50 }, 2: { halign: "right", fontStyle: "bold" }, 3: { halign: "right" }, 4: { halign: "right" }, 6: { cellWidth: 30 } },
        didParseCell: (h) => {
          if (h.section === "head" && h.column.index >= 2 && h.column.index <= 4) h.cell.styles.halign = "right";
          if (h.section === "body" && (h.column.index === 3 || h.column.index === 4) && h.cell.raw !== "—" && h.cell.raw !== "al día") h.cell.styles.textColor = COLOR.rojo;
        },
      });
    }
    pieDePagina(doc, "Deudores · Cuentas a cobrar");
    return respuestaPdf(doc, `deudores-${hoy}.pdf`);
  },
  { roles: ["ADMIN"] },
);
