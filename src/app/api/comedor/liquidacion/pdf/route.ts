/** Comedor — liquidación en PDF. GET /api/comedor/liquidacion/pdf?desde&hasta&empresa → descarga */
import { withTenant } from "@/lib/api/with-tenant";
import { datosEmpresa } from "@/modules/empresa/server";
import { encabezado, gs, nuevoDocumento, pieDePagina, respuestaPdf } from "@/lib/pdf/documento";
import { kpisPdf, tablaPdf } from "@/lib/pdf/tabla";
import { rangoLiquidacion, type Liquidacion } from "@/modules/comedor/liquidacion-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fecha = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("es-PY", { day: "2-digit", month: "short", year: "numeric" });

export const GET = withTenant(
  async (ctx, req) => {
    const { p_desde, p_hasta, p_empresa } = rangoLiquidacion(new URL(req.url).searchParams);
    const r = await ctx.db.rpc<Liquidacion>("comedor_liquidacion", { p_desde, p_hasta, p_empresa });
    if (r.error || !r.data) return new Response("error", { status: 500 });
    const d = r.data;
    const emp = await datosEmpresa(ctx.db);

    const doc = nuevoDocumento(emp);
    let y = await encabezado(doc, "LIQUIDACIÓN DEL COMEDOR", `Del ${fecha(d.desde)} al ${fecha(d.hasta)}`);
    y = kpisPdf(doc, y, [
      { label: "Funcionarios", valor: String(d.totales.funcionarios) },
      { label: "Subsidio", valor: `Gs ${gs(d.totales.subsidio)}` },
      { label: "Excedente", valor: `Gs ${gs(d.totales.excedente)}` },
      { label: "Total a la empresa", valor: `Gs ${gs(d.totales.total)}` },
    ]);
    tablaPdf(
      doc, y, "POR FUNCIONARIO",
      ["FUNCIONARIO", "CI", "RES.", "ALM.", "CANT.", "SUBSIDIO", "EXCEDENTE", "DIF. ESP.", "TOTAL"],
      d.rows.map((f) => [f.funcionario, f.documento ?? "", f.reservas, f.almuerzos, f.cantina_items, gs(f.subsidio), gs(f.excedente), gs(f.diferencia), gs(f.total)]),
      [2, 3, 4, 5, 6, 7, 8],
      { pie: ["TOTAL", "", "", d.totales.almuerzos, d.totales.cantina_items, gs(d.totales.subsidio), gs(d.totales.excedente), gs(d.totales.diferencia), gs(d.totales.total)] },
    );
    pieDePagina(doc, "Comedor · liquidación mensual");
    return respuestaPdf(doc, `liquidacion-comedor-${d.desde}_${d.hasta}.pdf`);
  },
  { permiso: "comedor_administrar" },
);
