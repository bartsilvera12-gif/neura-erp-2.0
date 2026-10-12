/**
 * Dashboard Ejecutivo de Proyectos (solo ADMIN) en UNA consulta (proyectos_dashboard_ejecutivo).
 *   GET /api/proyectos/dashboard/ejecutivo?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 *     → { periodo, kpis, por_estado, por_tecnico, por_pm, atencion }
 *     Sin fechas: del 1° del mes en curso a hoy (hora de Paraguay).
 *   GET …&formato=csv → el mismo tablero en CSV (separador ";", UTF-8 con BOM para Excel).
 */
import { NextResponse } from "next/server";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { errorProy, normalizarMetricas, numeros } from "@/modules/proyectos/server";
import {
  PRIORIDAD_LABEL, fechaCorta, motivosAtencion,
  type EjecutivoResp, type EstadoEjecutivo, type KpisEjecutivo, type PmEjecutivo, type TecnicoEjecutivo,
} from "@/modules/proyectos/tipos";

export const dynamic = "force-dynamic";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fecha = (v: string | null) => (v && FECHA.test(v) && Number.isFinite(Date.parse(v)) ? v : null);

// ── CSV ──────────────────────────────────────────────────────────────────────
function celda(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "number" ? v.toLocaleString("es-PY", { maximumFractionDigits: 1, useGrouping: false }) : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const fila = (vs: unknown[]) => vs.map(celda).join(";");

function aCsv(d: EjecutivoResp): string {
  const k = d.kpis;
  const pctATiempo = k.entregados_con_fecha ? Math.round((100 * k.entregados_a_tiempo) / k.entregados_con_fecha) : null;
  const l: string[] = [
    fila(["Dashboard Ejecutivo de Proyectos"]),
    fila(["Período", `${fechaCorta(d.periodo.desde)} al ${fechaCorta(d.periodo.hasta)}`]),
    "",
    fila(["Indicador", "Valor"]),
    ...([
      ["Activos", k.activos], ["En curso", k.en_curso], ["Esperando cliente", k.esperando_cliente], ["Pausados", k.pausados],
      ["Vencidos", k.vencidos], ["Vencen pronto", k.vencen_pronto], ["Sin fecha prometida", k.sin_fecha], ["Bloqueados", k.bloqueados],
      ["Sin movimiento", k.sin_movimiento], ["SLA vencido", k.sla_rojo], ["Ingresados en el período", k.ingresados],
      ["Entregados en el período", k.entregados], ["Entregados a tiempo", k.entregados_a_tiempo], ["Entregados con fecha prometida", k.entregados_con_fecha],
      ["% a tiempo", pctATiempo], ["Monto entregado (Gs.)", k.monto_entregado_gs], ["Monto ingresado (Gs.)", k.monto_ingresado_gs],
      ["Días promedio de entrega", k.dias_promedio_entrega],
    ] as [string, unknown][]).map((r) => fila(r)),
    "",
    fila(["Proyectos por estado"]),
    fila(["Estado", "Cantidad", "SLA vencido", "Objetivo (h)", "Horas promedio actual", "Horas promedio en el período", "Pasaron en el período"]),
    ...d.por_estado.map((e) => fila([e.nombre, e.cantidad, e.rojos, e.objetivo, e.horas_promedio_actual, e.horas_promedio_periodo, e.pasaron_periodo])),
    "",
    fila(["Por técnico"]),
    fila(["Técnico", "Activos", "En espera", "Vencidos", "SLA vencido", "Entregados", "A tiempo"]),
    ...d.por_tecnico.map((t) => fila([t.nombre, t.activos, t.en_espera, t.vencidos, t.sla_rojo, t.entregados, t.a_tiempo])),
    "",
    fila(["Por PM"]),
    fila(["PM", "Activos", "Vencidos", "Bloqueados", "Esperando cliente", "Entregados"]),
    ...d.por_pm.map((p) => fila([p.nombre, p.activos, p.vencidos, p.bloqueados, p.esperando_cliente, p.entregados])),
    "",
    fila(["Requieren atención"]),
    fila(["Número", "Proyecto", "Cliente", "Estado", "Prioridad", "Motivo", "Técnico", "PM", "Horas en el estado", "% SLA", "Fecha prometida"]),
    ...d.atencion.map((m) => fila([
      m.numero, m.titulo, m.cliente_nombre, m.estado_nombre, PRIORIDAD_LABEL[m.prioridad] ?? m.prioridad,
      motivosAtencion(m).map((x) => x.texto).join(", "), m.tecnico_nombre, m.pm_nombre,
      Math.round(m.horas_en_estado * 10) / 10, m.sla_pct, m.fecha_prometida ? fechaCorta(m.fecha_prometida) : "",
    ])),
  ];
  return `﻿${l.join("\r\n")}\r\n`;
}

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    let desde = fecha(sp.get("desde"));
    let hasta = fecha(sp.get("hasta"));
    if (desde && hasta && desde > hasta) [desde, hasta] = [hasta, desde];
    const r = await ctx.db.rpc<Record<string, unknown>>("proyectos_dashboard_ejecutivo", { p_desde: desde, p_hasta: hasta });
    if (r.error) return errorProy(r.error, "No se pudo cargar el dashboard");
    if (!r.data) return ERR.server();
    const d = r.data;
    const resp: EjecutivoResp = {
      periodo: d.periodo as EjecutivoResp["periodo"],
      kpis: numeros<KpisEjecutivo>(d.kpis, ["dias_promedio_entrega"]),
      por_estado: ((d.por_estado ?? []) as unknown[]).map((e) => numeros<EstadoEjecutivo>(e, ["objetivo", "horas_promedio_actual", "horas_promedio_periodo"])),
      por_tecnico: ((d.por_tecnico ?? []) as unknown[]).map((t) => numeros<TecnicoEjecutivo>(t)),
      por_pm: ((d.por_pm ?? []) as unknown[]).map((p) => numeros<PmEjecutivo>(p)),
      atencion: normalizarMetricas(d.atencion),
    };
    if (sp.get("formato") === "csv") {
      const nombre = `dashboard-ejecutivo_${resp.periodo.desde}_${resp.periodo.hasta}.csv`;
      return new NextResponse(aCsv(resp), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${nombre}"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return ok(resp);
  },
  { roles: ["ADMIN"] },
);
