/**
 * Estado de cuenta del cliente en PDF. GET /api/clientes/[id]/estado-cuenta/pdf
 * Deuda y vencido, ventas a crédito (con lo cobrado y lo que falta) y los cobros.
 */
import autoTable from "jspdf-autotable";
import { withTenant } from "@/lib/api/with-tenant";
import { ERR } from "@/lib/api/responses";
import { hoyPY } from "@/lib/fecha/paraguay";
import { COLOR, encabezado, fechaHoraPY, gs, M, nuevoDocumento, pdfTxt, pieDePagina, respuestaPdf, tituloSeccion, W } from "@/lib/pdf/documento";
import { nombreMetodo, type EstadoCuenta } from "@/modules/clientes/cobros";

export const runtime = "nodejs";
const dia = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const ESTADO: Record<string, string> = { pendiente: "Pendiente", parcial: "Parcial", pagada: "Pagada", anulada: "Anulada" };

export const GET = withTenant(async (ctx, req) => {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segs[segs.indexOf("clientes") + 1];
  if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id del cliente");
  const [cli, ec] = await Promise.all([
    ctx.db.select("clientes", "nombre, razon_social, documento, telefono, direccion, ciudad, condicion_pago, plazo_dias, limite_credito").eq("id", id).limit(1),
    ctx.db.rpc<EstadoCuenta>("estado_cuenta_cliente", { p_cliente: id }),
  ]);
  if (cli.error || ec.error || !ec.data) return ERR.server();
  const c = cli.data?.[0] as unknown as Record<string, string | number | null> | undefined;
  if (!c) return ERR.notFound("cliente");
  const e = ec.data;

  const hoy = hoyPY();
  const doc = nuevoDocumento();
  let y = await encabezado(doc, "ESTADO DE CUENTA", `${pdfTxt(String(c.razon_social || c.nombre))} · al ${dia(hoy)}`);

  // Datos y cifras.
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...COLOR.gris);
  const datos = [
    c.documento ? `RUC/CI ${c.documento}` : null,
    c.telefono ? `Tel. ${c.telefono}` : null,
    [c.direccion, c.ciudad].filter(Boolean).join(", ") || null,
    c.condicion_pago === "CREDITO" ? `Crédito ${c.plazo_dias ?? 30} días${Number(c.limite_credito) > 0 ? ` · límite Gs. ${gs(Number(c.limite_credito))}` : ""}` : "Contado",
  ].filter(Boolean).join("  ·  ");
  doc.text(pdfTxt(datos), M, y);
  y += 7;
  const cifras: [string, string, boolean][] = [
    ["DEUDA TOTAL", `Gs. ${gs(e.deuda)}`, false],
    ["VENCIDO", `Gs. ${gs(e.vencido)}`, e.vencido > 0],
    ["CUENTAS ABIERTAS", String(e.cuentas.filter((x) => x.estado === "pendiente" || x.estado === "parcial").length), false],
  ];
  const cw = W / cifras.length;
  cifras.forEach(([l, v, rojo], i) => {
    const x = M + i * cw + cw / 2;
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...COLOR.teal);
    doc.text(l, x, y + 3, { align: "center" });
    doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(...(rojo ? COLOR.rojo : COLOR.negro));
    doc.text(v, x, y + 10, { align: "center" });
  });
  y += 17;

  tituloSeccion(doc, "VENTAS A CRÉDITO", M, y);
  autoTable(doc, {
    startY: y + 3,
    margin: { left: M, right: M, bottom: 16 },
    head: [["VENTA", "FECHA", "VENCE", "IMPORTE", "COBRADO", "SALDO", "ESTADO"]],
    body: e.cuentas.filter((x) => x.estado !== "anulada").map((x) => [
      pdfTxt(x.numero), dia(x.fecha_emision), dia(x.vencimiento), gs(x.monto), gs(x.cobrado), gs(x.saldo),
      pdfTxt(x.dias_atraso > 0 ? `Vencida ${x.dias_atraso} d` : ESTADO[x.estado] ?? x.estado),
    ]),
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8, cellPadding: 1.6, lineColor: [220, 220, 220], lineWidth: 0.2, textColor: COLOR.negro },
    headStyles: { fillColor: [244, 247, 247], textColor: COLOR.teal, fontStyle: "bold", fontSize: 6.8 },
    columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right", fontStyle: "bold" } },
    didParseCell: (h) => {
      if (h.section === "head" && h.column.index >= 3 && h.column.index <= 5) h.cell.styles.halign = "right";
      if (h.section === "body" && h.column.index === 6 && String(h.cell.raw).startsWith("Vencida")) h.cell.styles.textColor = COLOR.rojo;
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  const cobros = e.cobros.filter((k) => !k.anulado_at);
  if (cobros.length) {
    tituloSeccion(doc, "PAGOS RECIBIDOS", M, y);
    autoTable(doc, {
      startY: y + 3,
      margin: { left: M, right: M, bottom: 16 },
      head: [["RECIBO", "FECHA", "MEDIO", "APLICADO A", "MONTO"]],
      body: cobros.map((k) => [
        pdfTxt(k.numero_recibo), fechaHoraPY(k.fecha).slice(0, 10),
        pdfTxt((k.pagos ?? []).map((p) => nombreMetodo(p.metodo)).join(" + ")),
        pdfTxt((k.aplicado_a ?? []).map((a) => a.numero).join(", ")),
        gs(k.total),
      ]),
      theme: "grid",
      styles: { font: "helvetica", fontSize: 8, cellPadding: 1.6, lineColor: [220, 220, 220], lineWidth: 0.2, textColor: COLOR.negro },
      headStyles: { fillColor: [244, 247, 247], textColor: COLOR.teal, fontStyle: "bold", fontSize: 6.8 },
      columnStyles: { 4: { halign: "right" } },
      didParseCell: (h) => { if (h.section === "head" && h.column.index === 4) h.cell.styles.halign = "right"; },
    });
  }

  pieDePagina(doc, "Estado de cuenta");
  return respuestaPdf(doc, `estado-cuenta-${String(c.nombre).replace(/[^\w]+/g, "-").toLowerCase()}-${hoy}.pdf`);
});
