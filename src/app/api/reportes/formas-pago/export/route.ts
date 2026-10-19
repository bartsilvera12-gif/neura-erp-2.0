/**
 * Formas de pago en Excel: un renglón por medio (+ venta a crédito y total) con ventas,
 * cantidad, ticket, costo, ganancia, margen y participación; los ingresos por medio (ventas de
 * contado + cobros de créditos) y la evolución por día o mes.
 *   GET /api/reportes/formas-pago/export?desde&hasta&sucursal → .xlsx
 */
import { withTenant } from "@/lib/api/with-tenant";
import { buildXlsx, hoja, xlsxHeaders } from "@/lib/excel/xlsx";
import { fechaCorta, mesCorto } from "@/components/graficos/formato";
import { argsRango, filtrosRango, leerReporte, nombreArchivo } from "@/modules/reportes/server/rpc";
import type { FormasPago } from "@/modules/reportes/tipos";

export const dynamic = "force-dynamic";

type Fila = { label: string; ventas: number; cantidad: number; costo: number; ganancia: number };
const pct1 = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : "");

export const GET = withTenant(
  async (ctx, req) => {
    const r = await leerReporte<FormasPago>(ctx.db, "reporte_formas_pago", argsRango(filtrosRango(new URL(req.url).searchParams)));
    if (!r.ok) return r.res;
    const d = r.data;
    const total = Number(d.totales.ventas);
    const filas: Fila[] = [
      ...d.medios.map((m) => ({ label: m.label, ventas: Number(m.ventas), cantidad: Number(m.cantidad), costo: Number(m.costo), ganancia: Number(m.ganancia) })),
      ...(Number(d.credito.ventas) ? [{ label: "Venta a crédito", ventas: Number(d.credito.ventas), cantidad: Number(d.credito.cantidad), costo: Number(d.credito.costo), ganancia: Number(d.credito.ganancia) }] : []),
      { label: "Total", ventas: total, cantidad: Number(d.totales.cantidad), costo: Number(d.totales.costo), ganancia: Number(d.totales.ganancia) },
    ];
    const ingresos = [
      ...d.ingresos.map((i) => ({ label: i.label, ventas: Number(i.ventas), cobros: Number(i.cobros), total: Number(i.total) })),
      { label: "Total", ventas: Number(d.totales.contado), cobros: Number(d.cobros.total), total: Number(d.totales.contado) + Number(d.cobros.total) },
    ];
    const metodos = [...d.medios.map((m) => ({ id: m.metodo, nombre: m.label })), ...(Number(d.credito.ventas) ? [{ id: "credito", nombre: "Venta a crédito" }] : [])];
    const etiqueta = (x: string) => (d.agrupacion === "dia" ? fechaCorta(x) : mesCorto(x));

    const xlsx = buildXlsx([
      hoja<Fila>("Por forma de pago", filas, [
        { header: "Forma de pago", value: (f) => f.label, width: 22 },
        { header: "Ventas (IVA incl.)", value: (f) => f.ventas, width: 16 },
        { header: "Cant. ventas", value: (f) => f.cantidad, width: 11 },
        { header: "Ticket promedio", value: (f) => (f.cantidad ? Math.round(f.ventas / f.cantidad) : 0), width: 14 },
        { header: "Costo", value: (f) => f.costo, width: 15 },
        { header: "Ganancia bruta", value: (f) => f.ganancia, width: 15 },
        { header: "Margen %", value: (f) => pct1(f.ganancia, f.ventas), width: 10 },
        { header: "% del total", value: (f) => pct1(f.ventas, total), width: 10 },
      ]),
      hoja("Ingresos por medio", ingresos, [
        { header: "Medio", value: (f) => f.label, width: 22 },
        { header: "Ventas de contado", value: (f) => f.ventas, width: 16 },
        { header: "Cobros de créditos", value: (f) => f.cobros, width: 16 },
        { header: "Ingreso total", value: (f) => f.total, width: 16 },
      ]),
      hoja(d.agrupacion === "dia" ? "Por día" : "Por mes", d.evolucion, [
        { header: d.agrupacion === "dia" ? "Día" : "Mes", value: (e) => etiqueta(e.x), width: 12 },
        ...metodos.map((m) => ({ header: m.nombre, value: (e: FormasPago["evolucion"][number]) => Number(e.por_metodo[m.id] ?? 0), width: 15 })),
        { header: "Total ventas", value: (e) => Object.values(e.por_metodo).reduce((a, v) => a + Number(v), 0), width: 15 },
        { header: "Cobros de créditos", value: (e) => Number(e.cobros), width: 15 },
      ]),
    ]);
    return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders(nombreArchivo("formas-de-pago", d.desde, d.hasta)) });
  },
  { permiso: ["ver_reportes_financieros", "exportar"] },
);
