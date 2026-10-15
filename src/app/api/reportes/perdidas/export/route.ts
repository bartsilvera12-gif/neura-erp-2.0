/**
 * Pérdidas de producto en Excel: detalle, por motivo, por producto, por categoría, por depósito y por mes.
 *   GET /api/reportes/perdidas/export?desde&hasta&sucursal → .xlsx
 */
import { withTenant } from "@/lib/api/with-tenant";
import { buildXlsx, hoja, xlsxHeaders } from "@/lib/excel/xlsx";
import { fechaCorta, mesCorto } from "@/components/graficos/formato";
import { argsRango, filtrosRango, leerReporte, nombreArchivo } from "@/modules/reportes/server/rpc";
import type { Perdidas } from "@/modules/reportes/tipos";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const r = await leerReporte<Perdidas>(ctx.db, "reporte_perdidas", argsRango(filtrosRango(new URL(req.url).searchParams)));
    if (!r.ok) return r.res;
    const d = r.data;
    const xlsx = buildXlsx([
      hoja("Detalle", d.rows, [
        { header: "Fecha", value: (f) => fechaCorta(f.dia), width: 11 },
        { header: "Documento", value: (f) => f.documento, width: 12 },
        { header: "Motivo", value: (f) => f.motivo_label, width: 22 },
        { header: "Detalle", value: (f) => f.detalle ?? "", width: 32 },
        { header: "Producto", value: (f) => f.producto, width: 30 },
        { header: "SKU", value: (f) => f.sku ?? "", width: 12 },
        { header: "Depósito", value: (f) => f.deposito, width: 18 },
        { header: "Sucursal", value: (f) => f.sucursal, width: 16 },
        { header: "Unidades", value: (f) => Number(f.unidades), width: 10 },
        { header: "Valor al costo", value: (f) => Number(f.valor), width: 14 },
      ]),
      hoja("Por motivo", d.por_motivo, [
        { header: "Motivo", value: (f) => f.label, width: 24 },
        { header: "Documentos", value: (f) => Number(f.documentos), width: 11 },
        { header: "Unidades", value: (f) => Number(f.unidades), width: 10 },
        { header: "Valor al costo", value: (f) => Number(f.valor), width: 15 },
      ]),
      hoja("Por producto", d.por_producto, [
        { header: "Producto", value: (f) => f.nombre, width: 30 },
        { header: "SKU", value: (f) => f.sku ?? "", width: 12 },
        { header: "Motivos", value: (f) => f.motivos.join(", "), width: 30 },
        { header: "Unidades", value: (f) => Number(f.unidades), width: 10 },
        { header: "Valor al costo", value: (f) => Number(f.valor), width: 15 },
      ]),
      hoja("Por categoría", d.por_categoria, [
        { header: "Categoría", value: (f) => f.nombre, width: 26 },
        { header: "Unidades", value: (f) => Number(f.unidades), width: 10 },
        { header: "Valor al costo", value: (f) => Number(f.valor), width: 15 },
      ]),
      hoja("Por depósito", d.por_deposito, [
        { header: "Depósito", value: (f) => f.nombre, width: 22 },
        { header: "Sucursal", value: (f) => f.sucursal, width: 18 },
        { header: "Unidades", value: (f) => Number(f.unidades), width: 10 },
        { header: "Valor al costo", value: (f) => Number(f.valor), width: 15 },
      ]),
      hoja("Por mes", d.por_mes, [
        { header: "Mes", value: (f) => mesCorto(f.mes), width: 10 },
        { header: "Valor al costo", value: (f) => Number(f.valor), width: 15 },
      ]),
    ]);
    return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders(nombreArchivo("perdidas", d.desde, d.hasta)) });
  },
  { roles: ["ADMIN"] },
);
