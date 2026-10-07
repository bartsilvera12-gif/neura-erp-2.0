/**
 * Excel del reporte de cierres de caja (hojas Resumen + Cierres).
 *   GET /api/reportes/cajas/export?desde=YYYY-MM-DD&hasta=YYYY-MM-DD → .xlsx
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ERR } from "@/lib/api/responses";
import { buildXlsx, hoja, xlsxHeaders } from "@/lib/excel/xlsx";
import { estadoCajaLabel, getReporteCajas, resolverRango } from "@/modules/caja/reporte-cajas";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  try {
    const r = await getReporteCajas(ctx.db, resolverRango(sp.get("desde"), sp.get("hasta")));
    const t = r.totales;
    const resumen: { c: string; v: string | number }[] = [
      { c: "Reporte", v: "Cierres de caja" },
      { c: "Desde", v: r.desde },
      { c: "Hasta", v: r.hasta },
      { c: "Cantidad de cajas", v: t.cantidad_cajas },
      { c: "Cerradas", v: t.cajas_cerradas },
      { c: "Abiertas", v: t.cajas_abiertas },
      { c: "Total vendido", v: t.total_vendido },
      { c: "Total efectivo", v: t.total_efectivo },
      { c: "Total tarjeta", v: t.total_tarjeta },
      { c: "Total POS", v: t.total_pos },
      { c: "Total transferencia", v: t.total_transferencia },
      { c: "Total otros medios", v: t.total_otros },
      { c: "Total crédito", v: t.total_credito },
      { c: "Cajas con diferencia", v: t.cajas_con_diferencia },
      { c: "Faltantes (acumulado)", v: t.faltantes },
      { c: "Sobrantes (acumulado)", v: t.sobrantes },
      { c: "Diferencia neta", v: t.total_diferencia },
    ];
    const xlsx = buildXlsx([
      hoja("Resumen", resumen, [
        { header: "Concepto", value: (x) => x.c, width: 28 },
        { header: "Valor", value: (x) => x.v, width: 22 },
      ]),
      hoja("Cierres", r.cajas, [
        { header: "Caja", value: (x) => x.numero_caja, width: 8 },
        { header: "Apertura", value: (x) => new Date(x.fecha_apertura), width: 18 },
        { header: "Cierre", value: (x) => (x.fecha_cierre ? new Date(x.fecha_cierre) : ""), width: 18 },
        { header: "Estado", value: (x) => estadoCajaLabel(x.estado), width: 11 },
        { header: "Abrió", value: (x) => x.abierta_por_nombre ?? "", width: 20 },
        { header: "Cerró", value: (x) => x.cerrada_por_nombre ?? "", width: 20 },
        { header: "Monto apertura", value: (x) => x.monto_apertura, width: 15 },
        { header: "Ventas", value: (x) => x.cantidad_ventas, width: 9 },
        { header: "Total vendido", value: (x) => x.total_vendido, width: 15 },
        { header: "Efectivo", value: (x) => x.total_efectivo, width: 14 },
        { header: "Tarjeta", value: (x) => x.total_tarjeta, width: 14 },
        { header: "POS", value: (x) => x.total_pos, width: 14 },
        { header: "Transferencia", value: (x) => x.total_transferencia, width: 14 },
        { header: "Otros medios", value: (x) => x.total_otros, width: 13 },
        { header: "Crédito", value: (x) => x.total_credito, width: 14 },
        { header: "Ingresos ef.", value: (x) => x.ingresos_efectivo, width: 13 },
        { header: "Egresos ef.", value: (x) => x.egresos_efectivo, width: 13 },
        { header: "Retiros ef.", value: (x) => x.retiros_efectivo, width: 13 },
        { header: "Ajustes ef.", value: (x) => x.ajustes_efectivo, width: 13 },
        { header: "Efectivo esperado", value: (x) => x.efectivo_esperado, width: 16 },
        { header: "Contado al cierre", value: (x) => x.monto_cierre_contado, width: 16 },
        { header: "Diferencia", value: (x) => x.diferencia, width: 13 },
        { header: "Observación cierre", value: (x) => x.observacion_cierre ?? "", width: 36 },
      ]),
    ]);
    return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders(`cierres-caja-${r.desde}_${r.hasta}`) });
  } catch {
    return ERR.server();
  }
});
