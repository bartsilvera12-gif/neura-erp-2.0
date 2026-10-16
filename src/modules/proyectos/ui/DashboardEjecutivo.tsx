"use client";

/**
 * Dashboard Ejecutivo (/proyectos?vista=ejecutivo, solo ADMIN) — portado del sistema actual,
 * núcleo genérico y SIN gráficos (KPIs, tablas y barras simples): período, KPIs de la
 * cartera y del período, proyectos por estado (cantidad, SLA vencido, horas promedio
 * contra el objetivo), por técnico, por PM y la lista de los que requieren atención.
 * Clic en un KPI de riesgo, un estado, un técnico o un PM filtra esa lista; clic en un
 * proyecto abre el detalle. Exporta todo a CSV. Todos los números salen de la base
 * (proyectos_dashboard_ejecutivo): acá no se recalcula nada.
 */
import { TablaScroll } from "@/components/TablaResponsive";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlarmClock, CalendarCheck, CalendarClock, CalendarX2, Clock, Download, FolderKanban, Hourglass, Inbox, Lock,
  PackageCheck, PauseCircle, Timer, TrendingUp, Wallet,
} from "lucide-react";
import { Select } from "@/components/Select";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { hoyPY } from "@/lib/fecha/paraguay";
import {
  fechaCorta, monto, motivosAtencion, nombreCorto,
  type EjecutivoResp, type Metrica, type ProyectoConfig,
} from "@/modules/proyectos/tipos";
import {
  Barra, Card, CardTitle, CeldaProyecto, Cargando, ErrorCaja, EstadoPill, Girando, Kpi, SemaforoBadge,
  TABLA_TD, TABLA_TH, fmtHoras, persona,
} from "./tableros";
import { SelectorFecha } from "@/components/SelectorFecha";

type Aviso = (a: { texto: string; tipo?: "error" }) => void;

// ── Período ──────────────────────────────────────────────────────────────────
type Preset = "mes" | "mes_anterior" | "30" | "anio" | "personalizado";
const PRESETS: [Preset, string][] = [["mes", "Este mes"], ["mes_anterior", "Mes anterior"], ["30", "Últimos 30 días"], ["anio", "Este año"], ["personalizado", "Personalizado"]];

const iso = (d: Date) => d.toISOString().slice(0, 10);
function rango(p: Preset): { desde: string; hasta: string } | null {
  const hoy = hoyPY();
  const [y, m] = hoy.split("-").map(Number);
  if (p === "mes") return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
  if (p === "mes_anterior") {
    const ini = new Date(Date.UTC(y, m - 2, 1));
    const fin = new Date(Date.UTC(y, m - 1, 0));
    return { desde: iso(ini), hasta: iso(fin) };
  }
  if (p === "30") return { desde: iso(new Date(Date.parse(`${hoy}T00:00:00Z`) - 29 * 86_400_000)), hasta: hoy };
  if (p === "anio") return { desde: `${y}-01-01`, hasta: hoy };
  return null;
}

// ── Selección (filtra la lista de atención) ─────────────────────────────────
type Sel =
  | { kind: "motivo"; codigo: "vencido" | "sla_rojo" | "bloqueado" | "sin_movimiento" }
  | { kind: "estado"; id: string }
  | { kind: "tecnico"; id: string | null }
  | { kind: "pm"; id: string | null }
  | null;
const mismaSel = (a: Sel, b: Sel) => JSON.stringify(a) === JSON.stringify(b);

const MOTIVO_LABEL = { vencido: "Vencidos", sla_rojo: "SLA vencido", bloqueado: "Bloqueados", sin_movimiento: "Sin movimiento" } as const;

const pctTxt = (a: number, b: number) => (b > 0 ? `${Math.round((100 * a) / b)}%` : "—");

export function DashboardEjecutivo({ config, version, onAbrir, avisar }: {
  config: ProyectoConfig; version: number; onAbrir: (id: string) => void; avisar: Aviso;
}) {
  const [preset, setPreset] = useState<Preset>("mes");
  const [desde, setDesde] = useState(() => rango("mes")!.desde);
  const [hasta, setHasta] = useState(() => rango("mes")!.hasta);
  const [data, setData] = useState<EjecutivoResp | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);
  const [sel, setSel] = useState<Sel>(null);
  const toggleSel = (s: Sel) => setSel((p) => (mismaSel(p, s) ? null : s));

  const qs = useMemo(() => {
    const sp = new URLSearchParams();
    if (desde) sp.set("desde", desde);
    if (hasta) sp.set("hasta", hasta);
    return sp.toString();
  }, [desde, hasta]);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setData(await apiFetch<EjecutivoResp>(`/api/proyectos/dashboard/ejecutivo?${qs}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, [qs]);
  useEffect(() => { void cargar(); }, [cargar, version]);

  const elegirPreset = (p: string) => {
    setPreset(p as Preset);
    const r = rango(p as Preset);
    if (r) { setDesde(r.desde); setHasta(r.hasta); }
  };

  async function exportar() {
    setExportando(true);
    try {
      await descargarArchivo(`/api/proyectos/dashboard/ejecutivo?${qs}&formato=csv`, `dashboard-ejecutivo_${desde}_${hasta}.csv`);
    } catch (e) {
      avisar({ texto: `No se pudo exportar: ${(e as Error).message}`, tipo: "error" });
    } finally {
      setExportando(false);
    }
  }

  const filas = useMemo<Metrica[]>(() => {
    const a = data?.atencion ?? [];
    if (!sel) return a;
    if (sel.kind === "motivo") return a.filter((m) => motivosAtencion(m).some((x) => x.codigo === sel.codigo));
    if (sel.kind === "estado") return a.filter((m) => m.estado_id === sel.id);
    if (sel.kind === "tecnico") return a.filter((m) => m.responsable_tecnico_id === sel.id);
    return a.filter((m) => m.project_manager_id === sel.id);
  }, [data, sel]);

  const tituloLista = !sel ? "Requieren atención"
    : sel.kind === "motivo" ? `Requieren atención · ${MOTIVO_LABEL[sel.codigo]}`
    : sel.kind === "estado" ? `Requieren atención · ${data?.por_estado.find((e) => e.estado_id === sel.id)?.nombre ?? "estado"}`
    : sel.kind === "tecnico" ? `Requieren atención · ${persona(data?.por_tecnico.find((t) => t.id === sel.id)?.nombre) ?? "Sin técnico"}`
    : `Requieren atención · ${persona(data?.por_pm.find((t) => t.id === sel.id)?.nombre) ?? "Sin PM"}`;

  const k = data?.kpis;
  const maxTec = Math.max(1, ...(data?.por_tecnico ?? []).map((t) => t.activos + t.en_espera));
  const maxPm = Math.max(1, ...(data?.por_pm ?? []).map((t) => t.activos));
  const fila = "cursor-pointer border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50/70";
  const filaSel = "bg-[var(--brand-50)]/70";

  return (
    <div className="space-y-3">
      {/* Período */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <Select value={preset} onChange={elegirPreset} minWidth={170} options={PRESETS} />
        <div className="flex items-center gap-1.5 max-sm:grid max-sm:w-full max-sm:grid-cols-[auto_minmax(0,1fr)]">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Desde</span>
          <SelectorFecha compacto etiqueta="Desde" value={desde} max={hasta || undefined} onChange={(v) => { setPreset("personalizado"); setDesde(v); }}
            claseBoton="rounded-xl px-3 py-2 text-slate-900" className="w-[140px] max-sm:w-full max-sm:min-w-0" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Hasta</span>
          <SelectorFecha compacto etiqueta="Hasta" value={hasta} min={desde || undefined} onChange={(v) => { setPreset("personalizado"); setHasta(v); }}
            claseBoton="rounded-xl px-3 py-2 text-slate-900" className="w-[140px] max-sm:w-full max-sm:min-w-0" />
        </div>
        <Girando activo={cargando && !!data} />
        <span className="hidden text-[11px] text-slate-400 lg:inline">La cartera es la de hoy; ingresos, entregas y tiempos por estado son del período.</span>
        <button type="button" onClick={() => void exportar()} disabled={exportando || !data}
          className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold max-sm:min-h-11 max-sm:w-full max-sm:justify-center text-slate-600 shadow-sm transition-colors hover:border-[var(--brand)]/60 hover:text-[var(--brand)] disabled:opacity-50">
          <Download className="h-3.5 w-3.5" /> {exportando ? "Exportando…" : "Exportar CSV"}
        </button>
      </div>

      {error ? <ErrorCaja error={error} onReintentar={() => void cargar()} /> : null}

      {!data || !k ? (cargando ? <Cargando n={12} /> : null) : (
        <div className={`space-y-3 transition-opacity ${cargando ? "opacity-60" : ""}`}>
          {/* KPIs — cartera de hoy */}
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Cartera abierta hoy</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 2xl:grid-cols-8">
            <Kpi icon={FolderKanban} tono="teal" label="Activos" valor={k.activos} pie={`${k.en_curso} en curso`} />
            <Kpi icon={AlarmClock} tono="rojo" label="Vencidos" valor={k.vencidos} pie="fecha prometida pasada" pieTono={k.vencidos ? "malo" : undefined}
              onClick={() => toggleSel({ kind: "motivo", codigo: "vencido" })} activo={mismaSel(sel, { kind: "motivo", codigo: "vencido" })} />
            <Kpi icon={CalendarClock} tono="ambar" label="Vencen pronto" valor={k.vencen_pronto} pie={`próximos ${config.vence_pronto_dias} días`} />
            <Kpi icon={Timer} tono="rojo" label="SLA vencido" valor={k.sla_rojo} pie="pasados del objetivo del estado" pieTono={k.sla_rojo ? "malo" : undefined}
              onClick={() => toggleSel({ kind: "motivo", codigo: "sla_rojo" })} activo={mismaSel(sel, { kind: "motivo", codigo: "sla_rojo" })} />
            <Kpi icon={Lock} tono="gris" label="Bloqueados" valor={k.bloqueados} pie="con motivo cargado"
              onClick={() => toggleSel({ kind: "motivo", codigo: "bloqueado" })} activo={mismaSel(sel, { kind: "motivo", codigo: "bloqueado" })} />
            <Kpi icon={Hourglass} tono="naranja" label="Sin movimiento" valor={k.sin_movimiento} pie={`+${config.sin_movimiento_horas} h laborales`}
              onClick={() => toggleSel({ kind: "motivo", codigo: "sin_movimiento" })} activo={mismaSel(sel, { kind: "motivo", codigo: "sin_movimiento" })} />
            <Kpi icon={PauseCircle} tono="violeta" label="Esperando cliente" valor={k.esperando_cliente} pie={`${k.pausados} pausado${k.pausados === 1 ? "" : "s"}`} />
            <Kpi icon={CalendarX2} tono="ambar" label="Sin fecha" valor={k.sin_fecha} pie="prometida a definir" />
          </div>

          {/* KPIs — período */}
          <p className="pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            Período · {fechaCorta(data.periodo.desde)} al {fechaCorta(data.periodo.hasta)}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
            <Kpi icon={Inbox} tono="azul" label="Ingresados" valor={k.ingresados} pie="proyectos nuevos" />
            <Kpi icon={PackageCheck} tono="verde" label="Entregados" valor={k.entregados} pie="cierres del período" />
            <Kpi icon={CalendarCheck} tono="verde" label="Entregados a tiempo" valor={pctTxt(k.entregados_a_tiempo, k.entregados_con_fecha)}
              pie={k.entregados_con_fecha ? `${k.entregados_a_tiempo} de ${k.entregados_con_fecha} con fecha` : "sin entregas con fecha"}
              pieTono={k.entregados_con_fecha ? (k.entregados_a_tiempo / k.entregados_con_fecha >= 0.8 ? "bueno" : "malo") : undefined} />
            <Kpi icon={Clock} tono="teal" label="Días promedio de entrega" valor={k.dias_promedio_entrega == null ? "—" : k.dias_promedio_entrega.toLocaleString("es-PY")} pie="desde la creación" />
            <Kpi icon={Wallet} tono="verde" label="Monto entregado" valor={<span className="text-[20px]">{monto(k.monto_entregado_gs)}</span>} pie="solo en guaraníes" />
            <Kpi icon={TrendingUp} tono="azul" label="Monto ingresado" valor={<span className="text-[20px]">{monto(k.monto_ingresado_gs)}</span>} pie="solo en guaraníes" />
          </div>

          {/* Proyectos por estado */}
          <Card>
            <CardTitle sub="Cantidad hoy, cuántos pasaron el objetivo del estado y las horas laborales promedio (hoy y de los que salieron en el período). Clic filtra la lista de atención.">
              Proyectos por estado
            </CardTitle>
            {data.por_estado.length === 0 ? <p className="text-sm text-slate-400">Sin estados abiertos.</p> : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {data.por_estado.map((e) => {
                  const activo = mismaSel(sel, { kind: "estado", id: e.estado_id });
                  const obj = e.tipo_sla === "interno" && e.objetivo ? e.objetivo : null;
                  const prom = e.horas_promedio_actual;
                  return (
                    <button key={e.estado_id} type="button" onClick={() => toggleSel({ kind: "estado", id: e.estado_id })} aria-pressed={activo}
                      className={`rounded-xl border bg-white p-3 text-left transition-shadow hover:shadow-md ${activo ? "border-transparent ring-2 ring-[var(--brand)] ring-offset-1" : "border-slate-200"}`}
                      style={{ borderTopColor: activo ? undefined : e.color, borderTopWidth: activo ? undefined : 3 }}>
                      <div className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: e.color }} />
                        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-600" title={e.nombre}>{e.nombre}</span>
                      </div>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-[24px] font-bold leading-none tabular-nums text-slate-800">{e.cantidad}</span>
                        {e.rojos ? <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">{e.rojos} SLA vencido</span> : null}
                      </div>
                      {obj ? (
                        <div className="mt-2 space-y-1">
                          <Barra valor={prom ?? 0} max={Math.max(obj * 1.25, prom ?? 0)} marca={obj}
                            clase={prom != null && prom > obj ? "bg-rose-400" : prom != null && prom >= 0.7 * obj ? "bg-amber-400" : "bg-emerald-400"} />
                          <div className="text-[10px] text-slate-500">prom. hoy <strong className="tabular-nums text-slate-700">{fmtHoras(prom)}</strong> · objetivo {fmtHoras(obj)}</div>
                        </div>
                      ) : (
                        <div className="mt-2 text-[10px] text-slate-400">{e.tipo_sla === "interno" ? "sin objetivo" : "no cuenta SLA"} · prom. hoy {fmtHoras(prom)}</div>
                      )}
                      <div className="mt-0.5 text-[10px] text-slate-400">
                        {e.pasaron_periodo ? <>período: {fmtHoras(e.horas_promedio_periodo)} prom. · {e.pasaron_periodo} pasaron</> : "nadie salió en el período"}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Por técnico · Por PM */}
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <Card>
              <CardTitle sub={`Cartera abierta de cada técnico y sus entregas del período. WIP recomendado: ${config.wip_por_tecnico}.`}>Por técnico</CardTitle>
              {data.por_tecnico.length === 0 ? <p className="text-sm text-slate-400">Sin proyectos abiertos con técnico.</p> : (
                <TablaScroll primeraFija>
                  <table className="w-full min-w-[560px] text-left">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className={TABLA_TH}>Técnico</th>
                        <th className={`${TABLA_TH} w-[28%]`}>Activos</th>
                        <th className={`${TABLA_TH} text-right`}>En espera</th>
                        <th className={`${TABLA_TH} text-right`}>Vencidos</th>
                        <th className={`${TABLA_TH} text-right`}>SLA venc.</th>
                        <th className={`${TABLA_TH} text-right`}>Entregados</th>
                        <th className={`${TABLA_TH} text-right`}>A tiempo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.por_tecnico.map((t) => {
                        const s: Sel = { kind: "tecnico", id: t.id };
                        const sobre = t.activos > config.wip_por_tecnico;
                        return (
                          <tr key={t.id ?? "sin"} className={`${fila} ${mismaSel(sel, s) ? filaSel : ""}`} onClick={() => toggleSel(s)}>
                            <td className={`${TABLA_TD} max-w-[160px] truncate font-medium ${t.id ? "text-slate-700" : "italic text-slate-400"}`} title={t.nombre}>{t.id ? nombreCorto(t.nombre) : "Sin técnico"}</td>
                            <td className={TABLA_TD}>
                              <div className="flex items-center gap-2">
                                <span className={`w-6 text-right font-semibold tabular-nums ${sobre ? "text-rose-600" : "text-slate-700"}`}>{t.activos}</span>
                                <div className="flex-1"><Barra valor={t.activos} max={maxTec} marca={t.id ? config.wip_por_tecnico : undefined} clase={sobre ? "bg-rose-400" : "bg-[var(--brand)]"} /></div>
                              </div>
                            </td>
                            <td className={`${TABLA_TD} text-right tabular-nums text-slate-500`}>{t.en_espera}</td>
                            <td className={`${TABLA_TD} text-right font-semibold tabular-nums ${t.vencidos ? "text-rose-600" : "text-slate-400"}`}>{t.vencidos}</td>
                            <td className={`${TABLA_TD} text-right font-semibold tabular-nums ${t.sla_rojo ? "text-rose-600" : "text-slate-400"}`}>{t.sla_rojo}</td>
                            <td className={`${TABLA_TD} text-right tabular-nums text-emerald-600`}>{t.entregados}</td>
                            <td className={`${TABLA_TD} pr-0 text-right tabular-nums text-slate-600`}>{t.entregados ? pctTxt(t.a_tiempo, t.entregados) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TablaScroll>
              )}
            </Card>

            <Card>
              <CardTitle sub="Cartera abierta de cada Project Manager y sus entregas del período.">Por PM</CardTitle>
              {data.por_pm.length === 0 ? <p className="text-sm text-slate-400">Sin proyectos abiertos.</p> : (
                <TablaScroll primeraFija>
                  <table className="w-full min-w-[520px] text-left">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className={TABLA_TH}>PM</th>
                        <th className={`${TABLA_TH} w-[30%]`}>Activos</th>
                        <th className={`${TABLA_TH} text-right`}>Vencidos</th>
                        <th className={`${TABLA_TH} text-right`}>Bloqueados</th>
                        <th className={`${TABLA_TH} text-right`}>Esp. cliente</th>
                        <th className={`${TABLA_TH} text-right`}>Entregados</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.por_pm.map((t) => {
                        const s: Sel = { kind: "pm", id: t.id };
                        return (
                          <tr key={t.id ?? "sin"} className={`${fila} ${mismaSel(sel, s) ? filaSel : ""}`} onClick={() => toggleSel(s)}>
                            <td className={`${TABLA_TD} max-w-[160px] truncate font-medium ${t.id ? "text-slate-700" : "italic text-slate-400"}`} title={t.nombre}>{t.id ? nombreCorto(t.nombre) : "Sin PM"}</td>
                            <td className={TABLA_TD}>
                              <div className="flex items-center gap-2">
                                <span className="w-6 text-right font-semibold tabular-nums text-slate-700">{t.activos}</span>
                                <div className="flex-1"><Barra valor={t.activos} max={maxPm} clase="bg-violet-400" /></div>
                              </div>
                            </td>
                            <td className={`${TABLA_TD} text-right font-semibold tabular-nums ${t.vencidos ? "text-rose-600" : "text-slate-400"}`}>{t.vencidos}</td>
                            <td className={`${TABLA_TD} text-right tabular-nums ${t.bloqueados ? "font-semibold text-slate-700" : "text-slate-400"}`}>{t.bloqueados}</td>
                            <td className={`${TABLA_TD} text-right tabular-nums text-slate-500`}>{t.esperando_cliente}</td>
                            <td className={`${TABLA_TD} pr-0 text-right tabular-nums text-emerald-600`}>{t.entregados}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TablaScroll>
              )}
            </Card>
          </div>

          {/* Atención */}
          <Card>
            <CardTitle
              sub="Vencidos, con el SLA del estado vencido, bloqueados o sin movimiento (hasta 50)."
              right={sel ? <button type="button" onClick={() => setSel(null)} className="whitespace-nowrap text-[11px] font-medium text-[var(--brand)] hover:underline">← Ver todos</button> : null}
            >
              <span className="flex items-center gap-1.5">
                {tituloLista}
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">{filas.length}</span>
              </span>
            </CardTitle>
            {filas.length === 0 ? (
              <p className="text-sm text-slate-400">{sel ? "Nada que atender en esta selección." : "Nada que atender: ningún proyecto vencido, trabado ni sin movimiento."}</p>
            ) : (
              <TablaAtencion filas={filas} onAbrir={onAbrir} />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

/** Tabla de proyectos con motivo (la usa también el Dashboard PM). */
export function TablaAtencion({ filas, onAbrir, columnaExtra }: {
  filas: Metrica[]; onAbrir: (id: string) => void;
  columnaExtra?: { titulo: string; celda: (m: Metrica) => React.ReactNode };
}) {
  return (
    <TablaScroll primeraFija>
      <table className="w-full min-w-[900px] text-left">
        <thead>
          <tr className="border-b border-slate-100">
            <th className={TABLA_TH}>Proyecto</th>
            <th className={TABLA_TH}>Estado</th>
            <th className={TABLA_TH}>Motivo</th>
            <th className={TABLA_TH}>Técnico</th>
            <th className={TABLA_TH}>PM</th>
            <th className={TABLA_TH}>En el estado</th>
            <th className={TABLA_TH}>Prometida</th>
            {columnaExtra ? <th className={TABLA_TH}>{columnaExtra.titulo}</th> : null}
          </tr>
        </thead>
        <tbody>
          {filas.map((m) => (
            <tr key={m.id} className="border-b border-slate-50 align-top last:border-0">
              <td className={`${TABLA_TD} max-w-[260px]`}><CeldaProyecto m={m} onAbrir={onAbrir} /></td>
              <td className={TABLA_TD}><EstadoPill nombre={m.estado_nombre} color={m.estado_color} /></td>
              <td className={TABLA_TD}>
                <div className="flex flex-wrap gap-1">
                  {motivosAtencion(m).map((x) => <span key={x.codigo} className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${x.tono}`}>{x.texto}</span>)}
                </div>
              </td>
              <td className={`${TABLA_TD} max-w-[120px] truncate text-slate-500`}>{persona(m.tecnico_nombre) ?? <span className="text-slate-300">—</span>}</td>
              <td className={`${TABLA_TD} max-w-[120px] truncate text-slate-500`}>{persona(m.pm_nombre) ?? <span className="text-slate-300">—</span>}</td>
              <td className={TABLA_TD}><SemaforoBadge horas={m.horas_en_estado} objetivo={m.sla_horas_objetivo} semaforo={m.semaforo} pct={m.sla_pct} /></td>
              <td className={`${TABLA_TD} whitespace-nowrap tabular-nums ${m.vencido ? "font-semibold text-rose-600" : m.vence_pronto ? "font-semibold text-amber-600" : "text-slate-500"}`}>
                {m.fecha_prometida ? fechaCorta(m.fecha_prometida) : <span className="text-amber-600">A definir</span>}
              </td>
              {columnaExtra ? <td className={`${TABLA_TD} max-w-[220px] text-slate-500`}>{columnaExtra.celda(m)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </TablaScroll>
  );
}
