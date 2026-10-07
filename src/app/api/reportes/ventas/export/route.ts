/**
 * Reporte "Ventas del período" en Excel: hojas Resumen, Por día, Medios de pago,
 * Cajeros, Productos, Categorías y Ventas (detalle, hasta 50.000). ADMIN.
 *   GET /api/reportes/ventas/export?desde&hasta&cajero&tipo&medio&categoria
 */
import { withTenant } from "@/lib/api/with-tenant";
import { buildXlsx, hoja, xlsxHeaders } from "@/lib/excel/xlsx";
import { detalleVentas, filtrosVentas, MEDIO_NOMBRE, resumenVentas } from "@/modules/reportes/server/ventas";

const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

export const GET = withTenant(
  async (ctx, req) => {
    const f = filtrosVentas(new URL(req.url).searchParams);
    try {
      const [r, det] = await Promise.all([resumenVentas(ctx.db, f), detalleVentas(ctx.db, f, 50000, 0)]);
      const k = r.kpis;
      const resumen: { c: string; v: string | number }[] = [
        { c: "Reporte", v: "Ventas del período" },
        { c: "Desde", v: f.desde },
        { c: "Hasta", v: f.hasta },
        { c: "Ventas netas", v: k.ventas_netas },
        { c: "Cantidad de ventas", v: k.cantidad_ventas },
        { c: "Ticket promedio", v: k.cantidad_ventas ? Math.round(k.ventas_netas / k.cantidad_ventas) : 0 },
        { c: "Unidades vendidas", v: k.unidades },
        { c: "Costo de lo vendido", v: k.costo },
        { c: "Ganancia bruta", v: k.ganancia },
        { c: "Margen bruto %", v: ratio(k.ganancia, k.ventas_netas) },
        ...r.iva.flatMap((t) => [
          { c: `Ventas ${t.tipo === "EXENTA" ? "exentas" : `gravadas ${t.tipo}`}`, v: t.total },
          ...(t.tipo === "EXENTA" ? [] : [{ c: `IVA ${t.tipo}`, v: t.iva }]),
        ]),
        { c: "Total IVA (débito fiscal)", v: k.iva_total },
        { c: "Ventas anuladas (cantidad)", v: r.anuladas.cantidad },
        { c: "Ventas anuladas (monto)", v: r.anuladas.monto },
        { c: "Productos vendidos sin costo cargado", v: k.productos_sin_costo },
      ];

      const xlsx = buildXlsx([
        hoja("Resumen", resumen, [
          { header: "Concepto", value: (x) => x.c, width: 34 },
          { header: "Valor", value: (x) => x.v, width: 18 },
        ]),
        hoja("Por día", r.por_dia, [
          { header: "Día", value: (d) => d.dia, width: 12 },
          { header: "Ventas", value: (d) => d.cantidad, width: 9 },
          { header: "Monto", value: (d) => d.ventas, width: 14 },
          { header: "Ticket promedio", value: (d) => (d.cantidad ? Math.round(d.ventas / d.cantidad) : 0), width: 15 },
          { header: "Ganancia", value: (d) => d.ganancia, width: 14 },
        ]),
        hoja("Medios de pago", r.por_medio, [
          { header: "Medio", value: (m) => MEDIO_NOMBRE[m.medio] ?? m.medio, width: 16 },
          { header: "Ventas", value: (m) => m.ventas, width: 9 },
          { header: "Monto", value: (m) => m.monto, width: 14 },
        ]),
        hoja("Cajeros", r.por_cajero, [
          { header: "Cajero", value: (c) => c.nombre, width: 24 },
          { header: "Ventas", value: (c) => c.cantidad, width: 9 },
          { header: "Monto", value: (c) => c.ventas, width: 14 },
          { header: "Ticket promedio", value: (c) => (c.cantidad ? Math.round(c.ventas / c.cantidad) : 0), width: 15 },
          { header: "Ganancia", value: (c) => c.ganancia, width: 14 },
          { header: "Anuladas", value: (c) => c.anuladas, width: 10 },
        ]),
        hoja("Productos", r.productos, [
          { header: "Producto", value: (p) => p.nombre, width: 34 },
          { header: "SKU", value: (p) => p.sku ?? "", width: 14 },
          { header: "Unidades", value: (p) => p.unidades, width: 10 },
          { header: "Monto", value: (p) => p.monto, width: 14 },
          { header: "Ganancia", value: (p) => p.ganancia, width: 14 },
          { header: "Margen %", value: (p) => ratio(p.ganancia, p.monto), width: 10 },
          { header: "Sin costo cargado", value: (p) => (p.sin_costo ? "SI" : ""), width: 16 },
        ]),
        hoja("Categorías", r.por_categoria, [
          { header: "Categoría", value: (c) => c.nombre, width: 24 },
          { header: "Unidades", value: (c) => c.unidades, width: 10 },
          { header: "Monto", value: (c) => c.monto, width: 14 },
          { header: "Ganancia", value: (c) => c.ganancia, width: 14 },
          { header: "Margen %", value: (c) => ratio(c.ganancia, c.monto), width: 10 },
        ]),
        hoja("Ventas", det.rows, [
          { header: "Número", value: (v) => v.numero, width: 13 },
          { header: "Fecha", value: (v) => new Date(v.fecha), width: 18 },
          { header: "Cliente", value: (v) => v.cliente ?? "", width: 24 },
          { header: "Cajero", value: (v) => v.cajero ?? "", width: 18 },
          { header: "Tipo", value: (v) => (v.tipo === "CREDITO" ? "Crédito" : "Contado"), width: 10 },
          { header: "Medio de pago", value: (v) => v.medios.map((m) => MEDIO_NOMBRE[m] ?? m).join(" + "), width: 18 },
          { header: "Ítems", value: (v) => v.items, width: 7 },
          { header: "Total", value: (v) => v.total, width: 13 },
          { header: "IVA", value: (v) => v.iva, width: 11 },
          { header: "Ganancia", value: (v) => v.ganancia, width: 13 },
          { header: "Estado", value: (v) => (v.estado === "anulada" ? "Anulada" : "Completada"), width: 12 },
        ]),
      ]);
      return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders(`ventas-${f.desde}_${f.hasta}`) });
    } catch (e) {
      console.error("[reportes/ventas/export]", e instanceof Error ? e.message : e);
      return new Response("No se pudo generar el Excel", { status: 500 });
    }
  },
  { roles: ["ADMIN"] },
);
