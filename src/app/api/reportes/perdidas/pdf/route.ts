/**
 * Pérdidas de producto en PDF: totales, impacto, por motivo, productos, depósitos y detalle.
 *   GET /api/reportes/perdidas/pdf?desde&hasta&sucursal → descarga
 */
import { withTenant } from "@/lib/api/with-tenant";
import { COLOR, encabezado, gs, nuevoDocumento, pieDePagina, respuestaPdf } from "@/lib/pdf/documento";
import { kpisPdf, tablaPdf } from "@/lib/pdf/tabla";
import { fechaCorta } from "@/components/graficos/formato";
import { argsRango, describirRango, filtrosRango, leerReporte, nombreArchivo } from "@/modules/reportes/server/rpc";
import type { Perdidas } from "@/modules/reportes/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const g = (n: number) => `Gs. ${gs(n)}`;
const pc = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(2)} %` : "—");

export const GET = withTenant(
  async (ctx, req) => {
    const r = await leerReporte<Perdidas>(ctx.db, "reporte_perdidas", argsRango(filtrosRango(new URL(req.url).searchParams)));
    if (!r.ok) return r.res;
    const d = r.data;
    const t = d.totales;
    const doc = nuevoDocumento();
    let y = await encabezado(doc, "PÉRDIDAS DE PRODUCTO", describirRango(d));
    y = kpisPdf(doc, y, [
      { label: "Pérdidas al costo", valor: g(t.valor), sub: `${gs(t.unidades)} unidades · ${t.documentos} documentos`, color: COLOR.rojo },
      { label: "Sobre las ventas", valor: pc(t.valor, d.impacto.ventas_netas), sub: `ventas ${g(d.impacto.ventas_netas)}` },
      { label: "Sobre el inventario", valor: pc(t.valor, d.impacto.valor_inventario), sub: `stock al costo ${g(d.impacto.valor_inventario)}` },
      { label: "Pendientes de aprobar", valor: String(d.pendientes.cantidad), sub: d.pendientes.cantidad ? `aprox. ${g(d.pendientes.valor)}` : undefined },
    ]);
    y = tablaPdf(doc, y, "POR MOTIVO", ["MOTIVO", "DOCUMENTOS", "UNIDADES", "VALOR", "% DEL TOTAL"],
      d.por_motivo.map((m) => [m.label, m.documentos, gs(m.unidades), g(m.valor), pc(m.valor, t.valor)]), [1, 2, 3, 4], { pie: ["Total", t.documentos, gs(t.unidades), g(t.valor), "100 %"] });
    y = tablaPdf(doc, y, "PRODUCTOS CON MÁS PÉRDIDA", ["PRODUCTO", "MOTIVOS", "UNIDADES", "VALOR"],
      d.por_producto.slice(0, 20).map((p) => [p.nombre, p.motivos.join(", "), gs(p.unidades), g(p.valor)]), [2, 3]);
    y = tablaPdf(doc, y, "POR DEPÓSITO", ["DEPÓSITO", "SUCURSAL", "UNIDADES", "VALOR"],
      d.por_deposito.map((p) => [p.nombre, p.sucursal, gs(p.unidades), g(p.valor)]), [2, 3]);
    tablaPdf(doc, y, "DETALLE", ["FECHA", "DOC.", "MOTIVO", "PRODUCTO", "DEPÓSITO", "UNID.", "VALOR"],
      d.rows.map((x) => [fechaCorta(x.dia), x.documento, x.motivo_label, x.producto, x.deposito, gs(x.unidades), g(x.valor)]), [5, 6], { styles: { fontSize: 7 } });
    pieDePagina(doc, "Pérdidas de producto · valorizadas al costo");
    return respuestaPdf(doc, `${nombreArchivo("perdidas", d.desde, d.hasta)}.pdf`);
  },
  { permiso: ["ver_reportes_financieros", "exportar"] },
);
