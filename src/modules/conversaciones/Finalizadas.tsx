"use client";

/**
 * Conversaciones finalizadas (como el sistema actual): filtros (fechas, asesor que cerró,
 * asignado, cola, estado de cierre, semáforo, búsqueda), tabla con la tipificación,
 * etiquetas, tiempo de primera respuesta y SEMÁFORO del último mensaje del asesor (verde
 * ≤ 2 días, ámbar 3-6, rojo ≥ 7); lectura del chat y "Reabrir". Pestaña Seguimientos: las
 * próximas acciones pendientes de los cierres (de la más próxima a la más lejana) con
 * "Marcar hecho". UNA consulta keyset (chat_finalizadas) con "Cargar más".
 * ADMIN/supervisores ven todas (o las de su equipo); el resto, las que cerró.
 */
import { TablaTarjetas } from "@/components/TablaResponsive";
import { Select } from "@/components/Select";
import { SelectorFecha } from "@/components/SelectorFecha";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarCheck, CalendarClock, Download, Eye, RotateCcw, SlidersHorizontal } from "lucide-react";
import { TZ_PY, hoyPY } from "@/lib/fecha/paraguay";
import { accionConversacion, pedirCatalogoCierre, pedirOpciones, type CatalogoCierre } from "@/modules/conversaciones/api";
import { marcarSeguimiento, pedirFinalizadas, type AlcanceFinalizadas, type FiltrosFinalizadas } from "@/modules/conversaciones/api-supervision";
import { nombreContacto, telefonoLegible } from "@/modules/conversaciones/dominio";
import {
  SEMAFORO, diasLegible, duracionCorta, segundosEntre,
  type ConteoSeguimientos, type Finalizada, type PaginaFinalizadas, type Semaforo,
} from "@/modules/conversaciones/supervision";
import { Encabezado, VOLVER_OMNICANAL, btnPrimario } from "@/modules/conversaciones/ui-supervision";
import { Girando, tabClass } from "@/modules/conversaciones/ui";

const VisorChat = dynamic(() => import("@/modules/conversaciones/VisorChat").then((m) => m.VisorChat), { ssr: false });

type Modo = "finalizadas" | "seguimientos";

const VACIOS: FiltrosFinalizadas = { desde: "", hasta: "", asesor: "", asignado: "", cola: "", estado: "", semaforo: "", q: "" };
const campo =
  "w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20 max-sm:h-11";
const etiqueta = "flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#2F6E71]";
const tarjeta = "overflow-hidden rounded-2xl border border-[#4FAEB2]/20 bg-white shadow-[0_2px_12px_rgba(47,110,113,0.08)]";

const F_FECHA = new Intl.DateTimeFormat("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const fechaHora = (iso: string | null | undefined) => (iso ? F_FECHA.format(new Date(iso)).replace(",", "") : "—");
/** "YYYY-MM-DD" → "dd/mm/aaaa". */
const dia = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");

const SEMAFOROS: Semaforo[] = ["verde", "ambar", "rojo", "sin"];

function PillSemaforo({ r }: { r: Pick<Finalizada, "semaforo" | "dias_asesor" | "ultimo_msg_asesor_at"> }) {
  const s = SEMAFORO[r.semaforo] ?? SEMAFORO.sin;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.pill}`}
      title={r.ultimo_msg_asesor_at ? `Último mensaje del asesor: ${fechaHora(r.ultimo_msg_asesor_at)}` : "El asesor nunca le escribió"}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} aria-hidden />
      {r.ultimo_msg_asesor_at ? diasLegible(r.dias_asesor) : s.label}
    </span>
  );
}

function ProximaAccion({ r, hoy }: { r: Finalizada; hoy: string }) {
  if (!r.proxima_accion_fecha) return <span className="text-slate-400">—</span>;
  const vencida = !r.seguimiento_hecho_at && r.proxima_accion_fecha < hoy;
  const esHoy = !r.seguimiento_hecho_at && r.proxima_accion_fecha === hoy;
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5 max-md:items-end">
      <span
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
          r.seguimiento_hecho_at
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : vencida ? "border-rose-200 bg-rose-50 text-rose-700"
            : esHoy ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-slate-200 bg-white text-slate-700"
        }`}
      >
        {r.seguimiento_hecho_at ? <CalendarCheck className="h-3 w-3" aria-hidden /> : <CalendarClock className="h-3 w-3" aria-hidden />}
        {dia(r.proxima_accion_fecha)}
        {r.seguimiento_hecho_at ? " · hecha" : vencida ? " · vencida" : esHoy ? " · hoy" : ""}
      </span>
      {r.proxima_accion_nota ? <span className="max-w-[220px] truncate text-[11px] text-slate-600 max-md:max-w-none max-md:whitespace-normal" title={r.proxima_accion_nota}>{r.proxima_accion_nota}</span> : null}
    </div>
  );
}

export function Finalizadas() {
  const hoy = hoyPY();
  const [modo, setModo] = useState<Modo>("finalizadas");
  const [borrador, setBorrador] = useState<FiltrosFinalizadas>(VACIOS);
  const [filtros, setFiltros] = useState<FiltrosFinalizadas>(VACIOS);
  const [rows, setRows] = useState<Finalizada[]>([]);
  const [siguiente, setSiguiente] = useState<PaginaFinalizadas["siguiente"]>(null);
  const [alcance, setAlcance] = useState<AlcanceFinalizadas | null>(null);
  const [seg, setSeg] = useState<ConteoSeguimientos>({ pendientes: 0, vencidos: 0 });
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [equipo, setEquipo] = useState<{ id: string; nombre: string }[]>([]);
  const [colas, setColas] = useState<{ id: string; nombre: string }[]>([]);
  const [catalogo, setCatalogo] = useState<CatalogoCierre | null>(null);
  const [visor, setVisor] = useState<Finalizada | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seguimientos = modo === "seguimientos";

  useEffect(() => {
    pedirOpciones()
      .then((o) => {
        setEquipo(o.equipo);
        setColas(o.colas ?? []);
      })
      .catch(() => {});
    pedirCatalogoCierre().then(setCatalogo).catch(() => {});
  }, []);

  const cargar = useCallback(async (f: FiltrosFinalizadas, m: Modo) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setCargando(true);
    setError(null);
    try {
      const p = await pedirFinalizadas(f, null, ac.signal, m === "seguimientos");
      if (ac.signal.aborted) return;
      setRows(p.rows);
      setSiguiente(p.siguiente);
      setAlcance(p.alcance);
      setSeg(p.seguimientos);
    } catch (e) {
      if (!ac.signal.aborted) setError((e as Error).message);
    } finally {
      if (!ac.signal.aborted) setCargando(false);
    }
  }, []);
  useEffect(() => {
    void cargar(filtros, modo);
  }, [cargar, filtros, modo]);

  const cargarMas = async () => {
    if (!siguiente || cargandoMas) return;
    setCargandoMas(true);
    try {
      const p = await pedirFinalizadas(filtros, siguiente, undefined, seguimientos);
      setRows((prev) => {
        const ya = new Set(prev.map((r) => r.id));
        return [...prev, ...p.rows.filter((r) => !ya.has(r.id))];
      });
      setSiguiente(p.siguiente);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargandoMas(false);
    }
  };

  const aplicar = () => setFiltros({ ...borrador });
  const limpiar = () => {
    setBorrador(VACIOS);
    setFiltros(VACIOS);
  };
  const set = (k: keyof FiltrosFinalizadas, v: string) => setBorrador((b) => ({ ...b, [k]: v }));
  // Las fechas cambian de sentido (cierre ↔ próxima acción): al cambiar de pestaña se limpian.
  const cambiarModo = (m: Modo) => {
    if (m === modo) return;
    const sinFechas = { ...filtros, desde: "", hasta: "" };
    setBorrador((b) => ({ ...b, desde: "", hasta: "" }));
    setFiltros(sinFechas);
    setModo(m);
  };

  const nombreDe = (r: Finalizada) => (r.contacto_nombre?.trim() ? nombreContacto(r) : telefonoLegible(r.contacto_telefono));

  const reabrir = async (r: Finalizada) => {
    const nombre = nombreDe(r);
    if (!window.confirm(`¿Reabrir la conversación con ${nombre}? Vuelve a la bandeja como abierta.`)) return;
    setOcupado(`reabrir:${r.id}`);
    try {
      await accionConversacion(r.id, { accion: "reabrir" });
      setRows((prev) => prev.filter((x) => x.id !== r.id));
      setVisor(null);
      setAviso(`Conversación con ${nombre} reabierta.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const hecho = async (r: Finalizada, valor: boolean) => {
    setOcupado(`seg:${r.id}`);
    try {
      const x = await marcarSeguimiento(r.id, valor);
      const act = (f: Finalizada) => (f.id === r.id ? { ...f, seguimiento_hecho_at: x.seguimiento_hecho_at } : f);
      // En Seguimientos la hecha se va de la lista; en Finalizadas queda marcada.
      setRows((prev) => (seguimientos && valor ? prev.filter((f) => f.id !== r.id) : prev.map(act)));
      setVisor((v) => (v && v.id === r.id ? act(v) : v));
      setSeg((s) => {
        const vencida = (r.proxima_accion_fecha ?? "") < hoy ? 1 : 0;
        return valor
          ? { pendientes: Math.max(0, s.pendientes - 1), vencidos: Math.max(0, s.vencidos - vencida) }
          : { pendientes: s.pendientes + 1, vencidos: s.vencidos + vencida };
      });
      setAviso(valor ? `Seguimiento de ${nombreDe(r)} marcado como hecho.` : `Seguimiento de ${nombreDe(r)} vuelve a pendiente.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  useEffect(() => {
    if (!aviso) return;
    const t = window.setTimeout(() => setAviso(null), 4000);
    return () => window.clearTimeout(t);
  }, [aviso]);

  // CSV con los filtros aplicados (hasta 5000 filas, recorriendo el cursor).
  const exportar = async () => {
    setExportando(true);
    try {
      const todas: Finalizada[] = [];
      let cur: PaginaFinalizadas["siguiente"] = null;
      do {
        const p = await pedirFinalizadas(filtros, cur, undefined, seguimientos);
        todas.push(...p.rows);
        cur = p.siguiente;
      } while (cur && todas.length < 5000);
      const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const cab = [
        "Fecha de finalización", "Contacto", "Teléfono", "Canal", "Cola", "Asignado", "Cerrada por", "Estado", "Sub-estado", "Observación", "Etiquetas",
        "1ª respuesta", "Último mensaje del asesor", "Días sin mensaje del asesor", "Semáforo", "Próxima acción", "Nota de la próxima acción", "Seguimiento hecho",
      ];
      const lineas = todas.map((r) =>
        [
          fechaHora(r.cerrada_at), r.contacto_nombre ?? "", telefonoLegible(r.contacto_telefono), r.canal, r.cola ?? "", r.asignado_nombre ?? "",
          r.cerrada_por_nombre ?? "", r.cierre_familia ?? "", r.cierre_estado ?? "", r.cierre_observacion ?? "", (r.etiquetas ?? []).join(", "),
          duracionCorta(segundosEntre(r.created_at, r.primera_respuesta_at)), r.ultimo_msg_asesor_at ? fechaHora(r.ultimo_msg_asesor_at) : "",
          r.dias_asesor ?? "", (SEMAFORO[r.semaforo] ?? SEMAFORO.sin).label, r.proxima_accion_fecha ? dia(r.proxima_accion_fecha) : "",
          r.proxima_accion_nota ?? "", r.seguimiento_hecho_at ? fechaHora(r.seguimiento_hecho_at) : r.proxima_accion_fecha ? "Pendiente" : "",
        ].map(esc).join(";"),
      );
      const blob = new Blob(["﻿" + [cab.map(esc).join(";"), ...lineas].join("\r\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${seguimientos ? "seguimientos" : "conversaciones-finalizadas"}-${new Date().toLocaleDateString("en-CA", { timeZone: TZ_PY })}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      if (cur) setAviso(`Se exportaron ${todas.length} filas (límite 5000). Acotá las fechas para el resto.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExportando(false);
    }
  };

  const verTodo = alcance === "todas" || alcance === "equipo";
  const opcionesEquipo = equipo.map((u): [string, string] => [u.id, u.nombre]);

  return (
    <div className="flex flex-col gap-6 pb-12">
      <Encabezado
        volver={VOLVER_OMNICANAL}
        eyebrow="Omnicanal"
        titulo="Conversaciones finalizadas"
        detalle={
          seguimientos
            ? "Próximas acciones agendadas al finalizar, de la más próxima a la más lejana. Marcalas hechas cuando las cumplas."
            : alcance === "propias"
              ? "Tus conversaciones finalizadas. Filtrá por fecha, estado o buscá un contacto."
              : alcance === "equipo"
                ? "Las conversaciones cerradas de tu equipo con su tipificación. Filtrá, leé el chat sin salir de la pantalla o reabrilo."
                : "Todas las conversaciones cerradas con su tipificación. Filtrá, leé el chat sin salir de la pantalla o reabrilo."
        }
      >
        <button type="button" onClick={() => void exportar()} disabled={exportando || cargando || !rows.length} className={btnPrimario}>
          {exportando ? <Girando className="h-4 w-4" /> : <Download className="h-4 w-4" aria-hidden />} Descargar Excel (CSV)
        </button>
      </Encabezado>

      {/* Pestañas */}
      <div role="tablist" aria-label="Vista" className="flex w-full gap-1 rounded-xl border border-slate-200 bg-slate-100/80 p-1 sm:w-fit">
        {(["finalizadas", "seguimientos"] as Modo[]).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={modo === m}
            onClick={() => cambiarModo(m)}
            className={`${tabClass(modo === m)} max-sm:min-h-11 max-sm:flex-1 max-sm:justify-center`}
          >
            {m === "finalizadas" ? "Finalizadas" : "Seguimientos"}
            {m === "seguimientos" && seg.pendientes ? (
              <span
                className={`rounded-full px-1.5 text-[10px] font-bold tabular-nums ${modo === m ? "bg-white/25 text-white" : seg.vencidos ? "bg-rose-100 text-rose-700" : "bg-slate-200 text-slate-600"}`}
                title={seg.vencidos ? `${seg.vencidos} vencidos` : undefined}
              >
                {seg.pendientes}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}

      {/* Filtros */}
      <section className={tarjeta}>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/12 via-[#4FAEB2]/5 to-transparent px-4 py-3 md:px-5">
          <SlidersHorizontal className="h-4 w-4 text-[#2F6E71]" aria-hidden />
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#2F6E71]">Filtros</h2>
          {/* Referencia del semáforo */}
          <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            {SEMAFOROS.slice(0, 3).map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <span className={`h-2 w-2 rounded-full ${SEMAFORO[s].dot}`} aria-hidden /> {SEMAFORO[s].detalle}
              </span>
            ))}
            <span className="max-sm:hidden">· último mensaje del asesor</span>
          </span>
        </div>
        <form
          className="px-4 pb-4 pt-3 md:px-5"
          onSubmit={(e) => {
            e.preventDefault();
            aplicar();
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className={etiqueta}>
              {seguimientos ? "Acción desde" : "Desde"}
              <SelectorFecha compacto block className="font-normal normal-case tracking-normal" etiqueta="Desde" value={borrador.desde} max={borrador.hasta || undefined} onChange={(v) => set("desde", v)} />
            </div>
            <div className={etiqueta}>
              {seguimientos ? "Acción hasta" : "Hasta"}
              <SelectorFecha compacto block className="font-normal normal-case tracking-normal" etiqueta="Hasta" value={borrador.hasta} min={borrador.desde || undefined} onChange={(v) => set("hasta", v)} />
            </div>
            {verTodo ? (
              <div className={etiqueta}>
                Cerrada por
                <Select compacto block className="font-normal normal-case tracking-normal" etiqueta="Cerrada por" value={borrador.asesor} onChange={(v) => set("asesor", v)} options={[["", "Todos"], ...opcionesEquipo]} />
              </div>
            ) : null}
            {verTodo ? (
              <div className={etiqueta}>
                Asignado a
                <Select compacto block className="font-normal normal-case tracking-normal" etiqueta="Asignado a" value={borrador.asignado} onChange={(v) => set("asignado", v)} options={[["", "Todos"], ...opcionesEquipo]} />
              </div>
            ) : null}
            {colas.length ? (
              <div className={etiqueta}>
                Cola
                <Select
                  compacto
                  block
                  className="font-normal normal-case tracking-normal"
                  etiqueta="Cola"
                  value={borrador.cola}
                  onChange={(v) => set("cola", v)}
                  options={[["", "Todas"], ...colas.map((c): [string, string] => [c.id, c.nombre])]}
                />
              </div>
            ) : null}
            <div className={etiqueta}>
              Estado de cierre
              <Select
                compacto
                block
                buscador
                className="font-normal normal-case tracking-normal"
                etiqueta="Estado de cierre"
                value={borrador.estado}
                onChange={(v) => set("estado", v)}
                options={[
                  ["", "Todos"],
                  ...(catalogo?.familias ?? []).flatMap((f) => f.subestados.map((s): [string, string] => [s.id, `${f.nombre} · ${s.nombre}`])),
                ]}
              />
            </div>
            <div className={etiqueta}>
              Semáforo
              <Select
                compacto
                block
                className="font-normal normal-case tracking-normal"
                etiqueta="Semáforo del último mensaje del asesor"
                value={borrador.semaforo}
                onChange={(v) => set("semaforo", v)}
                options={[["", "Todos"], ...SEMAFOROS.map((s): [string, string] => [s, `${SEMAFORO[s].label} (${SEMAFORO[s].detalle})`])]}
              />
            </div>
            <label className={`${etiqueta} sm:col-span-2 lg:col-span-1`}>
              Buscar (nombre, número, RUC, observación o mensaje)
              <input type="search" value={borrador.q} onChange={(e) => set("q", e.target.value)} placeholder="Nombre, número, RUC o mensaje…" className={campo} />
            </label>
          </div>
          <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <button type="submit" className="rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91] max-sm:min-h-11 max-sm:flex-1">
              Aplicar filtros
            </button>
            <button type="button" onClick={limpiar} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 max-sm:min-h-11 max-sm:flex-1">
              Limpiar
            </button>
          </div>
        </form>
      </section>

      {/* Tabla */}
      <section className={tarjeta}>
        {cargando ? (
          <p className="px-3 py-10 text-center text-sm text-slate-400">Cargando…</p>
        ) : (
          <TablaTarjetas
            filas={rows}
            claveFila={(r) => r.id}
            onFila={(r) => setVisor(r)}
            minAncho={1500}
            claseTabla="w-full text-left text-sm"
            claseThead="border-b border-[#4FAEB2]/20 bg-gradient-to-r from-[#4FAEB2]/12 via-[#4FAEB2]/6 to-transparent"
            thBase="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-[#2F6E71]"
            tdBase="px-3 py-2.5"
            claseFila={() => "hover:!bg-slate-50/80"}
            vacio={
              <p className="px-3 py-10 text-center text-sm text-slate-500">
                {seguimientos ? "No hay próximas acciones pendientes con estos filtros." : "No hay conversaciones finalizadas con estos filtros."}
              </p>
            }
            columnas={[
              ...(seguimientos
                ? [{ key: "prox", titulo: "Próxima acción", movil: "subtitulo" as const, claseTh: "whitespace-nowrap", celda: (r: Finalizada) => <ProximaAccion r={r} hoy={hoy} /> }]
                : []),
              {
                key: "fecha",
                titulo: "Finalización",
                movil: seguimientos ? ("dato" as const) : ("subtitulo" as const),
                claseTh: "whitespace-nowrap",
                claseTd: "whitespace-nowrap tabular-nums text-slate-700",
                celda: (r: Finalizada) => fechaHora(r.cerrada_at),
              },
              {
                key: "contacto",
                titulo: "Contacto",
                movil: "titulo",
                claseTd: "font-medium text-slate-900",
                celda: (r) => r.contacto_nombre?.trim() || "—",
                celdaMovil: (r) => r.contacto_nombre?.trim() || telefonoLegible(r.contacto_telefono),
              },
              { key: "tel", titulo: "Teléfono", movil: "dato", claseTd: "whitespace-nowrap font-mono text-[12px] text-slate-600", celda: (r) => telefonoLegible(r.contacto_telefono) },
              { key: "canal", titulo: "Canal", movil: "dato", claseTd: "text-slate-700", celda: (r) => r.canal },
              { key: "cola", titulo: "Cola", movil: "dato", claseTd: "text-slate-700", celda: (r) => r.cola ?? <span className="text-slate-400">—</span> },
              { key: "asignado", titulo: "Asignado", movil: "dato", claseTd: "text-slate-700", celda: (r) => r.asignado_nombre ?? <span className="text-slate-400">Sin asignar</span> },
              { key: "por", titulo: "Cerrada por", movil: "dato", claseTh: "whitespace-nowrap", claseTd: "text-slate-700", celda: (r) => r.cerrada_por_nombre ?? "—" },
              {
                key: "cierre",
                titulo: "Cierre",
                movil: "chip",
                celda: (r) =>
                  r.cierre_familia ? (
                    <div className="flex flex-col items-start gap-1 max-md:flex-row max-md:flex-wrap">
                      <span className="rounded-full bg-[#4FAEB2]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[#2F6E71]">{r.cierre_familia}</span>
                      {r.cierre_estado ? <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-600">{r.cierre_estado}</span> : null}
                    </div>
                  ) : (
                    <span className="text-slate-400">—</span>
                  ),
              },
              {
                key: "semaforo",
                titulo: "Últ. msj. asesor",
                movil: "dato",
                claseTh: "whitespace-nowrap",
                celda: (r) => <PillSemaforo r={r} />,
              },
              ...(!seguimientos
                ? [{ key: "prox", titulo: "Próxima acción", movil: "dato" as const, claseTh: "whitespace-nowrap", celda: (r: Finalizada) => <ProximaAccion r={r} hoy={hoy} /> }]
                : []),
              {
                key: "obs",
                titulo: "Observación",
                claseTh: "min-w-[160px]",
                claseTd: "max-w-[220px] truncate text-slate-600",
                celda: (r) => <span title={r.cierre_observacion ?? ""}>{r.cierre_observacion || "—"}</span>,
              },
              {
                key: "etiquetas",
                titulo: "Etiquetas",
                celda: (r) => (
                  <div className="flex max-w-[180px] flex-wrap gap-1 max-md:max-w-none max-md:justify-end">
                    {(r.etiquetas ?? []).length
                      ? (r.etiquetas ?? []).map((e) => (
                          <span key={e} className="rounded-full border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">{e}</span>
                        ))
                      : <span className="text-slate-400">—</span>}
                  </div>
                ),
              },
              {
                key: "primera",
                titulo: "1ª respuesta",
                claseTh: "whitespace-nowrap",
                claseTd: "whitespace-nowrap tabular-nums text-slate-700",
                celda: (r) => (r.primera_respuesta_at ? duracionCorta(segundosEntre(r.created_at, r.primera_respuesta_at)) : <span className="text-[11px] text-amber-700">Sin respuesta</span>),
              },
              {
                key: "acciones",
                titulo: "Acciones",
                movil: "acciones",
                claseTh: "text-right",
                celda: (r) => (
                  <div className="flex flex-wrap items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {r.proxima_accion_fecha && !r.seguimiento_hecho_at ? (
                      <button
                        type="button"
                        disabled={ocupado === `seg:${r.id}`}
                        onClick={() => void hecho(r, true)}
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-[#4FAEB2] bg-[#4FAEB2] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50 max-sm:min-h-11"
                      >
                        {ocupado === `seg:${r.id}` ? <Girando /> : <CalendarCheck className="h-3.5 w-3.5" aria-hidden />} Marcar hecho
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setVisor(r)}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-[#4FAEB2]/50 bg-[#4FAEB2]/8 px-2.5 py-1.5 text-xs font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/15 max-sm:min-h-11"
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden /> Ver chat
                    </button>
                    <button
                      type="button"
                      disabled={ocupado === `reabrir:${r.id}`}
                      onClick={() => void reabrir(r)}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 max-sm:min-h-11"
                    >
                      {ocupado === `reabrir:${r.id}` ? <Girando /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />} Reabrir
                    </button>
                  </div>
                ),
              },
            ]}
          />
        )}
        {!cargando && rows.length ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
            <span className="tabular-nums">
              {rows.length} {seguimientos ? (rows.length === 1 ? "seguimiento" : "seguimientos") : rows.length === 1 ? "conversación" : "conversaciones"}
              {siguiente ? " (hay más)" : ""}
            </span>
            {siguiente ? (
              <button
                type="button"
                onClick={() => void cargarMas()}
                disabled={cargandoMas}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-[#3F8E91] hover:bg-slate-50 disabled:opacity-50 max-sm:min-h-11"
              >
                {cargandoMas ? <Girando /> : null} Cargar más
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {visor ? (
        <VisorChat
          convId={visor.id}
          nombre={visor.contacto_nombre}
          telefono={visor.contacto_telefono}
          detalle={`${telefonoLegible(visor.contacto_telefono)} · cerrada el ${fechaHora(visor.cerrada_at)}`}
          onCerrar={() => setVisor(null)}
          arriba={
            <div className="rounded-2xl border border-[#4FAEB2]/25 bg-white p-4 shadow-[0_1px_3px_rgba(47,110,113,0.08)]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[#4FAEB2]/15 px-3 py-1 text-[13px] font-semibold text-[#2F6E71]">{visor.cierre_familia ?? "Sin estado"}</span>
                {visor.cierre_estado ? <span className="rounded-full bg-slate-100 px-3 py-1 text-[12.5px] text-slate-600">{visor.cierre_estado}</span> : null}
                <PillSemaforo r={visor} />
                <span className="ml-auto text-[11px] text-slate-500">
                  {visor.cerrada_por_nombre ? `Cerró ${visor.cerrada_por_nombre}` : ""}
                  {visor.cola ? ` · ${visor.cola}` : ""}
                  {visor.canal ? ` · ${visor.canal}` : ""}
                </span>
              </div>
              {visor.cierre_observacion ? (
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{visor.cierre_observacion}</p>
              ) : (
                <p className="mt-2 text-sm italic text-slate-400">Sin comentario de cierre.</p>
              )}
              {visor.proxima_accion_fecha ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <ProximaAccion r={visor} hoy={hoy} />
                  {visor.seguimiento_hecho_at ? (
                    <button type="button" disabled={ocupado === `seg:${visor.id}`} onClick={() => void hecho(visor, false)} className="text-xs font-semibold text-slate-500 underline-offset-2 hover:text-[#3F8E91] hover:underline disabled:opacity-50 max-sm:min-h-10">
                      Volver a pendiente
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={ocupado === `seg:${visor.id}`}
                      onClick={() => void hecho(visor, true)}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50 max-sm:min-h-11"
                    >
                      <CalendarCheck className="h-3.5 w-3.5" aria-hidden /> Marcar hecho
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          }
          acciones={
            <button
              type="button"
              disabled={ocupado === `reabrir:${visor.id}`}
              onClick={() => void reabrir(visor)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-sm hover:bg-emerald-100 disabled:opacity-50 max-sm:min-h-11"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reabrir
            </button>
          }
        />
      ) : null}

      {aviso ? (
        <div role="status" className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-1/2 z-[140] w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-xl" style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
          {aviso}
        </div>
      ) : null}
    </div>
  );
}
