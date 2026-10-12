/**
 * Estado de cuenta del proveedor en PDF. GET /api/proveedores/[id]/estado-cuenta/pdf
 * Deuda (Gs. y USD) y vencido, facturas a crédito (con lo pagado y lo que falta) y los pagos.
 */
import autoTable from "jspdf-autotable";
import { withTenant } from "@/lib/api/with-tenant";
import { ERR } from "@/lib/api/responses";
import { hoyPY } from "@/lib/fecha/paraguay";
import { COLOR, encabezado, fechaHoraPY, M, nuevoDocumento, pdfTxt, pieDePagina, respuestaPdf, tituloSeccion, W } from "@/lib/pdf/documento";
import { dinero, nombreMetodoPago, type EstadoCuentaProveedor } from "@/modules/compras/pagos";

export const runtime = "nodejs";
const dia = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const ESTADO: Record<string, string> = { pendiente: "Pendiente", parcial: "Parcial", pagada: "Pagada", anulada: "Anulada" };

export const GET = withTenant(
  async (ctx, req) => {
    const segs = new URL(req.url).pathname.split("/").filter(Boolean);
    const id = segs[segs.indexOf("proveedores") + 1];
    if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id del proveedor");
    const [pq, ec] = await Promise.all([
      ctx.db.select("proveedores", "nombre, nombre_comercial, ruc, telefono, direccion, ciudad, condicion_pago, plazo_pago_dias").eq("id", id).limit(1),
      ctx.db.rpc<EstadoCuentaProveedor>("estado_cuenta_proveedor", { p_proveedor: id }),
    ]);
    if (pq.error || ec.error || !ec.data) return ERR.server();
    const p = pq.data?.[0] as unknown as Record<string, string | number | null> | undefined;
    if (!p) return ERR.notFound("proveedor");
    const e = ec.data;

    const hoy = hoyPY();
    const doc = nuevoDocumento();
    let y = await encabezado(doc, "ESTADO DE CUENTA · PROVEEDOR", `${pdfTxt(String(p.nombre))} · al ${dia(hoy)}`);

    doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...COLOR.gris);
    const datos = [
      p.nombre_comercial && p.nombre_comercial !== p.nombre ? String(p.nombre_comercial) : null,
      p.ruc ? `RUC ${p.ruc}` : null,
      p.telefono ? `Tel. ${p.telefono}` : null,
      [p.direccion, p.ciudad].filter(Boolean).join(", ") || null,
      p.condicion_pago === "credito" ? `Crédito ${p.plazo_pago_dias ?? 30} días` : "Contado",
    ].filter(Boolean).join("  ·  ");
    doc.text(pdfTxt(datos), M, y);
    y += 7;
    const abiertas = e.cuentas.filter((x) => x.estado === "pendiente" || x.estado === "parcial");
    const cifras: [string, string, boolean][] = [
      ["DEUDA EN GS.", dinero(e.deuda_gs, "GS"), false],
      ...(Number(e.deuda_usd) > 0 ? [["DEUDA EN USD", dinero(e.deuda_usd, "USD"), false] as [string, string, boolean]] : []),
      ["VENCIDO (GS.)", dinero(e.vencido_gs, "GS"), Number(e.vencido_gs) > 0],
      ["FACTURAS ABIERTAS", String(abiertas.length), false],
    ];
    const cw = W / cifras.length;
    cifras.forEach(([l, v, rojo], i) => {
      const x = M + i * cw + cw / 2;
      doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...COLOR.teal);
      doc.text(l, x, y + 3, { align: "center" });
      doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(...(rojo ? COLOR.rojo : COLOR.negro));
      doc.text(v, x, y + 10, { align: "center" });
    });
    y += 17;

    const estilos = {
      theme: "grid" as const,
      styles: { font: "helvetica" as const, fontSize: 8, cellPadding: 1.6, lineColor: [220, 220, 220] as [number, number, number], lineWidth: 0.2, textColor: COLOR.negro },
      headStyles: { fillColor: [244, 247, 247] as [number, number, number], textColor: COLOR.teal, fontStyle: "bold" as const, fontSize: 6.8 },
    };

    tituloSeccion(doc, "FACTURAS A CRÉDITO", M, y);
    autoTable(doc, {
      startY: y + 3,
      margin: { left: M, right: M, bottom: 16 },
      head: [["FACTURA", "COMPRA", "EMISIÓN", "VENCE", "IMPORTE", "PAGADO", "SALDO", "ESTADO"]],
      body: e.cuentas.filter((x) => x.estado !== "anulada").map((x) => [
        pdfTxt(x.numero), pdfTxt(x.compra_numero ?? ""), dia(x.fecha_emision), dia(x.vencimiento),
        dinero(x.monto, x.moneda), dinero(x.pagado, x.moneda), dinero(x.saldo, x.moneda),
        pdfTxt(x.dias_atraso > 0 ? `Vencida ${x.dias_atraso} d` : ESTADO[x.estado] ?? x.estado),
      ]),
      ...estilos,
      columnStyles: { 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right", fontStyle: "bold" } },
      didParseCell: (h) => {
        if (h.section === "head" && h.column.index >= 4 && h.column.index <= 6) h.cell.styles.halign = "right";
        if (h.section === "body" && h.column.index === 7 && String(h.cell.raw).startsWith("Vencida")) h.cell.styles.textColor = COLOR.rojo;
      },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

    const pagos = e.pagos.filter((k) => !k.anulado_at);
    if (pagos.length) {
      tituloSeccion(doc, "PAGOS REALIZADOS", M, y);
      autoTable(doc, {
        startY: y + 3,
        margin: { left: M, right: M, bottom: 16 },
        head: [["ORDEN", "FECHA", "MEDIO", "APLICADO A", "MONTO"]],
        body: pagos.map((k) => [
          pdfTxt(k.numero), fechaHoraPY(k.fecha).slice(0, 10),
          pdfTxt((k.medios ?? []).map((x) => nombreMetodoPago(x.metodo)).join(" + ")),
          pdfTxt((k.aplicado_a ?? []).map((a) => a.numero).join(", ")),
          dinero(k.total, k.moneda),
        ]),
        ...estilos,
        columnStyles: { 4: { halign: "right" } },
        didParseCell: (h) => { if (h.section === "head" && h.column.index === 4) h.cell.styles.halign = "right"; },
      });
    }

    pieDePagina(doc, "Estado de cuenta del proveedor");
    return respuestaPdf(doc, `estado-cuenta-proveedor-${String(p.nombre).replace(/[^\w]+/g, "-").toLowerCase()}-${hoy}.pdf`);
  },
  { roles: ["ADMIN"] },
);
