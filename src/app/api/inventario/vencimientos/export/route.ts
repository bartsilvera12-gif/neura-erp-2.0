/**
 * Exportar Vencimientos a Excel, con los mismos filtros de la pantalla.
 *   GET /api/inventario/vencimientos/export?dias&q&estado&deposito → vencimientos-….xlsx
 */
import { withTenant } from "@/lib/api/with-tenant";
import { buildXlsx, hoja, xlsxHeaders } from "@/lib/excel/xlsx";
import { TZ_PY } from "@/lib/fecha/paraguay";
import { consultarVencimientos, filtrosVencimientos } from "@/modules/inventario/server/vencimientos";
import { fechaCorta, type FilaVencimiento } from "@/modules/inventario/vencimientos";

export const GET = withTenant(async (ctx, req) => {
  try {
    const r = await consultarVencimientos(ctx.db, filtrosVencimientos(new URL(req.url).searchParams));
    const xlsx = buildXlsx([
      hoja<FilaVencimiento>("Vencimientos", r.items, [
        { header: "Producto", value: (f) => f.producto, width: 36 },
        { header: "SKU", value: (f) => f.sku, width: 16 },
        { header: "Lote", value: (f) => f.numero, width: 16 },
        { header: "Sucursal", value: (f) => f.sucursal ?? "", width: 18 },
        { header: "Depósito", value: (f) => f.deposito ?? "", width: 20 },
        { header: "Vence", value: (f) => fechaCorta(f.vencimiento), width: 12 },
        { header: "Días", value: (f) => Number(f.dias), width: 8 },
        { header: "Estado", value: (f) => (f.estado === "vencido" ? "Vencido" : "Por vencer"), width: 12 },
        { header: "Unidades", value: (f) => Number(f.cantidad), width: 11 },
        { header: "Unidad", value: (f) => f.unidad_medida, width: 10 },
        { header: "Costo unit.", value: (f) => Number(f.costo) || 0, width: 13 },
        { header: "Valor al costo", value: (f) => Number(f.valor) || 0, width: 15 },
      ]),
    ]);
    const ahora = new Date().toLocaleString("sv-SE", { timeZone: TZ_PY }).replace(/[-:]/g, "").replace(" ", "-").slice(0, 13);
    return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders(`vencimientos-${ahora}`) });
  } catch {
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
});
