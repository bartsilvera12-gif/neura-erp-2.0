/** Comedor — liquidación en Excel. GET /api/comedor/liquidacion/export?desde&hasta&empresa → .xlsx */
import { withTenant } from "@/lib/api/with-tenant";
import { buildXlsx, xlsxHeaders } from "@/lib/excel/xlsx";
import { rangoLiquidacion, type Liquidacion } from "@/modules/comedor/liquidacion-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const { p_desde, p_hasta, p_empresa } = rangoLiquidacion(new URL(req.url).searchParams);
    const r = await ctx.db.rpc<Liquidacion>("comedor_liquidacion", { p_desde, p_hasta, p_empresa });
    if (r.error || !r.data) return new Response("error", { status: 500 });
    const d = r.data;
    const cols = [
      { header: "Funcionario", width: 34 }, { header: "CI", width: 14 },
      { header: "Reservas", width: 10 }, { header: "Almuerzos", width: 11 }, { header: "Cantina", width: 10 },
      { header: "Subsidio", width: 14 }, { header: "Excedente", width: 14 }, { header: "Dif. especial", width: 14 }, { header: "Total empresa", width: 15 },
    ];
    const rows: (string | number)[][] = d.rows.map((f) => [
      f.funcionario, f.documento ?? "", f.reservas, f.almuerzos, f.cantina_items,
      f.subsidio, f.excedente, f.diferencia, f.total,
    ]);
    rows.push(["TOTAL", "", "", d.totales.almuerzos, d.totales.cantina_items, d.totales.subsidio, d.totales.excedente, d.totales.diferencia, d.totales.total]);
    const xlsx = buildXlsx([{ name: "Liquidación", cols, rows }]);
    return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders(`liquidacion-comedor-${d.desde}_${d.hasta}`) });
  },
  { permiso: "comedor_administrar" },
);
