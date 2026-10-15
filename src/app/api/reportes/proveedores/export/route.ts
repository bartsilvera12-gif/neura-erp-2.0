/**
 * Proveedores en Excel (ranking del rango con deuda y última compra).
 *   GET /api/reportes/proveedores/export?desde&hasta&sucursal → .xlsx
 */
import { withTenant } from "@/lib/api/with-tenant";
import { buildXlsx, hoja, xlsxHeaders } from "@/lib/excel/xlsx";
import { fechaCorta } from "@/components/graficos/formato";
import { argsRango, filtrosRango, leerReporte, nombreArchivo } from "@/modules/reportes/server/rpc";
import type { Proveedores } from "@/modules/reportes/tipos";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const r = await leerReporte<Proveedores>(ctx.db, "reporte_proveedores", argsRango(filtrosRango(new URL(req.url).searchParams)));
    if (!r.ok) return r.res;
    const d = r.data;
    const total = Number(d.totales.compras) || 1;
    const xlsx = buildXlsx([
      hoja("Proveedores", d.rows, [
        { header: "Proveedor", value: (f) => f.nombre, width: 34 },
        { header: "Nombre comercial", value: (f) => f.nombre_comercial ?? "", width: 24 },
        { header: "RUC", value: (f) => f.ruc ?? "", width: 14 },
        { header: "Teléfono", value: (f) => f.telefono ?? "", width: 14 },
        { header: "Compras de mercadería", value: (f) => Number(f.compras), width: 16 },
        { header: "Cantidad de compras", value: (f) => Number(f.compras_cant), width: 10 },
        { header: "% del total comprado", value: (f) => Math.round((Number(f.compras) / total) * 1000) / 10, width: 10 },
        { header: "Última compra", value: (f) => (f.ultima_compra ? fechaCorta(f.ultima_compra) : ""), width: 12 },
        { header: "Gastos operativos", value: (f) => Number(f.gastos), width: 14 },
        { header: "Deuda (Gs.)", value: (f) => Number(f.deuda_gs), width: 14 },
        { header: "Vencido (Gs.)", value: (f) => Number(f.vencido_gs), width: 14 },
        { header: "Deuda USD", value: (f) => Number(f.deuda_usd), width: 11 },
        { header: "Productos asociados", value: (f) => Number(f.productos), width: 10 },
      ]),
    ]);
    return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders(nombreArchivo("proveedores", d.desde, d.hasta)) });
  },
  { roles: ["ADMIN"] },
);
