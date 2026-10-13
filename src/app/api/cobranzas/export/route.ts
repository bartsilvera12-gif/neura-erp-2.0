/**
 * Seguimiento de cobranzas a Excel: UNA fila por servicio.
 *   GET /api/cobranzas/export?q&plan&categoria&tramo&promesa_hoy=1
 *   Mismos filtros que la pantalla (exportás lo que ves).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ERR } from "@/lib/api/responses";
import { buildXlsx, hoja, xlsxHeaders } from "@/lib/excel/xlsx";
import { hoyPY } from "@/lib/fecha/paraguay";
import { filasBase, filtrarTabla, ordenPorDefecto, TODOS } from "@/modules/cobranzas/filtros";
import { mesCorto, planDe, TRAMO_LABEL, type ClienteCobranza, type ServicioCobranza, type TramoKey } from "@/modules/cobranzas/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRAMOS = new Set(["por_vencer", "tramo_1", "tramo_2", "tramo_3"]);
const fechaDia = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00-03:00`) : null);

type Linea = { c: ClienteCobranza; s: ServicioCobranza };

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const { data, error } = await ctx.db.rpc<{ hoy: string; clientes: ClienteCobranza[] }>("cobranza_seguimiento");
  if (error || !data) return ERR.server();
  const tramo = TRAMOS.has(sp.get("tramo") ?? "") ? (sp.get("tramo") as TramoKey) : "todos";
  const filas = ordenPorDefecto(
    filtrarTabla(
      filasBase(data.clientes, { q: sp.get("q")?.slice(0, 200) ?? "", plan: sp.get("plan") || TODOS, categoria: sp.get("categoria") || TODOS }),
      tramo,
      sp.get("promesa_hoy") === "1",
      data.hoy,
    ),
  );
  const lineas: Linea[] = filas.flatMap((f) => f.servicios.map((s) => ({ c: f.c, s })));
  const xlsx = buildXlsx([
    hoja("Seguimiento", lineas, [
      { header: "Cliente", value: (r) => r.c.cliente_label, width: 34 },
      { header: "Categoría", value: (r) => r.c.categoria ?? "", width: 16 },
      { header: "Plan", value: (r) => planDe(r.s), width: 22 },
      { header: "Monto mensual", value: (r) => (r.s.monto_mensual != null ? Number(r.s.monto_mensual) : ""), width: 14 },
      { header: "Total adeudado", value: (r) => Number(r.s.total_adeudado), width: 15 },
      { header: "Cuotas vencidas", value: (r) => r.s.cuotas_vencidas, width: 10 },
      { header: "Tramo", value: (r) => TRAMO_LABEL[r.s.tramo], width: 11 },
      { header: "Meses adeudados", value: (r) => r.s.meses_adeudados.map(mesCorto).join(", "), width: 26 },
      { header: "Próx. venc.", value: (r) => fechaDia(r.s.proximo_vencimiento), width: 12 },
      { header: "Mensaje del mes", value: (r) => (r.c.mensaje_mes_fecha ? "Sí" : "No"), width: 10 },
      { header: "Fecha mensaje", value: (r) => fechaDia(r.c.mensaje_mes_fecha), width: 12 },
      { header: "Último pago", value: (r) => fechaDia(r.c.ultimo_pago), width: 12 },
      { header: "Promesa", value: (r) => fechaDia(r.c.promesa_fecha), width: 12 },
      { header: "Teléfono", value: (r) => r.c.telefono ?? "", width: 15 },
    ]),
  ]);
  return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders(`seguimiento-cobranzas-${hoyPY()}`) });
});
