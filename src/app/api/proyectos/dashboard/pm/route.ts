/**
 * Dashboard PM: la cartera de un Project Manager agrupada por situación, en UNA consulta
 * (proyectos_dashboard_pm).
 *   GET /api/proyectos/dashboard/pm[?pm=<uuid>]
 *     → { pm, kpis, vencidos, vencen_pronto, bloqueados, esperando_cliente, sin_movimiento, sin_fecha, todos, pms }
 *   · ADMIN: elige el PM con ?pm= (sin ?pm=: el suyo si es PM de algo, si no el primero con
 *     cartera). `pms` = los PM con proyectos sin archivar, para el selector.
 *   · El resto: siempre SU cartera (?pm= se ignora); `pms` va vacío.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { errorProy, esUuid, nombresUsuarios, normalizarMetricas, numeros } from "@/modules/proyectos/server";
import { SECCIONES_PM, nombreCorto, type KpisPm, type PmResp } from "@/modules/proyectos/tipos";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const esAdmin = ctx.rol === "ADMIN";
  let pm = ctx.usuarioId;
  let pms: PmResp["pms"] = [];

  if (esAdmin) {
    const { data, error } = await ctx.db
      .select("proyectos", "project_manager_id")
      .eq("archivado", false)
      .not("project_manager_id", "is", null)
      .limit(10_000);
    if (error) return ERR.server();
    const ids = [...new Set(((data ?? []) as unknown as { project_manager_id: string }[]).map((r) => r.project_manager_id))];
    const nombres = await nombresUsuarios(ctx, ids);
    pms = ids
      .map((id) => ({ id, nombre: nombres.get(id) ?? "Usuario" }))
      .sort((a, b) => nombreCorto(a.nombre).localeCompare(nombreCorto(b.nombre), "es"));
    const pedido = new URL(req.url).searchParams.get("pm");
    if (esUuid(pedido)) pm = pedido;
    else if (!pms.some((p) => p.id === ctx.usuarioId) && pms.length) pm = pms[0].id;
  }

  const r = await ctx.db.rpc<Record<string, unknown>>("proyectos_dashboard_pm", { p_pm: pm });
  if (r.error) return errorProy(r.error, "No se pudo cargar el dashboard");
  if (!r.data) return ERR.server();
  const d = r.data;
  const resp = {
    pm: (d.pm as PmResp["pm"]) ?? null,
    kpis: numeros<KpisPm>(d.kpis),
    todos: normalizarMetricas(d.todos),
    pms,
    ...Object.fromEntries(SECCIONES_PM.map((s) => [s, normalizarMetricas(d[s])])),
  } as PmResp;
  return ok(resp);
});
