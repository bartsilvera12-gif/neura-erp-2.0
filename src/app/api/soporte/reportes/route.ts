/**
 * GET /api/soporte/reportes?desde&hasta&cliente_id&responsable_id&tipo&estado
 *
 * Reportes sobre los tickets CREADOS en el rango (días en hora de Paraguay):
 * conteos por dimensión, cumplimiento de SLA, SLA vencidos abiertos, tiempo
 * medio de resolución (horas laborales) y devoluciones de QA.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { calcularSla, etiquetaTipo, hoyPy, type TicketFila } from "@/modules/soporte/dominio";
import {
  accesoSoporte,
  clientesPorId,
  esUuid,
  falla,
  leerCatalogos,
  leerConfig,
  personasPorId,
  sinAccesoSoporte,
  ticketsParaAgregar,
} from "@/modules/soporte/server";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

type Conteo = { clave: string; nombre: string; cantidad: number };

function contar(lista: TicketFila[], clave: (t: TicketFila) => string, nombre: (k: string) => string): Conteo[] {
  const m = new Map<string, number>();
  for (const t of lista) {
    const k = clave(t);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([k, cantidad]) => ({ clave: k, nombre: nombre(k), cantidad })).sort((a, b) => b.cantidad - a.cantidad);
}

export const GET = withTenant(async (ctx, req) => {
  if (!(await accesoSoporte(ctx))) return sinAccesoSoporte();
  try {
    const p = new URL(req.url).searchParams;
    const hoy = hoyPy();
    const hace30 = new Date(Date.parse(`${hoy}T12:00:00-03:00`) - 30 * 86_400_000).toISOString().slice(0, 10);
    const desde = FECHA.test(p.get("desde") ?? "") ? (p.get("desde") as string) : hace30;
    const hasta = FECHA.test(p.get("hasta") ?? "") ? (p.get("hasta") as string) : hoy;
    if (desde > hasta) return falla("La fecha desde no puede ser posterior a hasta");

    const [cat, cfg] = await Promise.all([leerCatalogos(ctx), leerConfig(ctx)]);
    const tickets = await ticketsParaAgregar(ctx, (q) => {
      let b = q.gte("created_at", `${desde}T00:00:00-03:00`).lte("created_at", `${hasta}T23:59:59.999-03:00`);
      for (const [param, col] of [
        ["cliente_id", "cliente_id"],
        ["responsable_id", "responsable_id"],
        ["tipo", "tipo_codigo"],
        ["estado", "estado_codigo"],
      ] as const) {
        const v = p.get(param);
        if (!v) continue;
        if ((param === "cliente_id" || param === "responsable_id") && !esUuid(v)) continue;
        b = b.eq(col, v);
      }
      return b;
    });

    const ahora = new Date().toISOString();
    const [clientes, personas] = await Promise.all([
      clientesPorId(ctx, tickets.map((t) => t.cliente_id)),
      personasPorId(ctx, tickets.map((t) => t.responsable_id)),
    ]);

    // Por día si el rango es corto, por mes si es largo.
    const dias = (Date.parse(hasta) - Date.parse(desde)) / 86_400_000;
    const porPeriodo = contar(
      tickets,
      (t) => {
        const local = new Date(Date.parse(t.created_at) - 3 * 3_600_000).toISOString();
        return dias <= 62 ? local.slice(0, 10) : local.slice(0, 7);
      },
      (k) => (k.length === 10 ? `${k.slice(8, 10)}/${k.slice(5, 7)}` : `${k.slice(5, 7)}/${k.slice(0, 4)}`),
    ).sort((a, b) => a.clave.localeCompare(b.clave));

    let cumplidos = 0;
    let incumplidos = 0;
    let vencidos = 0;
    let enCurso = 0;
    const tiempos: number[] = [];
    for (const t of tickets) {
      const s = calcularSla(t, cfg, ahora);
      if (s.estado === "cumplido") cumplidos++;
      else if (s.estado === "incumplido") incumplidos++;
      else if (s.estado === "vencido") vencidos++;
      else if (s.estado === "en_tiempo" || s.estado === "en_riesgo") enCurso++;
      if (t.resuelto_at) tiempos.push(s.transcurridoMs);
    }
    const resueltosConSla = cumplidos + incumplidos;

    const ids = tickets.map((t) => t.id);
    const devoluciones = new Map<string, number>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await ctx.db.select("soporte_ticket_historial", "ticket_id").eq("tipo_evento", "devolucion_qa").in("ticket_id", ids.slice(i, i + 200));
      for (const r of (data ?? []) as unknown as { ticket_id: string }[]) devoluciones.set(r.ticket_id, (devoluciones.get(r.ticket_id) ?? 0) + 1);
    }
    const totalDev = [...devoluciones.values()].reduce((s, n) => s + n, 0);
    const masDevueltos = [...devoluciones.entries()]
      .map(([tid, n]) => {
        const t = tickets.find((x) => x.id === tid);
        return t ? { id: t.id, numero: t.numero, asunto: t.asunto, devoluciones: n } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
      .sort((a, b) => b.devoluciones - a.devoluciones)
      .slice(0, 10);

    return ok({
      desde,
      hasta,
      total: tickets.length,
      por_periodo: porPeriodo,
      por_cliente: contar(tickets, (t) => t.cliente_id ?? "", (k) => (k ? (clientes.get(k) ?? "Cliente") : "Sin cliente")).slice(0, 15),
      por_tipo: contar(tickets, (t) => etiquetaTipo(cat, t.tipo_codigo, t.clasificacion_codigo), (k) => k),
      por_prioridad: contar(tickets, (t) => t.prioridad_codigo, (k) => cat.prioridades.find((x) => x.codigo === k)?.nombre ?? k),
      por_responsable: contar(tickets, (t) => t.responsable_id ?? "", (k) => (k ? (personas.get(k)?.nombre ?? "Usuario") : "Sin responsable")),
      por_estado: contar(tickets, (t) => t.estado_codigo, (k) => cat.estados.find((x) => x.codigo === k)?.nombre ?? k),
      sla: {
        cumplidos,
        incumplidos,
        vencidos_abiertos: vencidos,
        en_curso: enCurso,
        porcentaje_cumplimiento: resueltosConSla ? Math.round((cumplidos / resueltosConSla) * 100) : null,
      },
      resolucion: {
        resueltos: tiempos.length,
        promedio_ms: tiempos.length ? Math.round(tiempos.reduce((s, n) => s + n, 0) / tiempos.length) : null,
      },
      devoluciones_qa: { total: totalDev, tickets_devueltos: devoluciones.size, mas_devueltos: masDevueltos },
    });
  } catch (e) {
    console.error("[soporte/reportes]", (e as Error)?.message);
    return falla("No se pudo armar el reporte", 500);
  }
});
