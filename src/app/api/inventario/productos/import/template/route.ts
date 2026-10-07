/** Plantilla de importación de productos: GET → plantilla-productos.xlsx (con una fila de ejemplo). */
import { withTenant } from "@/lib/api/with-tenant";
import { buildXlsx, xlsxHeaders } from "@/lib/excel/xlsx";
import { COLUMNAS_PLANTILLA } from "@/modules/inventario/server/import-excel";

const EJEMPLO: Record<(typeof COLUMNAS_PLANTILLA)[number], string | number> = {
  NOMBRE: "EJEMPLO PRODUCTO",
  SKU: "EJ-001",
  CODIGO_BARRAS: "",
  CATEGORIA: "BEBIDAS",
  UNIDAD_MEDIDA: "Unidad",
  COSTO_PROMEDIO: 10000,
  PRECIO_VENTA: 15000,
  STOCK_ACTUAL: 10,
  STOCK_MINIMO: 2,
  IVA: "10%",
  ACTIVO: "SI",
};

export const GET = withTenant(async () => {
  const xlsx = buildXlsx([
    {
      name: "Productos",
      cols: COLUMNAS_PLANTILLA.map((h) => ({ header: h, width: 18 })),
      rows: [COLUMNAS_PLANTILLA.map((h) => EJEMPLO[h])],
    },
  ]);
  return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders("plantilla-productos") });
});
