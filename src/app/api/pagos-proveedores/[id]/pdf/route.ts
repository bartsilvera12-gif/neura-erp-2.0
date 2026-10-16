/**
 * Orden de pago en PDF. GET /api/pagos-proveedores/[id]/pdf
 * "Pagamos a … la suma de … (en letras)", medios de pago, facturas que se cancelan,
 * deuda que le queda con el proveedor y firmas (autorizado / recibí conforme).
 * Si está anulada, lo dice grande.
 */
import { datosEmpresa } from "@/modules/empresa/server";
import autoTable from "jspdf-autotable";
import { withTenant } from "@/lib/api/with-tenant";
import { ERR } from "@/lib/api/responses";
import { COLOR, encabezado, fechaHoraPY, M, nuevoDocumento, pdfTxt, pieDePagina, respuestaPdf, tituloSeccion, W } from "@/lib/pdf/documento";
import { numeroEnLetras } from "@/lib/pdf/letras";
import { dinero, nombreMetodoPago, type EstadoCuentaProveedor } from "@/modules/compras/pagos";

export const runtime = "nodejs";

const dia = (d: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");

/** "un millón doscientos mil" (Gs.) · "mil doscientos con 50/100" (USD). */
function enLetras(v: number, moneda: string) {
  if (moneda !== "USD") return `guaraníes ${numeroEnLetras(v)}`;
  const n = Math.round((Number(v) || 0) * 100);
  const entero = Math.floor(n / 100);
  const cent = n % 100;
  return `dólares americanos ${numeroEnLetras(entero)} con ${String(cent).padStart(2, "0")}/100`;
}

export const GET = withTenant(
  async (ctx, req) => {
    const segs = new URL(req.url).pathname.split("/").filter(Boolean);
    const id = segs[segs.indexOf("pagos-proveedores") + 1];
    if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id del pago");
    const [p, m, a] = await Promise.all([
      ctx.db
        .select("pagos_proveedores", "id, numero, proveedor_id, proveedor_nombre, fecha, moneda, total, observacion, usuario_nombre, anulado_at, anulado_motivo")
        .eq("id", id)
        .limit(1),
      ctx.db.select("pagos_proveedores_medios", "metodo, monto, referencia").eq("pago_id", id),
      ctx.db.select("pagos_proveedores_aplicaciones", "monto, cuentas_por_pagar(numero, fecha_emision, vencimiento, monto, compras(numero_control), gastos(numero))").eq("pago_id", id),
    ]);
    if (p.error || m.error || a.error) return ERR.server();
    const k = p.data?.[0] as unknown as {
      numero: string; proveedor_id: string; proveedor_nombre: string; fecha: string; moneda: string; total: number;
      observacion: string | null; usuario_nombre: string | null; anulado_at: string | null; anulado_motivo: string | null;
    } | undefined;
    if (!k) return ERR.notFound("pago");
    const medios = (m.data ?? []) as unknown as { metodo: string; monto: number; referencia: string | null }[];
    const apl = (a.data ?? []) as unknown as {
      monto: number;
      cuentas_por_pagar: { numero: string; fecha_emision: string; vencimiento: string; monto: number; compras: { numero_control: string } | null; gastos: { numero: string | null } | null } | null;
    }[];
    const [prov, ec] = await Promise.all([
      ctx.db.select("proveedores", "nombre, ruc, telefono").eq("id", k.proveedor_id).limit(1),
      ctx.db.rpc<EstadoCuentaProveedor>("estado_cuenta_proveedor", { p_proveedor: k.proveedor_id }),
    ]);
    const pv = (prov.data?.[0] ?? {}) as { nombre?: string; ruc?: string | null; telefono?: string | null };
    const din = (v: number) => dinero(v, k.moneda);

    const doc = nuevoDocumento(await datosEmpresa(ctx.db));
    let y = await encabezado(doc, `ORDEN DE PAGO ${k.numero}`, fechaHoraPY(k.fecha));

    if (k.anulado_at) {
      doc.setDrawColor(...COLOR.rojo).setLineWidth(0.6).rect(M, y, W, 12);
      doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(...COLOR.rojo);
      doc.text(pdfTxt(`ANULADA${k.anulado_motivo ? ` · ${k.anulado_motivo}` : ""}`), M + W / 2, y + 7.8, { align: "center" });
      y += 18;
    }

    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...COLOR.negro);
    const nombre = pv.nombre || k.proveedor_nombre;
    const frase = `Pagamos a ${nombre}${pv.ruc ? ` (RUC ${pv.ruc})` : ""} la suma de ${enLetras(k.total, k.moneda)}.`;
    const lineas = doc.splitTextToSize(pdfTxt(frase), W - 58) as string[];
    doc.text(lineas, M, y + 5);
    doc.setFont("helvetica", "bold").setFontSize(16);
    doc.text(din(k.total), M + W, y + 6, { align: "right" });
    y += 5 + lineas.length * 5 + 6;

    const estilos = {
      theme: "grid" as const,
      styles: { font: "helvetica" as const, fontSize: 8.5, cellPadding: 1.8, lineColor: [220, 220, 220] as [number, number, number], lineWidth: 0.2, textColor: COLOR.negro },
      headStyles: { fillColor: [244, 247, 247] as [number, number, number], textColor: COLOR.teal, fontStyle: "bold" as const, fontSize: 7 },
    };

    tituloSeccion(doc, "FORMA DE PAGO", M, y);
    autoTable(doc, {
      startY: y + 3,
      margin: { left: M, right: M },
      head: [["MEDIO", "REFERENCIA", "MONTO"]],
      body: medios.map((x) => [pdfTxt(nombreMetodoPago(x.metodo)), pdfTxt(x.referencia ?? "—"), din(x.monto)]),
      ...estilos,
      columnStyles: { 2: { halign: "right", cellWidth: 42 } },
      didParseCell: (h) => { if (h.section === "head" && h.column.index === 2) h.cell.styles.halign = "right"; },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;

    tituloSeccion(doc, "FACTURAS QUE SE PAGAN", M, y);
    autoTable(doc, {
      startY: y + 3,
      margin: { left: M, right: M },
      head: [["FACTURA", "COMPRA", "EMISIÓN", "VENCE", "IMPORTE", "PAGADO AHORA"]],
      body: apl.map((x) => {
        const cx = x.cuentas_por_pagar;
        return [
          pdfTxt(cx?.numero ?? "—"), pdfTxt(cx?.compras?.numero_control ?? cx?.gastos?.numero ?? "—"), dia(cx?.fecha_emision ?? ""), dia(cx?.vencimiento ?? ""),
          cx ? din(cx.monto) : "—", din(x.monto),
        ];
      }),
      ...estilos,
      columnStyles: { 4: { halign: "right" }, 5: { halign: "right", cellWidth: 38 } },
      didParseCell: (h) => { if (h.section === "head" && h.column.index >= 4) h.cell.styles.halign = "right"; },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;

    const deuda = k.moneda === "USD" ? Number(ec.data?.deuda_usd ?? 0) : Number(ec.data?.deuda_gs ?? 0);
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...COLOR.gris);
    doc.text(pdfTxt("Saldo que queda con el proveedor:"), M, y);
    doc.setFont("helvetica", "bold").setTextColor(...COLOR.negro);
    doc.text(din(deuda), M + W, y, { align: "right" });
    y += 6;
    if (k.observacion) {
      doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...COLOR.negro);
      const t = doc.splitTextToSize(pdfTxt(`Observación: ${k.observacion}`), W) as string[];
      doc.text(t, M, y);
      y += t.length * 4.5;
    }

    // Firmas: quien autoriza y el proveedor que recibe.
    y = Math.max(y + 24, 210);
    const fw = 70;
    doc.setDrawColor(...COLOR.grisClaro).setLineWidth(0.3);
    doc.line(M, y, M + fw, y);
    doc.line(M + W - fw, y, M + W, y);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...COLOR.gris);
    doc.text(pdfTxt(`Autorizado por${k.usuario_nombre ? `: ${k.usuario_nombre}` : ""}`), M + fw / 2, y + 4, { align: "center" });
    doc.text(pdfTxt("Recibí conforme (firma y aclaración)"), M + W - fw / 2, y + 4, { align: "center" });

    pieDePagina(doc, `Orden de pago ${k.numero}`);
    return respuestaPdf(doc, `orden-de-pago-${k.numero}.pdf`);
  },
  { roles: ["ADMIN"] },
);
