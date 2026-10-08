/**
 * Recibo de un cobro en PDF. GET /api/cobros/[id]/pdf
 * "Recibimos de … la suma de Gs. … (en letras)", medios de pago, a qué ventas se aplicó,
 * deuda que le queda al cliente y firma. Si está anulado, lo dice grande.
 */
import autoTable from "jspdf-autotable";
import { withTenant } from "@/lib/api/with-tenant";
import { ERR } from "@/lib/api/responses";
import { COLOR, encabezado, fechaHoraPY, gs, M, nuevoDocumento, pdfTxt, pieDePagina, respuestaPdf, tituloSeccion, W } from "@/lib/pdf/documento";
import { numeroEnLetras } from "@/lib/pdf/letras";
import { nombreMetodo } from "@/modules/clientes/cobros";

export const runtime = "nodejs";

export const GET = withTenant(async (ctx, req) => {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segs[segs.indexOf("cobros") + 1];
  if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id del cobro");
  const [c, p, a] = await Promise.all([
    ctx.db.select("cobros_clientes", "id, numero_recibo, cliente_id, cliente_nombre, fecha, total, observacion, usuario_nombre, anulado_at, anulado_motivo").eq("id", id).limit(1),
    ctx.db.select("cobros_pagos", "metodo, monto, referencia").eq("cobro_id", id),
    ctx.db.select("cobros_aplicaciones", "monto, cuentas_por_cobrar(numero, fecha_emision, monto, saldo)").eq("cobro_id", id),
  ]);
  if (c.error || p.error || a.error) return ERR.server();
  const k = c.data?.[0] as unknown as {
    numero_recibo: string; cliente_id: string; cliente_nombre: string; fecha: string; total: number; observacion: string | null;
    usuario_nombre: string | null; anulado_at: string | null; anulado_motivo: string | null;
  } | undefined;
  if (!k) return ERR.notFound("cobro");
  const pagos = (p.data ?? []) as unknown as { metodo: string; monto: number; referencia: string | null }[];
  const apl = (a.data ?? []) as unknown as { monto: number; cuentas_por_cobrar: { numero: string; fecha_emision: string; monto: number; saldo: number } | null }[];
  const [cli, deuda] = await Promise.all([
    ctx.db.select("clientes", "documento, telefono").eq("id", k.cliente_id).limit(1),
    ctx.db.rpc<number>("cliente_saldo", { p_cliente_id: k.cliente_id }),
  ]);
  const doc0 = (cli.data?.[0] ?? {}) as { documento?: string | null; telefono?: string | null };

  const doc = nuevoDocumento();
  let y = await encabezado(doc, `RECIBO ${k.numero_recibo}`, fechaHoraPY(k.fecha));

  if (k.anulado_at) {
    doc.setDrawColor(...COLOR.rojo).setLineWidth(0.6).rect(M, y, W, 12);
    doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(...COLOR.rojo);
    doc.text(pdfTxt(`ANULADO${k.anulado_motivo ? ` · ${k.anulado_motivo}` : ""}`), M + W / 2, y + 7.8, { align: "center" });
    y += 18;
  }

  // Recibimos de … la suma de …
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...COLOR.negro);
  const frase = `Recibimos de ${k.cliente_nombre}${doc0.documento ? ` (RUC/CI ${doc0.documento})` : ""} la suma de guaraníes ${numeroEnLetras(k.total)}.`;
  const lineas = doc.splitTextToSize(pdfTxt(frase), W - 50) as string[];
  doc.text(lineas, M, y + 5);
  doc.setFont("helvetica", "bold").setFontSize(16);
  doc.text(`Gs. ${gs(k.total)}`, M + W, y + 6, { align: "right" });
  y += 5 + lineas.length * 5 + 6;

  tituloSeccion(doc, "FORMA DE PAGO", M, y);
  autoTable(doc, {
    startY: y + 3,
    margin: { left: M, right: M },
    head: [["MEDIO", "REFERENCIA", "MONTO"]],
    body: pagos.map((x) => [pdfTxt(nombreMetodo(x.metodo)), pdfTxt(x.referencia ?? "—"), `Gs. ${gs(x.monto)}`]),
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 1.8, lineColor: [220, 220, 220], lineWidth: 0.2, textColor: COLOR.negro },
    headStyles: { fillColor: [244, 247, 247], textColor: COLOR.teal, fontStyle: "bold", fontSize: 7 },
    columnStyles: { 2: { halign: "right", cellWidth: 40 } },
    didParseCell: (h) => { if (h.section === "head" && h.column.index === 2) h.cell.styles.halign = "right"; },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;

  tituloSeccion(doc, "SE APLICÓ A", M, y);
  autoTable(doc, {
    startY: y + 3,
    margin: { left: M, right: M },
    head: [["VENTA", "FECHA", "IMPORTE DE LA VENTA", "PAGADO AHORA"]],
    body: apl.map((x) => {
      const cx = x.cuentas_por_cobrar;
      const f = cx?.fecha_emision ?? "";
      return [pdfTxt(cx?.numero ?? "—"), f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : "—", cx ? `Gs. ${gs(cx.monto)}` : "—", `Gs. ${gs(x.monto)}`];
    }),
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 1.8, lineColor: [220, 220, 220], lineWidth: 0.2, textColor: COLOR.negro },
    headStyles: { fillColor: [244, 247, 247], textColor: COLOR.teal, fontStyle: "bold", fontSize: 7 },
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right", cellWidth: 40 } },
    didParseCell: (h) => { if (h.section === "head" && h.column.index >= 2) h.cell.styles.halign = "right"; },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;

  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...COLOR.gris);
  doc.text(pdfTxt("Deuda que le queda al cliente:"), M, y);
  doc.setFont("helvetica", "bold").setTextColor(...COLOR.negro);
  doc.text(`Gs. ${gs(Number(deuda.data ?? 0))}`, M + W, y, { align: "right" });
  y += 6;
  if (k.observacion) {
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...COLOR.negro);
    const t = doc.splitTextToSize(pdfTxt(`Observación: ${k.observacion}`), W) as string[];
    doc.text(t, M, y);
    y += t.length * 4.5;
  }

  y = Math.max(y + 22, 200);
  const fw = 70;
  doc.setDrawColor(...COLOR.grisClaro).setLineWidth(0.3).line(M + W - fw, y, M + W, y);
  doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...COLOR.gris);
  doc.text(pdfTxt(`Recibido por${k.usuario_nombre ? `: ${k.usuario_nombre}` : ""}`), M + W - fw / 2, y + 4, { align: "center" });

  pieDePagina(doc, `Recibo ${k.numero_recibo}`);
  return respuestaPdf(doc, `recibo-${k.numero_recibo}.pdf`);
});
