/**
 * Cierre de caja por día en Excel: hoja "Días" (un renglón por día, con cada forma de pago)
 * y hoja "Turnos" (un renglón por turno de cada caja).
 *   GET /api/reportes/cajas/export?desde&hasta&sucursal → .xlsx
 */
import { withTenant } from "@/lib/api/with-tenant";
import { fechaCorta } from "@/components/graficos/formato";
import { buildXlsx, hoja, xlsxHeaders, type Columna } from "@/lib/excel/xlsx";
import { argsRango, filtrosRango, leerReporte, nombreArchivo } from "@/modules/reportes/server/rpc";
import type { CierreDia, CierresDias } from "@/modules/reportes/tipos";

export const dynamic = "force-dynamic";

type TurnoFila = {
  id: string; dia: string; numero_caja: number; estado: string; sucursal_nombre: string | null; punto_nombre: string | null;
  fecha_apertura: string; fecha_cierre: string | null; abierta_por_nombre: string | null; cerrada_por_nombre: string | null;
  monto_apertura: number; contado: number; credito: number; total: number; cantidad: number; cobros: number; egresos: number;
  retiros: number; ingresos: number; efectivo_esperado: number; efectivo_contado: number | null; diferencia: number | null;
  diferencia_otros: number | null; motivo_diferencia: string | null; anuladas: number; por_metodo: Record<string, number>;
};

export const GET = withTenant(
  async (ctx, req) => {
    const f = filtrosRango(new URL(req.url).searchParams);
    const r = await leerReporte<CierresDias & { turnos: TurnoFila[] }>(ctx.db, "reporte_cierres_dias", { ...argsRango(f), p_turnos: true });
    if (!r.ok) return r.res;
    const d = r.data;
    const porMetodo = <T extends { por_metodo: Record<string, number> }>(): Columna<T>[] =>
      d.metodos.map((m) => ({ header: m.label, value: (x: T) => Number(x.por_metodo[m.metodo] ?? 0), width: 14 }));
    const xlsx = buildXlsx([
      hoja<CierreDia>("Días", d.dias, [
        { header: "Día", value: (x) => fechaCorta(x.dia), width: 12 },
        { header: "Sucursales", value: (x) => x.sucursales.join(", "), width: 24 },
        { header: "Turnos", value: (x) => x.turnos, width: 8 },
        { header: "Abiertos", value: (x) => x.abiertos, width: 9 },
        { header: "Ventas", value: (x) => x.cantidad, width: 8 },
        ...porMetodo<CierreDia>(),
        { header: "Contado", value: (x) => x.contado, width: 14 },
        { header: "Crédito", value: (x) => x.credito, width: 14 },
        { header: "Total vendido", value: (x) => x.total, width: 15 },
        { header: "Cobros", value: (x) => x.cobros, width: 13 },
        { header: "Egresos", value: (x) => x.egresos, width: 13 },
        { header: "Retiros", value: (x) => x.retiros, width: 13 },
        { header: "Diferencia efectivo", value: (x) => x.diferencia, width: 14 },
        { header: "Diferencia otros medios", value: (x) => x.diferencia_otros, width: 14 },
        { header: "Turnos con diferencia", value: (x) => x.con_diferencia, width: 12 },
        { header: "Anuladas", value: (x) => x.anuladas, width: 9 },
        { header: "Monto anulado", value: (x) => x.anuladas_total, width: 13 },
      ]),
      hoja<TurnoFila>("Turnos", d.turnos ?? [], [
        { header: "Día (apertura)", value: (x) => fechaCorta(x.dia), width: 12 },
        { header: "Sucursal", value: (x) => x.sucursal_nombre ?? "", width: 18 },
        { header: "Caja", value: (x) => x.punto_nombre ?? "", width: 10 },
        { header: "Turno N°", value: (x) => x.numero_caja, width: 9 },
        { header: "Estado", value: (x) => (x.estado === "cerrada" ? "Cerrada" : "Abierta"), width: 9 },
        { header: "Apertura", value: (x) => new Date(x.fecha_apertura), width: 17 },
        { header: "Abrió", value: (x) => x.abierta_por_nombre ?? "", width: 16 },
        { header: "Cierre", value: (x) => (x.fecha_cierre ? new Date(x.fecha_cierre) : ""), width: 17 },
        { header: "Cerró", value: (x) => x.cerrada_por_nombre ?? "", width: 16 },
        { header: "Monto inicial", value: (x) => x.monto_apertura, width: 13 },
        { header: "Ventas", value: (x) => x.cantidad, width: 8 },
        ...porMetodo<TurnoFila>(),
        { header: "Contado", value: (x) => x.contado, width: 14 },
        { header: "Crédito", value: (x) => x.credito, width: 14 },
        { header: "Total vendido", value: (x) => x.total, width: 15 },
        { header: "Cobros", value: (x) => x.cobros, width: 13 },
        { header: "Egresos", value: (x) => x.egresos, width: 13 },
        { header: "Retiros", value: (x) => x.retiros, width: 13 },
        { header: "Ingresos", value: (x) => x.ingresos, width: 13 },
        { header: "Efectivo esperado", value: (x) => x.efectivo_esperado, width: 15 },
        { header: "Efectivo contado", value: (x) => x.efectivo_contado, width: 15 },
        { header: "Diferencia efectivo", value: (x) => x.diferencia, width: 14 },
        { header: "Diferencia otros medios", value: (x) => x.diferencia_otros, width: 14 },
        { header: "Motivo de la diferencia", value: (x) => x.motivo_diferencia ?? "", width: 30 },
        { header: "Anuladas", value: (x) => x.anuladas, width: 9 },
      ]),
    ]);
    return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders(nombreArchivo("cierres-caja", d.desde, d.hasta)) });
  },
  { roles: ["ADMIN", "SUPERVISOR"] },
);
