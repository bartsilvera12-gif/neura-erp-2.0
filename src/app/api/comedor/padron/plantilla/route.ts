/** Plantilla del padrón de funcionarios: GET → plantilla-funcionarios.xlsx (Nombre y apellido · CI). */
import { withTenant } from "@/lib/api/with-tenant";
import { buildXlsx, xlsxHeaders } from "@/lib/excel/xlsx";
import { COLUMNAS_EXCEL_FUNCIONARIOS, EJEMPLO_PLANTILLA_FUNCIONARIOS } from "@/modules/comedor/importar-funcionarios";

export const runtime = "nodejs";

export const GET = withTenant(
  async () => {
    const xlsx = buildXlsx([
      {
        name: "Funcionarios",
        cols: COLUMNAS_EXCEL_FUNCIONARIOS.map((c) => ({ header: c.header, width: c.width })),
        rows: [EJEMPLO_PLANTILLA_FUNCIONARIOS],
      },
    ]);
    return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders("plantilla-funcionarios") });
  },
  { permiso: "comedor_administrar" },
);
