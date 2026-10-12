/**
 * Plantilla de importación de proveedores: GET → plantilla-proveedores.xlsx
 * (mismas columnas que el "Exportar Excel", con una fila de ejemplo).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { buildXlsx, xlsxHeaders } from "@/lib/excel/xlsx";
import { COLUMNAS_EXCEL_PROVEEDORES, EJEMPLO_PLANTILLA } from "@/modules/proveedores/importar";

export const runtime = "nodejs";

export const GET = withTenant(
  async () => {
    const xlsx = buildXlsx([
      {
        name: "Proveedores",
        cols: COLUMNAS_EXCEL_PROVEEDORES.map((c) => ({ header: c.header, width: c.width })),
        rows: [EJEMPLO_PLANTILLA],
      },
    ]);
    return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders("plantilla-proveedores") });
  },
  { roles: ["ADMIN"] },
);
