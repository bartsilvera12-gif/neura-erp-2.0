"use client";

/**
 * Agenda (portada tal cual de dashboard/agenda/AgendaClient.tsx del sistema actual):
 * encabezado con métricas, "Hoy" con su resumen, navegación del período, vistas Día /
 * Semana (por defecto) / Mes / Listado, rango horario visible, filtros y "Nueva cita".
 * `?cita=<id>` (los avisos de la campanita) abre esa cita.
 *
 * Celular: sin la vista Semana (7 columnas no entran): arranca en Día, con una tira de la
 * semana para saltar de día; Mes muestra puntos por día (tocar un día abre ese día) y
 * Listado es la lista de citas. Los popovers (Hoy, rango horario) van en hoja inferior,
 * los filtros en "Filtros" y todo a 44 px.
 */
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, Settings2 } from "lucide-react";
import { BarraFiltros, VolverIcono } from "@/components/EncabezadoPagina";
import { HojaInferior } from "@/components/HojaInferior";
import { Select } from "@/components/Select";
import { ScrollHorizontal } from "@/components/ScrollHorizontal";
import { useEsMovil } from "@/lib/ui/responsive";
import { apiFetch } from "@/lib/api/client-fetch";
import { AGENDA_ESTADOS, type AgendaCitaEnriquecida } from "@/modules/agenda/dominio";
import { HORARIO_DEFECTO } from "@/modules/agenda/horario";
import CitaFormModal, { type AgendaOptions } from "./components/CitaFormModal";
import CitaDetalleModal from "./components/CitaDetalleModal";
import RangoHorarioConfig from "./components/RangoHorarioConfig";
import HoyResumen from "./components/HoyResumen";
import TimeGridView from "./views/TimeGridView";
import MonthView from "./views/MonthView";
import ListView from "./views/ListView";
import {
  WEEKDAYS_ES,
  addDays,
  addMonths,
  diaSemana,
  isToday,
  sameDay,
  startOfWeek,
  ahoraPared,
  aPared,
  deParedIso,
  estadoStyle,
  rangeForView,
  tituloPeriodo,
  type AgendaView,
} from "./calendar-utils";
import { DEFAULT_PREFS, getAgendaPrefs, setAgendaPrefs, type AgendaPrefs } from "./agenda-prefs";

type Resumen = {
  hoy: number;
  pendientes: number;
  confirmadas: number;
  completadas: number;
  canceladas_no_asistio: number;
};

const VIEWS: { key: AgendaView; label: string }[] = [
  { key: "dia", label: "Día" },
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mes" },
  { key: "lista", label: "Listado" },
];

export default function AgendaClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const citaParam = searchParams.get("cita");

  const [citas, setCitas] = useState<AgendaCitaEnriquecida[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [options, setOptions] = useState<AgendaOptions>({ responsables: [], tipos: [], horario: HORARIO_DEFECTO });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Vista de calendario. `anchor` es una fecha de pared de Paraguay.
  const [view, setView] = useState<AgendaView>("semana"); // default: Semana
  const [anchor, setAnchor] = useState<Date>(() => ahoraPared());
  const esMovil = useEsMovil();
  // En celular no hay vista Semana: se pasa a Día (y si se agranda la pantalla, queda en Día).
  useEffect(() => {
    if (esMovil && view === "semana") setView("dia");
  }, [esMovil, view]);

  // Preferencias (rango horario visible) — localStorage por navegador
  const [prefs, setPrefs] = useState<AgendaPrefs>(DEFAULT_PREFS);
  useEffect(() => {
    setPrefs(getAgendaPrefs());
  }, []);
  function updatePrefs(p: AgendaPrefs) {
    setPrefs(setAgendaPrefs(p));
  }

  // Popovers
  const [hoyOpen, setHoyOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  // Filtros
  const [estado, setEstado] = useState("");
  const [responsableId, setResponsableId] = useState("");
  const [q, setQ] = useState("");

  // Modales
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"crear" | "editar" | "reprogramar">("crear");
  const [formCita, setFormCita] = useState<AgendaCitaEnriquecida | null>(null);
  const [prefill, setPrefill] = useState<{ inicio: Date; fin: Date } | null>(null);
  const [detalle, setDetalle] = useState<AgendaCitaEnriquecida | null>(null);

  const loadResumen = useCallback(async () => {
    try {
      setResumen(await apiFetch<Resumen>("/api/agenda/resumen"));
    } catch {
      /* noop */
    }
  }, []);

  const loadOptions = useCallback(async () => {
    try {
      setOptions(await apiFetch<AgendaOptions>("/api/agenda/options"));
    } catch {
      /* noop */
    }
  }, []);

  const loadCitas = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { start, end } = rangeForView(view, anchor);
    const params = new URLSearchParams();
    params.set("desde", deParedIso(start));
    params.set("hasta", deParedIso(end));
    if (estado) params.set("estado", estado);
    if (responsableId) params.set("responsable_id", responsableId);
    if (q.trim()) params.set("q", q.trim());

    // Un corte momentáneo del servidor: se reintenta una vez y, si sigue, se muestra un
    // mensaje legible.
    const pedir = async (): Promise<{ ok: true; data: AgendaCitaEnriquecida[] } | { ok: false; error: string }> => {
      try {
        return { ok: true, data: await apiFetch<AgendaCitaEnriquecida[]>(`/api/agenda?${params.toString()}`) };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        return { ok: false, error: msg && !/<\s*(!doctype|html)/i.test(msg) ? msg : "" };
      }
    };
    let r = await pedir();
    if (!r.ok) {
      await new Promise((ok) => setTimeout(ok, 1500));
      r = await pedir();
    }
    if (r.ok) setCitas(r.data);
    else {
      setError(r.error || "No se pudo conectar con el servidor. Probá de nuevo en unos segundos.");
      setCitas([]);
    }
    setLoading(false);
  }, [view, anchor, estado, responsableId, q]);

  useEffect(() => {
    void loadOptions();
    void loadResumen();
  }, [loadOptions, loadResumen]);

  useEffect(() => {
    void loadCitas();
  }, [loadCitas]);

  // ?cita=<id> (aviso de la campanita): abre la cita y lleva el calendario a su día.
  useEffect(() => {
    if (!citaParam) return;
    let vivo = true;
    apiFetch<AgendaCitaEnriquecida>(`/api/agenda/${citaParam}`)
      .then((c) => {
        if (!vivo) return;
        setAnchor(aPared(c.inicio_at));
        setDetalle(c);
      })
      .catch((e) => vivo && setError(e instanceof Error ? e.message : "No se encontró la cita."))
      .finally(() => {
        // Se saca el parámetro para que recargar la página no la vuelva a abrir.
        if (vivo) router.replace(pathname, { scroll: false });
      });
    return () => {
      vivo = false;
    };
  }, [citaParam, pathname, router]);

  function refreshAll() {
    setFormOpen(false);
    setDetalle(null);
    void loadCitas();
    void loadResumen();
  }

  function navegar(dir: -1 | 1) {
    if (view === "mes") setAnchor((a) => addMonths(a, dir));
    else if (view === "dia") setAnchor((a) => addDays(a, dir));
    else setAnchor((a) => addDays(a, dir * 7));
  }

  function irAHoy() {
    setAnchor(ahoraPared());
    setView("dia");
    setHoyOpen(false);
  }

  function openCrear(pf?: { inicio: Date; fin: Date }) {
    setFormMode("crear");
    setFormCita(null);
    setPrefill(pf ?? null);
    setFormOpen(true);
  }
  function openCrearEn(d: Date) {
    openCrear({ inicio: d, fin: new Date(d.getTime() + 30 * 60_000) });
  }
  function openEditar(c: AgendaCitaEnriquecida) {
    setDetalle(null);
    setFormMode("editar");
    setFormCita(c);
    setPrefill(null);
    setFormOpen(true);
  }
  function openReprogramar(c: AgendaCitaEnriquecida) {
    setDetalle(null);
    setFormMode("reprogramar");
    setFormCita(c);
    setPrefill(null);
    setFormOpen(true);
  }

  const stats: { label: string; value: number; dot: string }[] = [
    { label: "Hoy", value: resumen?.hoy ?? 0, dot: "bg-teal-500" },
    { label: "Pendientes", value: resumen?.pendientes ?? 0, dot: estadoStyle("pendiente").dot },
    { label: "Confirmadas", value: resumen?.confirmadas ?? 0, dot: estadoStyle("confirmada").dot },
    { label: "Completadas", value: resumen?.completadas ?? 0, dot: estadoStyle("completada").dot },
    { label: "Cancel./No asist.", value: resumen?.canceladas_no_asistio ?? 0, dot: estadoStyle("cancelada").dot },
  ];

  const esTimeGrid = view === "dia" || view === "semana";

  return (
    <div className="w-full">
      {/* Encabezado + métricas compactas (en celular las métricas van en una fila con scroll) */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex w-full items-center justify-between gap-3 sm:w-auto">
          <div className="flex min-w-0 items-center gap-1">
            {/* Volver al panel Comercial: discreto, en la línea del título (no le quita alto al calendario). */}
            <VolverIcono href="/comercial" label="Comercial" />
            <h1 className="text-xl font-semibold text-slate-800">Agenda</h1>
          </div>
          <button
            type="button"
            onClick={() => openCrear()}
            className="flex h-11 items-center gap-1 rounded-xl bg-teal-500 px-4 text-sm font-semibold text-white shadow-sm hover:bg-teal-600 sm:hidden"
          >
            <Plus className="h-4 w-4" /> Nueva cita
          </button>
        </div>
        <ScrollHorizontal claseFila="gap-1.5 items-center" className="max-sm:-mx-1 max-sm:px-1 sm:w-auto">
          {stats.map((s) => (
            <div key={s.label} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200 bg-white px-3 py-1 shadow-sm">
              <span className={`h-2 w-2 rounded-full ${s.dot}`} />
              <span className="text-sm font-semibold text-slate-800">{s.value}</span>
              <span className="text-[11px] text-slate-500">{s.label}</span>
            </div>
          ))}
        </ScrollHorizontal>
      </div>

      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2 max-sm:w-full">
          {/* Botón Hoy con popover de resumen (hoja inferior en celular) */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setHoyOpen((v) => !v)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors max-sm:h-11 max-sm:px-4 ${
                hoyOpen ? "border-teal-500 bg-teal-50 text-teal-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              Hoy
            </button>
            {hoyOpen && (
              <Popover onClose={() => setHoyOpen(false)} align="left" titulo="Hoy">
                <HoyResumen
                  onSelect={(c) => {
                    setHoyOpen(false);
                    setDetalle(c);
                  }}
                  onVerDia={irAHoy}
                />
              </Popover>
            )}
          </div>

          <div className="flex shrink-0 items-center">
            <button type="button" onClick={() => navegar(-1)} className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 max-sm:h-11 max-sm:w-11" aria-label="Anterior">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => navegar(1)} className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 max-sm:h-11 max-sm:w-11" aria-label="Siguiente">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
          <span className="ml-1 min-w-0 truncate text-sm font-medium capitalize text-slate-700">{tituloPeriodo(view, anchor)}</span>
        </div>

        <div className="flex items-center gap-2 max-sm:w-full">
          {/* Selector de vista (en celular sin "Semana": 7 columnas no entran) */}
          <div className="flex rounded-lg border border-slate-300 bg-white p-0.5 shadow-sm max-sm:flex-1" role="tablist" aria-label="Vista">
            {VIEWS.filter((v) => !(esMovil && v.key === "semana")).map((v) => (
              <button
                key={v.key}
                type="button"
                role="tab"
                aria-selected={view === v.key}
                onClick={() => setView(v.key)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors max-sm:min-h-10 max-sm:flex-1 max-sm:text-sm ${
                  view === v.key ? "bg-teal-500 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>

          {/* Configuración de rango horario (teal) */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setConfigOpen((v) => !v)}
              disabled={!esTimeGrid}
              title={esTimeGrid ? "Rango horario visible" : "Disponible en Día/Semana"}
              className={`inline-flex items-center justify-center rounded-lg border p-1.5 transition-colors max-sm:h-11 max-sm:w-11 ${
                configOpen ? "border-teal-500 bg-teal-50 text-teal-600" : "border-slate-300 bg-white text-teal-600 hover:bg-teal-50"
              } disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-white`}
              aria-label="Configurar rango horario"
            >
              <Settings2 className="h-4 w-4" />
            </button>
            {configOpen && esTimeGrid && (
              <Popover onClose={() => setConfigOpen(false)} align="right" titulo="Rango horario visible">
                <RangoHorarioConfig prefs={prefs} onChange={updatePrefs} />
              </Popover>
            )}
          </div>

          <button
            type="button"
            onClick={() => openCrear()}
            className="flex items-center gap-1 rounded-lg bg-teal-500 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-teal-600 max-sm:hidden"
          >
            <Plus className="h-4 w-4" /> Nueva cita
          </button>
        </div>
      </div>

      {/* Filtros sutiles (en celular: búsqueda + "Filtros" con estado y responsable en una hoja) */}
      <BarraFiltros
        plano
        className="mb-3"
        activos={(estado ? 1 : 0) + (responsableId ? 1 : 0)}
        onLimpiar={() => {
          setEstado("");
          setResponsableId("");
        }}
        busqueda={
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar título o contacto…"
            type="search"
            enterKeyHint="search"
            className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 outline-none transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-400 max-md:h-11 md:max-w-xs"
          />
        }
        extra={loading ? <span className="shrink-0 text-xs text-slate-400 max-md:sr-only">Cargando…</span> : null}
      >
        <Select
          compacto
          minWidth={170}
          className="max-md:w-full"
          etiqueta="Estado"
          value={estado}
          onChange={setEstado}
          options={[["", "Todos los estados"], ...AGENDA_ESTADOS.map((s): [string, string] => [s, estadoStyle(s).label])]}
        />
        <Select
          compacto
          minWidth={200}
          className="max-md:w-full"
          etiqueta="Responsable"
          value={responsableId}
          onChange={setResponsableId}
          options={[["", "Todos los responsables"], ...options.responsables.map((r): [string, string] => [r.id, r.nombre ?? r.id])]}
        />
      </BarraFiltros>

      {error && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

      {/* Celular, vista Día: tira de la semana para saltar de día con un toque */}
      {esMovil && view === "dia" ? <TiraSemana anchor={anchor} onElegir={setAnchor} /> : null}


      {/* Vista activa */}
      {view === "lista" ? (
        <ListView citas={citas} onSelect={setDetalle} />
      ) : view === "mes" ? (
        <MonthView
          anchor={anchor}
          citas={citas}
          onSelect={setDetalle}
          onCreateAt={openCrearEn}
          onVerDia={(d) => {
            setAnchor(d);
            setView("dia");
          }}
        />
      ) : (
        <TimeGridView
          view={view}
          anchor={anchor}
          citas={citas}
          startHour={prefs.startHour}
          endHour={prefs.endHour}
          onSelect={setDetalle}
          onCreateAt={openCrearEn}
        />
      )}

      <CitaFormModal
        open={formOpen}
        mode={formMode}
        cita={formCita}
        prefill={prefill}
        options={options}
        onClose={() => setFormOpen(false)}
        onSaved={refreshAll}
      />
      <CitaDetalleModal
        open={!!detalle}
        cita={detalle}
        onClose={() => setDetalle(null)}
        onEditar={openEditar}
        onReprogramar={openReprogramar}
        onChanged={refreshAll}
      />
    </div>
  );
}

/** Popover liviano con cierre por click afuera (en celular, hoja inferior con `titulo`). */
function Popover({ children, onClose, align, titulo }: { children: React.ReactNode; onClose: () => void; align: "left" | "right"; titulo: string }) {
  const esMovil = useEsMovil();
  if (esMovil) {
    return (
      <HojaInferior titulo={titulo} onClose={onClose}>
        {children}
      </HojaInferior>
    );
  }
  return (
    <>
      <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Cerrar" onClick={onClose} />
      <div className={`absolute z-50 mt-2 rounded-xl border border-slate-200 bg-white p-3 shadow-lg ${align === "right" ? "right-0" : "left-0"}`}>
        {children}
      </div>
    </>
  );
}

/** Celular, vista Día: los 7 días de la semana del día elegido (tocar uno lo abre). */
function TiraSemana({ anchor, onElegir }: { anchor: Date; onElegir: (d: Date) => void }) {
  const lunes = startOfWeek(anchor);
  const dias = Array.from({ length: 7 }, (_, i) => addDays(lunes, i));
  return (
    <div className="mb-2 grid grid-cols-7 gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm" role="tablist" aria-label="Días de la semana">
      {dias.map((d) => {
        const activo = sameDay(d, anchor);
        const hoy = isToday(d);
        return (
          <button
            key={d.toISOString()}
            type="button"
            role="tab"
            aria-selected={activo}
            onClick={() => onElegir(d)}
            className={`flex min-h-12 flex-col items-center justify-center rounded-lg text-center transition-colors ${
              activo ? "bg-teal-500 text-white shadow-sm" : hoy ? "bg-teal-50 text-teal-700" : "text-slate-600 active:bg-slate-100"
            }`}
          >
            <span className={`text-[10px] font-medium uppercase ${activo ? "text-white/80" : "text-slate-400"}`}>{WEEKDAYS_ES[diaSemana(d)]}</span>
            <span className="text-[15px] font-semibold tabular-nums">{d.getUTCDate()}</span>
          </button>
        );
      })}
    </div>
  );
}
