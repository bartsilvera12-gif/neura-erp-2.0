/** Stock mínimo en Excel (mismos filtros que la pantalla). ADMIN. */
import { withTenant } from "@/lib/api/with-tenant";
import { buildXlsx, hoja, xlsxHeaders } from "@/lib/excel/xlsx";
import { hoyPY } from "@/lib/fecha/paraguay";
import { categoriaDeUrl, reporteStockMinimo } from "@/modules/reportes/server/stock";

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    try {
      const r = await reporteStockMinimo(ctx.db, categoriaDeUrl(sp), sp.get("sin_stock") === "1");
      const xlsx = buildXlsx([
        hoja("Stock mínimo", r.items, [
          { header: "Producto", value: (i) => i.nombre, width: 34 },
          { header: "SKU", value: (i) => i.sku ?? "", width: 14 },
          { header: "Código de barras", value: (i) => i.codigo_barras ?? "", width: 18 },
          { header: "Categoría", value: (i) => i.categoria ?? "", width: 18 },
          { header: "Unidad", value: (i) => i.unidad_medida, width: 10 },
          { header: "Stock actual", value: (i) => Number(i.stock_actual), width: 12 },
          { header: "Mínimo", value: (i) => Number(i.stock_minimo), width: 10 },
          { header: "Faltante", value: (i) => Number(i.faltante), width: 10 },
          { header: "Vendido 30 días", value: (i) => Number(i.vendido_30d), width: 14 },
          { header: "Costo unitario", value: (i) => Number(i.costo), width: 13 },
          { header: "Costo reposición", value: (i) => Number(i.costo_reposicion), width: 15 },
        ]),
      ]);
      return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders(`stock-minimo-${hoyPY()}`) });
    } catch {
      return new Response("No se pudo generar el Excel", { status: 500 });
    }
  },
  { roles: ["ADMIN"] },
);
