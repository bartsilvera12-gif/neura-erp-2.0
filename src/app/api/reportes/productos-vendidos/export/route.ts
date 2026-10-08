/**
 * Productos vendidos en Excel: hoja "Por producto" (resumido) + hoja "Detalle" (cada línea
 * de venta, hasta 50.000). Mismos filtros que la pantalla. ADMIN.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { buildXlsx, hoja, xlsxHeaders } from "@/lib/excel/xlsx";
import { detalleProductos, filtrosProductos, resumenProductos } from "@/modules/reportes/server/productos";

const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

export const GET = withTenant(
  async (ctx, req) => {
    const f = filtrosProductos(new URL(req.url).searchParams);
    try {
      const [r, det] = await Promise.all([resumenProductos(ctx.db, f), detalleProductos(ctx.db, f, 50000, 0)]);
      const total = Number(r.totales.total);
      const xlsx = buildXlsx([
        hoja("Por producto", r.items, [
          { header: "Producto", value: (i) => i.nombre, width: 34 },
          { header: "SKU", value: (i) => i.sku ?? "", width: 14 },
          { header: "Categoría", value: (i) => i.categoria ?? "", width: 18 },
          { header: "Unidades", value: (i) => Number(i.unidades), width: 10 },
          { header: "Ventas", value: (i) => Number(i.ventas), width: 9 },
          { header: "Total", value: (i) => Number(i.total), width: 14 },
          { header: "% del total", value: (i) => ratio(Number(i.total), total), width: 11 },
          { header: "Precio promedio", value: (i) => Number(i.precio_promedio), width: 15 },
          { header: "Costo", value: (i) => Number(i.costo), width: 13 },
          { header: "Ganancia", value: (i) => Number(i.ganancia), width: 13 },
          { header: "Margen %", value: (i) => ratio(Number(i.ganancia), Number(i.total)), width: 10 },
          { header: "Stock actual", value: (i) => (i.controla_stock ? Number(i.stock_actual) : ""), width: 12 },
          { header: "Valor del stock", value: (i) => Number(i.valor_stock), width: 14 },
          { header: "Sin costo cargado", value: (i) => (i.sin_costo ? "SI" : ""), width: 15 },
        ]),
        hoja("Detalle", det.rows, [
          { header: "Fecha", value: (l) => new Date(l.fecha), width: 18 },
          { header: "Venta", value: (l) => l.numero, width: 13 },
          { header: "Cliente", value: (l) => l.cliente ?? "", width: 22 },
          { header: "Cajero", value: (l) => l.cajero ?? "", width: 18 },
          { header: "Tipo", value: (l) => (l.tipo === "CREDITO" ? "Crédito" : "Contado"), width: 10 },
          { header: "Producto", value: (l) => l.producto, width: 32 },
          { header: "SKU", value: (l) => l.sku ?? "", width: 14 },
          { header: "Cantidad", value: (l) => Number(l.cantidad), width: 10 },
          { header: "Precio lista", value: (l) => Number(l.precio_lista), width: 12 },
          { header: "Precio cobrado", value: (l) => Number(l.precio), width: 13 },
          { header: "Total", value: (l) => Number(l.total), width: 13 },
          { header: "Ganancia", value: (l) => Number(l.ganancia), width: 13 },
        ]),
      ]);
      return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders(`productos-vendidos-${f.desde}_${f.hasta}`) });
    } catch {
      return new Response("No se pudo generar el Excel", { status: 500 });
    }
  },
  { roles: ["ADMIN"] },
);
