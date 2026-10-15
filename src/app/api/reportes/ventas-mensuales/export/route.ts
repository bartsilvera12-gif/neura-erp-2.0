/**
 * Ventas por mes en Excel: un renglón por mes con contado / crédito, año anterior y variación,
 * más las aperturas por sucursal, forma de pago y categoría.
 *   GET /api/reportes/ventas-mensuales/export?desde&hasta&sucursal → .xlsx
 */
import { withTenant } from "@/lib/api/with-tenant";
import { buildXlsx, hoja, xlsxHeaders, type Columna } from "@/lib/excel/xlsx";
import { mesCorto } from "@/components/graficos/formato";
import { argsRango, filtrosRango, leerReporte, nombreArchivo } from "@/modules/reportes/server/rpc";
import type { VentasMes } from "@/modules/reportes/tipos";

export const dynamic = "force-dynamic";

type Mes = VentasMes["meses"][number];

export const GET = withTenant(
  async (ctx, req) => {
    const r = await leerReporte<VentasMes>(ctx.db, "reporte_ventas_mes", argsRango(filtrosRango(new URL(req.url).searchParams)));
    if (!r.ok) return r.res;
    const d = r.data;
    const apertura = (lista: { id: string; nombre: string }[], campo: "por_sucursal" | "por_metodo" | "por_categoria"): Columna<Mes>[] =>
      lista.map((x) => ({ header: x.nombre, value: (m: Mes) => Number(m[campo][x.id] ?? 0), width: 14 }));
    const xlsx = buildXlsx([
      hoja<Mes>("Por mes", d.meses, [
        { header: "Mes", value: (m) => mesCorto(m.mes), width: 10 },
        { header: "Ventas", value: (m) => Number(m.total), width: 15 },
        { header: "Cantidad", value: (m) => Number(m.cantidad), width: 10 },
        { header: "Ticket promedio", value: (m) => (Number(m.cantidad) ? Math.round(Number(m.total) / Number(m.cantidad)) : 0), width: 13 },
        { header: "Contado", value: (m) => Number(m.contado), width: 15 },
        { header: "Crédito", value: (m) => Number(m.credito), width: 15 },
        { header: "Mismo mes año anterior", value: (m) => Number(m.anterior), width: 15 },
        { header: "Variación interanual %", value: (m) => (Number(m.anterior) ? Math.round(((Number(m.total) - Number(m.anterior)) / Number(m.anterior)) * 1000) / 10 : ""), width: 12 },
      ]),
      hoja<Mes>("Por sucursal", d.meses, [{ header: "Mes", value: (m) => mesCorto(m.mes), width: 10 }, ...apertura(d.sucursales, "por_sucursal")]),
      hoja<Mes>("Por forma de pago", d.meses, [{ header: "Mes", value: (m) => mesCorto(m.mes), width: 10 }, ...apertura(d.metodos.map((x) => ({ id: x.metodo, nombre: x.label })), "por_metodo")]),
      hoja<Mes>("Por categoría", d.meses, [{ header: "Mes", value: (m) => mesCorto(m.mes), width: 10 }, ...apertura(d.categorias, "por_categoria")]),
    ]);
    return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders(nombreArchivo("ventas-por-mes", d.desde, d.hasta)) });
  },
  { permiso: ["ver_reportes_financieros", "exportar"] },
);
