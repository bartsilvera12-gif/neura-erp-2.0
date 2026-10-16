"use client";

/**
 * Tareas del equipo (/proyectos?vista=equipo) — portado del sistema actual, núcleo genérico
 * (sin QA ni esqueleto): una tarjeta plegable por técnico con sus proyectos abiertos
 * agrupados por estado. Cada fila muestra prioridad, fecha prometida, alertas y las horas
 * LABORALES que lleva en el estado actual con el semáforo del SLA (verde / amarillo /
 * naranja / rojo), corriendo solas con el reloj compartido de 60 s (sin refetch). Los
 * datos se refrescan cada 60 s mientras la pestaña está visible. Indicador de WIP por
 * técnico (configurable), "Mover a" y reasignar técnico desde la fila; clic abre el detalle.
 */
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { AlarmClock, ChevronDown, Flame, Lock, RefreshCw, Search, Timer, UserX } from "lucide-react";
import { Select } from "@/components/Select";
import { BarraFiltros } from "@/components/EncabezadoPagina";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchCache } from "@/lib/api/cache-cliente";
import { filtrar } from "@/lib/busqueda";
import { msLaborables } from "@/modules/soporte/dominio";
import {
  PRIORIDADES, PRIORIDAD_LABEL, SEMAFORO_PUNTO, estiloPrioridad, fechaCorta, nombreCorto, pideMotivo, semaforoDe,
  type Estado, type EquipoResp, type HorarioLaboral, type Metrica, type UsuarioMin,
} from "@/modules/proyectos/tipos";
import { Avatar, MotivoModal, useUsuarios } from "./comun";
import { useAhora } from "./reloj";
import { ErrorCaja, Girando, SemaforoBadge, fmtHoras, useRefrescoVisible } from "./tableros";

type Aviso = (a: { texto: string; tipo?: "error" }) => void;

/** Horas en el estado, corriendo desde que la base las calculó (`generado_at`). */
function horasVivas(m: Metrica, generadoAt: string, horario: HorarioLaboral, ahora: number): number {
  if (!ahora) return m.horas_en_estado;
  const g = Date.parse(generadoAt);
  if (!(ahora > g)) return m.horas_en_estado;
  const extra = msLaborables(generadoAt, new Date(ahora).toISOString(), horario) ?? 0;
  return m.horas_en_estado + Math.max(0, extra) / 3_600_000;
}

/** Contador vivo (re-renderiza solo este componente cada minuto). */
function ContadorVivo({ m, generadoAt, horario }: { m: Metrica; generadoAt: string; horario: HorarioLaboral }) {
  const ahora = useAhora();
  const horas = horasVivas(m, generadoAt, horario, ahora);
  const { semaforo, pct } = semaforoDe(horas, m.tipo_sla, m.sla_horas_objetivo);
  return <SemaforoBadge horas={horas} objetivo={m.sla_horas_objetivo} semaforo={semaforo} pct={pct} />;
}

const esAlerta = (m: Metrica) => m.vencido || m.semaforo === "rojo" || m.bloqueado || m.sin_movimiento;

// ── Fila de proyecto ─────────────────────────────────────────────────────────
const FilaProyecto = memo(function FilaProyecto({
  m, generadoAt, horario, opcionesEstado, opcionesTecnico, puedeMover, puedeAsignar, guardando, onAbrir, onMover, onAsignar,
}: {
  m: Metrica;
  generadoAt: string;
  horario: HorarioLaboral;
  opcionesEstado: [string, string][];
  opcionesTecnico: [string, string][];
  puedeMover: boolean;
  puedeAsignar: boolean;
  guardando: boolean;
  onAbrir: (id: string) => void;
  onMover: (m: Metrica, estadoId: string) => void;
  onAsignar: (m: Metrica, tecnicoId: string) => void;
}) {
  const prio = estiloPrioridad(m.prioridad);
  return (
    <li className={`px-3 py-3 transition-colors hover:bg-slate-50/70 sm:px-4 ${guardando ? "pointer-events-none opacity-50" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${prio.punto}`} title={`Prioridad ${PRIORIDAD_LABEL[m.prioridad] ?? m.prioridad}`} />
        <div className="min-w-0 flex-1 basis-[13rem]">
          <button type="button" onClick={() => onAbrir(m.id)}
            className="block max-w-full truncate text-left text-[13.5px] font-semibold text-slate-800 transition-colors hover:text-[var(--brand-600)]" title={m.titulo}>
            {m.titulo}
          </button>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
            <span className="font-mono text-slate-400">{m.numero}</span>
            {m.cliente_nombre ? <span className="max-w-[16rem] truncate">{m.cliente_nombre}</span> : <span className="font-medium text-amber-600">sin cliente</span>}
            {m.fecha_prometida ? (
              <span className={m.vencido ? "font-semibold text-rose-600" : m.vence_pronto ? "font-semibold text-amber-600" : ""}>
                {m.vencido ? "venció" : "entrega"} {fechaCorta(m.fecha_prometida)}
              </span>
            ) : <span className="font-medium text-amber-600">sin fecha prometida</span>}
            {m.prioridad === "urgente" || m.prioridad === "alta" ? (
              <span className={`inline-flex items-center rounded-full border px-1.5 text-[10px] font-semibold ${prio.badge}`}>{PRIORIDAD_LABEL[m.prioridad]}</span>
            ) : null}
            {m.bloqueado ? (
              <span className="inline-flex items-center gap-0.5 font-semibold text-rose-600" title={m.bloqueo_motivo ?? undefined}><Lock className="h-2.5 w-2.5" /> bloqueado</span>
            ) : null}
            {m.sin_movimiento ? <span className="font-semibold text-orange-600">sin movimiento</span> : null}
            {m.tareas_total > 0 ? <span className="tabular-nums">tareas {m.tareas_hechas}/{m.tareas_total}</span> : null}
          </div>
        </div>
        <ContadorVivo m={m} generadoAt={generadoAt} horario={horario} />
        {puedeMover ? (
          <div className="w-[10.5rem] shrink-0 max-sm:min-w-[9rem] max-sm:flex-1" title="Mover a">
            <Select value={m.estado_id} onChange={(v) => onMover(m, v)} options={opcionesEstado} block etiqueta="Mover a" className="[&>button]:py-1.5 [&>button]:text-xs [@media(pointer:coarse)]:[&>button]:min-h-11" />
          </div>
        ) : null}
        {puedeAsignar ? (
          <div className="w-[9.5rem] shrink-0 max-sm:min-w-[9rem] max-sm:flex-1" title="Técnico responsable">
            <Select value={m.responsable_tecnico_id ?? ""} onChange={(v) => onAsignar(m, v)} options={opcionesTecnico} block etiqueta="Técnico responsable" className="[&>button]:py-1.5 [&>button]:text-xs [@media(pointer:coarse)]:[&>button]:min-h-11" />
          </div>
        ) : null}
      </div>
    </li>
  );
});

// ── Tarjeta de un técnico ────────────────────────────────────────────────────
type Grupo = {
  key: string;
  id: string | null;
  nombre: string;
  activos: number;
  en_espera: number;
  vencidos: number;
  sla_rojo: number;
  sobre_wip: boolean;
  entregados_mes: number;
  proyectos: Metrica[];
};

function TarjetaTecnico({ g, wip, estados, abierta, onToggle, children }: {
  g: Grupo; wip: number; estados: Map<string, { nombre: string; color: string; orden: number }>;
  abierta: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  const sinTecnico = g.id == null;
  const dist = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of g.proyectos) c.set(p.estado_id, (c.get(p.estado_id) ?? 0) + 1);
    return [...c.entries()]
      .map(([id, n]) => ({ id, n, nombre: estados.get(id)?.nombre ?? g.proyectos.find((p) => p.estado_id === id)?.estado_nombre ?? "", color: estados.get(id)?.color ?? g.proyectos.find((p) => p.estado_id === id)?.estado_color ?? "#94a3b8", orden: estados.get(id)?.orden ?? 999 }))
      .sort((a, b) => a.orden - b.orden);
  }, [g.proyectos, estados]);
  const total = g.proyectos.length;
  const wipTono = g.activos > wip ? "border-rose-200 bg-rose-50 text-rose-700" : g.activos === wip ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700";
  const subtitulo = [
    `${g.activos} en curso`,
    g.en_espera ? `${g.en_espera} en espera / pausa` : null,
    g.entregados_mes ? `${g.entregados_mes} entregado${g.entregados_mes === 1 ? "" : "s"} este mes` : null,
  ].filter(Boolean).join(" · ");
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-[0_8px_24px_-12px_rgba(15,23,42,0.12)]">
      <button type="button" onClick={onToggle} aria-expanded={abierta}
        className={`flex w-full items-center gap-2.5 px-3 py-3 text-left transition-colors sm:gap-3 sm:px-4 ${abierta ? "bg-slate-50/80" : "hover:bg-slate-50/60"}`}>
        {sinTecnico ? (
          <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400"><UserX className="h-4 w-4" /></span>
        ) : <Avatar nombre={g.nombre} tam={36} />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`truncate text-sm font-semibold ${sinTecnico ? "italic text-slate-500" : "text-slate-900"}`} title={g.nombre}>{sinTecnico ? "Sin técnico asignado" : nombreCorto(g.nombre)}</span>
            {!sinTecnico ? (
              <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${wipTono}`}
                title={`WIP: ${g.activos} proyectos en estados que cuentan SLA (límite ${wip})`}>
                WIP {g.activos}/{wip}{g.sobre_wip ? " · sobre el límite" : ""}
              </span>
            ) : null}
            {g.vencidos ? <span className="inline-flex items-center gap-0.5 rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700"><AlarmClock className="h-2.5 w-2.5" /> {g.vencidos} vencido{g.vencidos === 1 ? "" : "s"}</span> : null}
            {g.sla_rojo ? <span className="inline-flex items-center gap-0.5 rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700"><Timer className="h-2.5 w-2.5" /> {g.sla_rojo} SLA vencido</span> : null}
          </div>
          <div className="text-[11px] text-slate-500">{subtitulo}</div>
        </div>
        {total > 0 ? (
          <div className="hidden w-[168px] shrink-0 gap-0.5 md:flex lg:w-[220px]" aria-hidden>
            {dist.map((d) => (
              <span key={d.id} className="h-1.5 rounded-full" style={{ width: `${(d.n / total) * 100}%`, backgroundColor: d.color }} title={`${d.nombre}: ${d.n}`} />
            ))}
          </div>
        ) : null}
        <span className="shrink-0 rounded-full bg-[var(--brand)]/10 px-2.5 py-1 text-[13px] font-bold tabular-nums text-[var(--brand-700)]">{total}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${abierta ? "rotate-180" : ""}`} />
      </button>
      {abierta ? <div className="border-t border-slate-100">{children}</div> : null}
    </section>
  );
}

// ── Pantalla ─────────────────────────────────────────────────────────────────
export function TareasEquipo({ yo, esAdmin, version, onAbrir, avisar }: {
  yo: string | undefined; esAdmin: boolean; version: number; onAbrir: (id: string) => void; avisar: Aviso;
}) {
  const [data, setData] = useState<EquipoResp | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [estados, setEstados] = useState<Estado[]>([]);
  const usuarios = useUsuarios();

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true);
    try {
      const r = await apiFetch<EquipoResp>("/api/proyectos/equipo");
      setData(r);
      setError(null);
    } catch (e) {
      if (!silencioso) setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar, version]);
  useEffect(() => {
    apiFetchCache<Estado[]>("/api/proyectos/estados?activas=1", { ttlMs: 5 * 60_000 }).then(setEstados).catch(() => {});
  }, [version]);
  useRefrescoVisible(useCallback(() => void cargar(true), [cargar]), 60_000);

  // ── Filtros ──
  const [busqueda, setBusqueda] = useState("");
  const [fTecnico, setFTecnico] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fPrioridad, setFPrioridad] = useState("");
  const [soloAlertas, setSoloAlertas] = useState(false);

  const estadosMap = useMemo(() => new Map(estados.map((e) => [e.id, { nombre: e.nombre, color: e.color, orden: e.orden }])), [estados]);
  const abiertos = useMemo(() => estados.filter((e) => !e.es_final), [estados]);
  const opcionesEstado = useMemo<[string, string][]>(() => estados.map((e) => [e.id, e.nombre]), [estados]);
  const tecnicosConocidos = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of data?.tecnicos ?? []) m.set(t.id, t.nombre);
    for (const u of usuarios as UsuarioMin[]) if (!m.has(u.id)) m.set(u.id, u.nombre);
    return [...m.entries()].sort((a, b) => nombreCorto(a[1]).localeCompare(nombreCorto(b[1]), "es"));
  }, [data, usuarios]);
  const opcionesTecnico = useMemo<[string, string][]>(() => [["", "Sin asignar"], ...tecnicosConocidos.map(([id, n]) => [id, nombreCorto(n)] as [string, string])], [tecnicosConocidos]);

  const grupos = useMemo<Grupo[]>(() => {
    if (!data) return [];
    const q = busqueda.trim();
    // búsqueda inteligente: sin tildes, en cualquier orden, errores de tipeo; "pry 12" /
    // "PRY-00012" / "12" = ese proyecto solo (se resuelve sobre todos a la vez)
    const encontrados = q
      ? new Set(filtrar([...data.tecnicos.flatMap((t) => t.proyectos), ...data.sin_tecnico], q,
          (m) => ({ principal: m.titulo, otros: [m.cliente_nombre, m.tecnico_nombre], documentos: [m.numero] })))
      : null;
    const pasa = (m: Metrica) =>
      (!fEstado || m.estado_id === fEstado) &&
      (!fPrioridad || m.prioridad === fPrioridad) &&
      (!soloAlertas || esAlerta(m)) &&
      (!encontrados || encontrados.has(m));
    const filtrando = !!(q || fEstado || fPrioridad || soloAlertas);
    const lista: Grupo[] = data.tecnicos.map((t) => ({ ...t, key: t.id, proyectos: t.proyectos.filter(pasa) }));
    const sin = data.sin_tecnico.filter(pasa);
    if (data.sin_tecnico.length) {
      lista.push({
        key: "__sin__", id: null, nombre: "Sin técnico asignado",
        activos: data.sin_tecnico.filter((m) => m.tipo_sla === "interno").length,
        en_espera: data.sin_tecnico.filter((m) => m.tipo_sla !== "interno").length,
        vencidos: data.sin_tecnico.filter((m) => m.vencido).length,
        sla_rojo: data.sin_tecnico.filter((m) => m.semaforo === "rojo").length,
        sobre_wip: false, entregados_mes: 0, proyectos: sin,
      });
    }
    return lista.filter((g) => (!fTecnico || g.key === fTecnico) && (!filtrando || g.proyectos.length > 0));
  }, [data, busqueda, fTecnico, fEstado, fPrioridad, soloAlertas]);

  // ── Desplegadas: arranca abierta la mía (si soy técnico); "Expandir todo" las abre todas ──
  const [abiertas, setAbiertas] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (data && abiertas === null) setAbiertas(new Set(yo && data.tecnicos.some((t) => t.id === yo) ? [yo] : []));
  }, [data, abiertas, yo]);
  const abiertasSet = abiertas ?? new Set<string>();
  const filtrando = !!(busqueda.trim() || fEstado || fPrioridad || soloAlertas);
  const todasAbiertas = grupos.length > 0 && grupos.every((g) => abiertasSet.has(g.key));
  const toggle = (k: string) => setAbiertas((p) => { const n = new Set(p ?? []); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleTodas = () => setAbiertas(todasAbiertas ? new Set() : new Set(grupos.map((g) => g.key)));

  // ── Acciones ──
  const [guardando, setGuardando] = useState<string | null>(null);
  const [pide, setPide] = useState<{ m: Metrica; estado: Estado } | null>(null);

  const mover = useCallback(async (m: Metrica, estadoId: string, motivo: string | null = null) => {
    setGuardando(m.id);
    try {
      await apiFetch(`/api/proyectos/${m.id}/estado`, { method: "POST", body: JSON.stringify({ estado_id: estadoId, motivo }) });
      await cargar(true);
    } catch (e) {
      avisar({ texto: `No se pudo mover: ${(e as Error).message}`, tipo: "error" });
    } finally {
      setGuardando(null);
    }
  }, [avisar, cargar]);

  const onMover = useCallback((m: Metrica, estadoId: string) => {
    if (!estadoId || estadoId === m.estado_id) return;
    const destino = estados.find((e) => e.id === estadoId);
    if (pideMotivo(destino)) { setPide({ m, estado: destino! }); return; }
    void mover(m, estadoId);
  }, [estados, mover]);

  const onAsignar = useCallback(async (m: Metrica, tecnicoId: string) => {
    if ((tecnicoId || null) === m.responsable_tecnico_id) return;
    setGuardando(m.id);
    try {
      await apiFetch(`/api/proyectos/${m.id}`, { method: "PATCH", body: JSON.stringify({ responsable_tecnico_id: tecnicoId || null }) });
      await cargar(true);
      avisar({ texto: tecnicoId ? `Asignado a ${nombreCorto(tecnicosConocidos.find(([id]) => id === tecnicoId)?.[1] ?? "")}.` : "Proyecto sin técnico." });
    } catch (e) {
      avisar({ texto: `No se pudo reasignar: ${(e as Error).message}`, tipo: "error" });
    } finally {
      setGuardando(null);
    }
  }, [avisar, cargar, tecnicosConocidos]);

  // ── Totales de la barra ──
  const tot = useMemo(() => {
    const todos = [...(data?.tecnicos.flatMap((t) => t.proyectos) ?? []), ...(data?.sin_tecnico ?? [])];
    return {
      total: todos.length,
      vencidos: todos.filter((m) => m.vencido).length,
      rojos: todos.filter((m) => m.semaforo === "rojo").length,
      bloqueados: todos.filter((m) => m.bloqueado).length,
      sobreWip: data?.tecnicos.filter((t) => t.sobre_wip).length ?? 0,
      sinTecnico: data?.sin_tecnico.length ?? 0,
    };
  }, [data]);

  const opcionesFiltroTecnico: [string, string][] = [
    ["", "Todo el equipo"],
    ...(data?.tecnicos ?? []).map((t) => [t.id, t.id === yo ? `${nombreCorto(t.nombre)} (yo)` : nombreCorto(t.nombre)] as [string, string]),
    ...(data?.sin_tecnico.length ? [["__sin__", "Sin técnico asignado"] as [string, string]] : []),
  ];

  if (!data && cargando) {
    return <div className="space-y-2.5">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-2xl border border-slate-200 bg-white/60" />)}</div>;
  }
  if (!data) return <ErrorCaja error={error ?? "No se pudo cargar el equipo"} onReintentar={() => void cargar()} />;

  return (
    <div className="space-y-3">
      {/* Barra: resumen + filtros */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
          {tot.total} proyecto{tot.total === 1 ? "" : "s"} abiertos
        </span>
        {tot.vencidos ? <span className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700"><AlarmClock className="h-3 w-3" /> {tot.vencidos} vencido{tot.vencidos === 1 ? "" : "s"}</span> : null}
        {tot.rojos ? <span className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700"><Timer className="h-3 w-3" /> {tot.rojos} con SLA vencido</span> : null}
        {tot.bloqueados ? <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700"><Lock className="h-3 w-3" /> {tot.bloqueados} bloqueado{tot.bloqueados === 1 ? "" : "s"}</span> : null}
        {tot.sobreWip ? <span className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700"><Flame className="h-3 w-3" /> {tot.sobreWip} técnico{tot.sobreWip === 1 ? "" : "s"} sobre el WIP ({data.wip})</span> : null}
        {tot.sinTecnico ? <span className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700"><UserX className="h-3 w-3" /> {tot.sinTecnico} sin técnico</span> : null}
        <div className="ml-auto flex items-center gap-2 pr-1 text-[11px] text-slate-400">
          <Girando activo={cargando} />
          <span className="hidden items-center gap-2 sm:flex" title="Semáforo del SLA del estado (horas laborales contra el objetivo del estado)">
            SLA del estado:
            {(["verde", "amarillo", "naranja", "rojo"] as const).map((s, i) => (
              <span key={s} className="inline-flex items-center gap-1"><i className={`h-2 w-2 rounded-full ${SEMAFORO_PUNTO[s]}`} aria-hidden />{["<70%", "70%+", "90%+", "vencido"][i]}</span>
            ))}
          </span>
          <button type="button" onClick={() => void cargar()} title="Actualizar ahora" aria-label="Actualizar ahora" className="inline-flex items-center justify-center rounded-lg p-1 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"><RefreshCw className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      <BarraFiltros
        plano
        activos={[fTecnico, fEstado, fPrioridad, soloAlertas].filter(Boolean).length}
        onLimpiar={() => {
          setFTecnico("");
          setFEstado("");
          setFPrioridad("");
          setSoloAlertas(false);
        }}
        busqueda={
          <div className="relative min-w-0 md:min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--brand)]" />
            <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setBusqueda("")}
              placeholder="Buscar por proyecto, número, cliente o técnico…" aria-label="Buscar en el equipo" enterKeyHint="search"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 hover:border-[var(--brand)]/60 focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20 max-md:h-11" />
          </div>
        }
      >
        <Select value={fTecnico} onChange={setFTecnico} minWidth={190} options={opcionesFiltroTecnico} etiqueta="Técnico" />
        <Select value={fEstado} onChange={setFEstado} minWidth={180} etiqueta="Estado" options={[["", "Todos los estados"], ...abiertos.map((e) => [e.id, e.nombre] as [string, string])]} />
        <Select value={fPrioridad} onChange={setFPrioridad} minWidth={170} etiqueta="Prioridad" options={[["", "Todas las prioridades"], ...PRIORIDADES.map((p) => [p, PRIORIDAD_LABEL[p]] as [string, string])]} />
        <button type="button" onClick={() => setSoloAlertas((v) => !v)} aria-pressed={soloAlertas}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors max-md:min-h-11 max-md:justify-center max-md:text-sm ${soloAlertas ? "border-rose-300 bg-rose-50 text-rose-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}
          title="Vencidos, SLA vencido, bloqueados o sin movimiento">
          <AlarmClock className="h-3.5 w-3.5" /> Solo con alertas
        </button>
      </BarraFiltros>

      {error ? <ErrorCaja error={error} onReintentar={() => void cargar()} /> : null}

      {/* Leyenda de estados + expandir */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {abiertos.map((e) => (
            <span key={e.id} className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
              <i aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: e.color }} />{e.nombre}
            </span>
          ))}
        </div>
        {grupos.length ? (
          <button type="button" onClick={toggleTodas}
            className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 [@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:px-3.5">
            {todasAbiertas ? "Contraer todo" : "Expandir todo"}
          </button>
        ) : null}
      </div>

      {grupos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-sm font-medium text-slate-700">{filtrando || fTecnico ? "Nada con estos filtros" : "No hay proyectos abiertos"}</p>
          <p className="mt-1 text-xs text-slate-500">
            {filtrando || fTecnico ? "Probá quitando algún filtro." : "Cuando un proyecto tenga técnico responsable, aparece en su tarjeta. Los técnicos sin proyectos también se listan si están marcados como técnicos."}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {grupos.map((g) => {
            // Una subsección por estado (las vacías no se dibujan).
            const porEstado = new Map<string, Metrica[]>();
            for (const p of g.proyectos) porEstado.set(p.estado_id, [...(porEstado.get(p.estado_id) ?? []), p]);
            const secciones = [...porEstado.entries()].sort((a, b) => (estadosMap.get(a[0])?.orden ?? 999) - (estadosMap.get(b[0])?.orden ?? 999));
            const abierta = abiertasSet.has(g.key);
            return (
              <TarjetaTecnico key={g.key} g={g} wip={data.wip} estados={estadosMap} abierta={abierta} onToggle={() => toggle(g.key)}>
                {g.proyectos.length === 0 ? (
                  <p className="px-4 py-6 text-center text-[11px] text-slate-400">Sin proyectos abiertos.</p>
                ) : secciones.map(([estadoId, ps]) => {
                  const color = estadosMap.get(estadoId)?.color ?? ps[0].estado_color;
                  const nombre = estadosMap.get(estadoId)?.nombre ?? ps[0].estado_nombre;
                  return (
                    <section key={estadoId} className="border-t-[6px] border-slate-100 first:border-t-0">
                      <header className="flex items-center gap-2 px-4 py-2" style={{ backgroundColor: `${color}1A`, borderLeft: `4px solid ${color}` }}>
                        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full ring-2 ring-white" style={{ backgroundColor: color }} />
                        <h4 className="min-w-0 flex-1 truncate text-[11.5px] font-bold uppercase tracking-[0.07em] text-slate-800">{nombre}</h4>
                        {ps[0].sla_horas_objetivo && ps[0].tipo_sla === "interno" ? (
                          <span className="text-[10px] font-medium text-slate-500">objetivo {fmtHoras(ps[0].sla_horas_objetivo)}</span>
                        ) : null}
                        <span className="shrink-0 rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-700">{ps.length}</span>
                      </header>
                      <ul className="divide-y divide-slate-100" style={{ borderLeft: `4px solid ${color}33` }}>
                        {ps.map((m) => {
                          const esPm = !!yo && m.project_manager_id === yo;
                          const puedeMover = esAdmin || esPm || (!!yo && m.responsable_tecnico_id === yo);
                          return (
                            <FilaProyecto
                              key={m.id}
                              m={m}
                              generadoAt={data.generado_at}
                              horario={data.horario}
                              opcionesEstado={opcionesEstado}
                              opcionesTecnico={opcionesTecnico}
                              puedeMover={puedeMover && opcionesEstado.length > 0}
                              puedeAsignar={esAdmin || esPm}
                              guardando={guardando === m.id}
                              onAbrir={onAbrir}
                              onMover={onMover}
                              onAsignar={onAsignar}
                            />
                          );
                        })}
                      </ul>
                    </section>
                  );
                })}
              </TarjetaTecnico>
            );
          })}
        </div>
      )}

      <p className="text-center text-xs text-slate-400">
        Las horas son laborales (horario de la empresa) en el estado actual y corren solas; los datos se actualizan cada minuto. WIP = proyectos en estados que cuentan SLA.
      </p>

      {pide ? (
        <MotivoModal
          estado={pide.estado}
          proyecto={pide.m.titulo}
          onCancel={() => setPide(null)}
          onConfirm={(motivo) => { const p = pide; setPide(null); void mover(p.m, p.estado.id, motivo); }}
        />
      ) : null}
    </div>
  );
}
