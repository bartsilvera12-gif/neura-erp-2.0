"use client";

/**
 * Dashboard PM (/proyectos?vista=pm) — portado del sistema actual, núcleo genérico y sin
 * gráficos: la cartera de un Project Manager agrupada por situación (vencidos, vencen
 * pronto, bloqueados, esperando al cliente, sin movimiento, sin fecha prometida), con sus
 * KPIs. El PM ve la suya; un ADMIN elige de quién. Clic en un KPI baja a su grupo; clic
 * en un proyecto abre el detalle. Todo sale de proyectos_dashboard_pm (una consulta).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClock, CalendarClock, CalendarX2, CheckCircle2, ChevronDown, FolderKanban, Hourglass, Lock, PauseCircle, RefreshCw, Timer, Trophy,
} from "lucide-react";
import { Select } from "@/components/Select";
import { apiFetch } from "@/lib/api/client-fetch";
import {
  BLOQUEO_TIPO_LABEL, SECCIONES_PM, fechaCorta, haceCuanto, nombreCorto,
  type Metrica, type PmResp, type ProyectoConfig, type SeccionPm,
} from "@/modules/proyectos/tipos";
import { Card, CardTitle, Cargando, ErrorCaja, Kpi, persona, type Tono } from "./tableros";
import { TablaAtencion } from "./DashboardEjecutivo";
import { useAhora } from "./reloj";

const DIA = 86_400_000;

function Dias({ fecha, signo }: { fecha: string | null; signo: "atraso" | "faltan" }) {
  const ahora = useAhora() || Date.now();
  if (!fecha) return <>—</>;
  const d = Math.max(0, Math.ceil(((signo === "atraso" ? ahora - Date.parse(fecha) : Date.parse(fecha) - ahora)) / DIA));
  return <span className={`font-semibold tabular-nums ${signo === "atraso" ? "text-rose-600" : "text-amber-600"}`}>{signo === "atraso" ? `${d} día${d === 1 ? "" : "s"} de atraso` : d === 0 ? "hoy" : `faltan ${d} día${d === 1 ? "" : "s"}`}</span>;
}

function Hace({ at }: { at: string }) {
  const ahora = useAhora();
  return <span className="tabular-nums">{ahora ? haceCuanto(at, ahora) : fechaCorta(at)}</span>;
}

export function DashboardPm({ esAdmin, config, version, onAbrir }: {
  esAdmin: boolean; config: ProyectoConfig; version: number; onAbrir: (id: string) => void;
}) {
  const [pm, setPm] = useState<string | null>(null);
  const [data, setData] = useState<PmResp | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actualizado, setActualizado] = useState<string | null>(null);
  const [verTodos, setVerTodos] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await apiFetch<PmResp>(`/api/proyectos/dashboard/pm${esAdmin && pm ? `?pm=${pm}` : ""}`);
      setData(r);
      setError(null);
      setActualizado(new Date().toLocaleTimeString("es-PY", { timeZone: "America/Asuncion", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, [esAdmin, pm]);
  useEffect(() => { void cargar(); }, [cargar, version]);

  // ── Grupos ──
  const SECC: Record<SeccionPm, { titulo: string; sub: string; icon: React.ComponentType<{ className?: string }>; tono: Tono; extra?: { titulo: string; celda: (m: Metrica) => React.ReactNode } }> = useMemo(() => ({
    vencidos: { titulo: "Vencidos", sub: "La fecha prometida ya pasó y el proyecto sigue abierto.", icon: AlarmClock, tono: "rojo",
      extra: { titulo: "Atraso", celda: (m) => <Dias fecha={m.fecha_prometida} signo="atraso" /> } },
    vencen_pronto: { titulo: "Vencen pronto", sub: `La fecha prometida cae en los próximos ${config.vence_pronto_dias} días.`, icon: CalendarClock, tono: "ambar",
      extra: { titulo: "Plazo", celda: (m) => <Dias fecha={m.fecha_prometida} signo="faltan" /> } },
    bloqueados: { titulo: "Bloqueados", sub: "Marcados como bloqueados: qué los traba y quién destraba.", icon: Lock, tono: "gris",
      extra: { titulo: "Motivo del bloqueo", celda: (m) => (
        <span className="block">
          {m.bloqueo_tipo ? <span className="mr-1 font-semibold text-slate-600">{BLOQUEO_TIPO_LABEL[m.bloqueo_tipo] ?? m.bloqueo_tipo}:</span> : null}
          <span className="line-clamp-2">{m.bloqueo_motivo || <span className="italic text-slate-400">sin motivo cargado</span>}</span>
        </span>
      ) } },
    esperando_cliente: { titulo: "Esperando al cliente", sub: "En un estado de espera del cliente (no cuenta SLA). Hay que destrabar del lado del cliente.", icon: PauseCircle, tono: "violeta",
      extra: { titulo: "Último movimiento", celda: (m) => <Hace at={m.ultimo_movimiento_at} /> } },
    sin_movimiento: { titulo: "Sin movimiento", sub: `Más de ${config.sin_movimiento_horas} h laborales sin actividad en un estado que cuenta SLA.`, icon: Hourglass, tono: "naranja",
      extra: { titulo: "Último movimiento", celda: (m) => <Hace at={m.ultimo_movimiento_at} /> } },
    sin_fecha: { titulo: "Sin fecha prometida", sub: "No pueden aparecer como vencidos aunque estén atrasados: cargales la fecha.", icon: CalendarX2, tono: "ambar",
      extra: { titulo: "Comercial", celda: (m) => persona(m.comercial_nombre) ?? <span className="text-slate-300">—</span> } },
  }), [config.vence_pronto_dias, config.sin_movimiento_horas]);

  const refs = useRef<Partial<Record<SeccionPm | "todos", HTMLDivElement | null>>>({});
  const ir = (s: SeccionPm | "todos") => {
    if (s === "todos") setVerTodos(true);
    requestAnimationFrame(() => refs.current[s]?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const k = data?.kpis;
  const conDatos = data ? SECCIONES_PM.filter((s) => data[s].length > 0) : [];
  const vacias = data ? SECCIONES_PM.filter((s) => data[s].length === 0) : [];
  const nombrePm = data?.pm?.nombre ? nombreCorto(data.pm.nombre) : null;
  const opcionesPm: [string, string][] = (data?.pms ?? []).map((p) => [p.id, nombreCorto(p.nombre)]);
  if (data?.pm && !opcionesPm.some(([id]) => id === data.pm!.id)) opcionesPm.unshift([data.pm.id, nombreCorto(data.pm.nombre)]);

  return (
    <div className="space-y-3">
      {/* Barra */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        {esAdmin && opcionesPm.length ? (
          <div className="flex items-center gap-2">
            <span className="pl-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Cartera de</span>
            <Select value={data?.pm?.id ?? ""} onChange={(v) => setPm(v)} minWidth={210} options={opcionesPm} />
          </div>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-600">
            Cartera de {nombrePm ?? "—"}
          </span>
        )}
        {data ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600">
            <CheckCircle2 className="h-3 w-3" /> {data.vencidos.length + data.vencen_pronto.length + data.bloqueados.length + data.sin_movimiento.length} para atender
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2 text-[11px] text-slate-400">
          {actualizado ? <span>Actualizado {actualizado}</span> : null}
          <button type="button" onClick={() => void cargar()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:border-[var(--brand)]/60 hover:text-[var(--brand)]">
            <RefreshCw className={`h-3.5 w-3.5 ${cargando ? "animate-spin" : ""}`} /> Actualizar
          </button>
        </div>
      </div>

      {error ? <ErrorCaja error={error} onReintentar={() => void cargar()} /> : null}

      {!data || !k ? (cargando ? <Cargando n={8} /> : null) : (
        <div className={`space-y-3 transition-opacity ${cargando ? "opacity-60" : ""}`}>
          {esAdmin && !data.pms.length ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-800">Ningún proyecto abierto tiene Project Manager asignado todavía.</p>
          ) : null}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi icon={FolderKanban} tono="teal" label="Activos" valor={k.activos} pie="ver toda la cartera" onClick={() => ir("todos")} />
            <Kpi icon={AlarmClock} tono="rojo" label="Vencidos" valor={k.vencidos} pie="fecha prometida pasada" pieTono={k.vencidos ? "malo" : undefined} onClick={k.vencidos ? () => ir("vencidos") : undefined} />
            <Kpi icon={CalendarClock} tono="ambar" label="Vencen pronto" valor={k.vencen_pronto} pie={`próximos ${config.vence_pronto_dias} días`} onClick={k.vencen_pronto ? () => ir("vencen_pronto") : undefined} />
            <Kpi icon={Lock} tono="gris" label="Bloqueados" valor={k.bloqueados} pie="con motivo cargado" onClick={k.bloqueados ? () => ir("bloqueados") : undefined} />
            <Kpi icon={PauseCircle} tono="violeta" label="Esperando cliente" valor={k.esperando_cliente} pie="no cuentan SLA" onClick={k.esperando_cliente ? () => ir("esperando_cliente") : undefined} />
            <Kpi icon={Hourglass} tono="naranja" label="Sin movimiento" valor={k.sin_movimiento} pie={`+${config.sin_movimiento_horas} h laborales`} onClick={k.sin_movimiento ? () => ir("sin_movimiento") : undefined} />
            <Kpi icon={CalendarX2} tono="ambar" label="Sin fecha" valor={k.sin_fecha} pie="prometida a definir" onClick={k.sin_fecha ? () => ir("sin_fecha") : undefined} />
            <Kpi icon={Timer} tono="rojo" label="SLA vencido" valor={k.sla_rojo} pie="pasados del objetivo del estado" pieTono={k.sla_rojo ? "malo" : undefined} />
            <Kpi icon={Trophy} tono="verde" label="Entregados del mes" valor={k.entregados_mes} pie="cierres del mes" pieTono={k.entregados_mes ? "bueno" : undefined} />
          </div>

          {k.activos === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
              <p className="text-sm font-medium text-slate-700">Sin proyectos abiertos en esta cartera</p>
              <p className="mt-1 text-xs text-slate-500">Los proyectos aparecen acá cuando se los asigna como Project Manager.</p>
            </div>
          ) : (
            <>
              {conDatos.map((s) => {
                const c = SECC[s];
                const filas = data[s];
                return (
                  <div key={s} ref={(el) => { refs.current[s] = el; }} className="scroll-mt-4">
                    <Card>
                      <CardTitle sub={c.sub}>
                        <span className="flex items-center gap-1.5">
                          {c.titulo}
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${s === "vencidos" ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-500"}`}>{filas.length}</span>
                        </span>
                      </CardTitle>
                      <TablaAtencion filas={filas} onAbrir={onAbrir} columnaExtra={c.extra} />
                    </Card>
                  </div>
                );
              })}

              {vacias.length ? (
                <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Al día:
                  {vacias.map((s) => <span key={s} className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">{SECC[s].titulo}</span>)}
                </p>
              ) : null}

              <div ref={(el) => { refs.current.todos = el; }} className="scroll-mt-4">
                <Card>
                  <button type="button" onClick={() => setVerTodos((v) => !v)} aria-expanded={verTodos} className="flex w-full items-center justify-between gap-2 text-left">
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-1 rounded-full bg-[var(--brand)]" />
                      <span className="text-[13px] font-semibold text-slate-800">Toda la cartera</span>
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">{data.todos.length}</span>
                    </span>
                    <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${verTodos ? "rotate-180" : ""}`} />
                  </button>
                  {verTodos ? (
                    <div className="mt-3">
                      <TablaAtencion filas={data.todos} onAbrir={onAbrir}
                        columnaExtra={{ titulo: "Último movimiento", celda: (m) => <Hace at={m.ultimo_movimiento_at} /> }} />
                    </div>
                  ) : null}
                </Card>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
