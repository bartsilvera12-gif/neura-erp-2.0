"use client";

/**
 * Detalle del proyecto (modal desde el tablero o página /proyectos/[id]), como el actual:
 * cabecera con estado (selector si podés moverlo), SLA del estado que corre solo,
 * archivar / eliminar, y pestañas Resumen · Datos · Tareas · Comentarios · Archivos · Historial.
 *
 * Optimizado: el GET del detalle es liviano; cada pestaña pide sus datos recién la primera
 * vez que se abre y queda montada (volver a ella no la recarga). Los cambios se avisan al
 * tablero para que se actualice sin recargar todo.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, Loader2, Lock, Trash2, X } from "lucide-react";
import { Select } from "@/components/Select";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchCache } from "@/lib/api/cache-cliente";
import { msLaborables } from "@/modules/soporte/dominio";
import {
  BLOQUEO_TIPO_LABEL, HORARIO_DEFECTO, PRIORIDAD_LABEL, estiloPrioridad, fechaCorta, fechaHoraPY, horasTexto, iniciales, monto, pideMotivo,
  type BloqueoTipo, type Detalle, type Estado, type Proyecto, type Tarjeta,
} from "@/modules/proyectos/tipos";
import { Confirmar, EstadoChip, MotivoModal, PANEL, SlaBadge, TituloPanel } from "./comun";
import { useAhora } from "./reloj";
import { TabDatos } from "./TabDatos";
import { TabTareas } from "./TabTareas";
import { TabComentarios } from "./TabComentarios";
import { TabArchivos } from "./TabArchivos";
import { TabHistorial } from "./TabHistorial";

const TABS = [
  ["resumen", "Resumen"],
  ["datos", "Datos"],
  ["tareas", "Tareas"],
  ["comentarios", "Comentarios"],
  ["archivos", "Archivos"],
  ["historial", "Historial"],
] as const;
export type TabId = (typeof TABS)[number][0];

export type MovidoResp = { estado_id?: string; estado_desde?: string; sin_cambios?: boolean };

export function ProyectoDetalle({
  id, variant, estados: estadosProp, preview, tabInicial = "resumen", onClose, onMovido, onGuardado, onEliminado,
}: {
  id: string;
  variant: "modal" | "page";
  estados?: Estado[];
  /** la tarjeta ya cargada en el tablero: pinta la cabecera al instante */
  preview?: Tarjeta | null;
  tabInicial?: TabId;
  onClose: () => void;
  onMovido?: (antes: Tarjeta, estadoId: string, r: MovidoResp & { motivo?: string | null }) => void;
  onGuardado?: (p: Proyecto) => void;
  onEliminado?: (id: string) => void;
}) {
  const [d, setD] = useState<Detalle | null>(null);
  const [estadoCarga, setEstadoCarga] = useState<"cargando" | "ok" | "no">("cargando");
  const [estados, setEstados] = useState<Estado[]>(estadosProp ?? []);
  const [tab, setTab] = useState<TabId>(tabInicial);
  const [visitadas, setVisitadas] = useState<Set<TabId>>(() => new Set([tabInicial]));
  const [version, setVersion] = useState(0); // historial se refresca tras cambios
  const [moviendo, setMoviendo] = useState(false);
  const [pide, setPide] = useState<Estado | null>(null);
  const [confirmar, setConfirmar] = useState<"archivar" | "eliminar" | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await apiFetch<Detalle>(`/api/proyectos/${id}`);
      setD(r);
      setEstadoCarga("ok");
    } catch (e) {
      setError((e as Error).message);
      setEstadoCarga((prev) => (prev === "ok" ? "ok" : "no"));
    }
  }, [id]);

  useEffect(() => {
    setEstadoCarga("cargando");
    void cargar();
  }, [cargar]);

  useEffect(() => {
    if (estadosProp?.length) { setEstados(estadosProp); return; }
    apiFetchCache<Estado[]>("/api/proyectos/estados?activas=1").then(setEstados).catch(() => {});
  }, [estadosProp]);

  const irA = (t: TabId) => {
    setTab(t);
    setVisitadas((prev) => (prev.has(t) ? prev : new Set(prev).add(t)));
  };

  const alGuardar = useCallback((nuevo: Detalle) => {
    setD(nuevo);
    setVersion((v) => v + 1);
    onGuardado?.(nuevo.proyecto);
  }, [onGuardado]);

  async function ejecutarMover(estadoId: string, motivo: string | null) {
    if (!d) return;
    setMoviendo(true);
    setError(null);
    try {
      const antes = d.proyecto;
      const r = await apiFetch<MovidoResp>(`/api/proyectos/${id}/estado`, { method: "POST", body: JSON.stringify({ estado_id: estadoId, motivo }) });
      onMovido?.(antes, estadoId, { ...r, motivo });
      await cargar();
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMoviendo(false);
    }
  }

  function moverA(estadoId: string) {
    if (!d || d.proyecto.estado_id === estadoId || moviendo) return;
    const e = estados.find((x) => x.id === estadoId);
    if (pideMotivo(e)) setPide(e!);
    else void ejecutarMover(estadoId, null);
  }

  async function archivar() {
    if (!d) return;
    setOcupado(true);
    try {
      const r = await apiFetch<Detalle>(`/api/proyectos/${id}`, { method: "PATCH", body: JSON.stringify({ archivado: !d.proyecto.archivado }) });
      alGuardar(r);
      setConfirmar(null);
    } catch (e) {
      setError((e as Error).message);
      setConfirmar(null);
    } finally {
      setOcupado(false);
    }
  }

  async function eliminar() {
    setOcupado(true);
    try {
      await apiFetch(`/api/proyectos/${id}`, { method: "DELETE" });
      setConfirmar(null);
      onEliminado?.(id);
    } catch (e) {
      setError((e as Error).message);
      setConfirmar(null);
      setOcupado(false);
    }
  }

  const p = d?.proyecto;
  const cab = p ?? preview ?? null;
  const estadoActual = d?.estado ?? estados.find((e) => e.id === cab?.estado_id) ?? null;
  const horario = d?.horario ?? HORARIO_DEFECTO;
  const opcionesEstado = useMemo<[string, string][]>(() => {
    const op = estados.map((e) => [e.id, e.nombre] as [string, string]);
    if (d?.estado && !estados.some((e) => e.id === d.estado!.id)) op.unshift([d.estado.id, `${d.estado.nombre} (oculto)`]);
    return op;
  }, [estados, d?.estado]);

  const esModal = variant === "modal";

  return (
    <div className={esModal ? "flex min-h-0 flex-1 flex-col bg-white" : "mx-auto flex max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"}>
      {/* Cabecera */}
      <div className="relative flex shrink-0 flex-col gap-3 border-b border-slate-100 bg-gradient-to-br from-white via-white to-[var(--brand)]/5 px-4 pb-4 pr-14 pt-4 sm:gap-4 sm:pb-5 sm:pt-6 md:px-6 md:pr-16">
        <button type="button" aria-label="Cerrar" title="Cerrar" onClick={onClose}
          className="absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:border-[var(--brand)]/60 hover:text-[var(--brand)] max-sm:h-11 max-sm:w-11 max-sm:border-transparent max-sm:shadow-none sm:right-3 sm:top-3">
          <X className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          {!esModal ? (
            <Link href="/proyectos" className="mb-2 inline-flex text-[12px] font-medium text-[var(--brand)] hover:underline">← Proyectos</Link>
          ) : null}
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--brand)] shadow-[0_0_0_3px_var(--brand-100)]" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--brand)]">Proyecto</p>
            {cab ? <span className="font-mono text-[11px] text-slate-400">{cab.numero}</span> : null}
            {p?.archivado ? <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Archivado</span> : null}
          </div>
          <h1 className="mt-1 text-lg font-semibold leading-snug tracking-tight text-slate-900 [overflow-wrap:anywhere] max-sm:line-clamp-2 sm:truncate sm:text-2xl">{cab?.titulo ?? "Cargando…"}</h1>
          {cab ? (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-slate-500 sm:text-sm">
              <span>{cab.cliente_nombre ?? "Sin cliente asignado"}</span>
              {estadoActual ? <SlaBadge desde={cab.estado_desde} estado={estadoActual} horario={horario} /> : null}
              {cab.bloqueado ? <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700"><Lock className="h-2.5 w-2.5" /> Bloqueado</span> : null}
            </p>
          ) : null}
        </div>
        {d ? (
          <div className="flex flex-wrap items-center gap-2">
            {d.permisos.mover ? (
              <div className="flex items-center gap-2 max-sm:w-full max-sm:[&>*:first-child]:flex-1">
                <Select value={d.proyecto.estado_id} onChange={moverA} options={opcionesEstado} minWidth={200} disabled={moviendo} etiqueta="Mover a" />
                {moviendo ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
              </div>
            ) : estadoActual ? (
              <EstadoChip nombre={estadoActual.nombre} color={estadoActual.color} className="py-1 text-xs" />
            ) : null}
            {d.permisos.editar ? (
              <button type="button" onClick={() => setConfirmar("archivar")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-600 shadow-sm transition-colors hover:border-[var(--brand)]/60 hover:text-[var(--brand)] max-sm:min-h-11 max-sm:flex-1 max-sm:justify-center">
                {d.proyecto.archivado ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                {d.proyecto.archivado ? "Desarchivar" : "Archivar"}
              </button>
            ) : null}
            {d.permisos.eliminar ? (
              <button type="button" onClick={() => setConfirmar("eliminar")} title="Eliminar definitivamente el proyecto (irreversible)"
                className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3.5 py-2.5 text-sm font-medium text-red-600 shadow-sm transition-colors hover:border-red-400 hover:bg-red-50 max-sm:min-h-11 max-sm:flex-1 max-sm:justify-center">
                <Trash2 className="h-4 w-4" /> Eliminar
              </button>
            ) : null}
            {!d.permisos.mover ? (
              <span className="text-[11px] text-slate-400">El estado lo mueven el técnico, el PM o un administrador.</span>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mx-4 mt-4 flex shrink-0 items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-sm text-amber-900 md:mx-6">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Cerrar aviso" className="text-amber-700 hover:text-amber-900"><X className="h-4 w-4" /></button>
        </div>
      ) : null}

      {/* Pestañas */}
      <div className="flex shrink-0 gap-1.5 overflow-x-auto overscroll-x-contain border-b border-slate-100 bg-white px-4 pb-2.5 pt-3 [scrollbar-width:none] sm:pb-3 sm:pt-4 md:flex-wrap md:overflow-visible md:px-6 [&::-webkit-scrollbar]:hidden">
        {TABS.map(([t, label]) => {
          const activa = tab === t;
          const badge = t === "tareas" && cab && cab.tareas_total > 0 ? `${cab.tareas_hechas}/${cab.tareas_total}` : null;
          return (
            <button key={t} type="button" onClick={() => irA(t)}
              className={`relative shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors max-md:min-h-10 ${activa ? "border border-[var(--brand)]/30 bg-[var(--brand)]/10 text-[var(--brand-600)] shadow-sm" : "border border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700"}`}>
              {label}
              {badge ? <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-600">{badge}</span> : null}
            </button>
          );
        })}
      </div>

      <div className={esModal ? "min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-slate-50/50 px-3 py-4 sm:px-4 sm:py-5 md:px-6" : "min-h-[420px] bg-slate-50/50 px-4 py-5 md:px-6"}>
        {estadoCarga === "cargando" && !d ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
        ) : estadoCarga === "no" && !d ? (
          <div className="flex flex-col items-center gap-2 py-16 text-sm">
            <p className="text-rose-600">No se pudo abrir el proyecto.</p>
            <button type="button" onClick={() => { setEstadoCarga("cargando"); setError(null); void cargar(); }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-600 shadow-sm hover:bg-slate-50">Reintentar</button>
          </div>
        ) : d ? (
          <>
            <div hidden={tab !== "resumen"}><Resumen d={d} estado={estadoActual} irA={irA} /></div>
            {visitadas.has("datos") ? <div hidden={tab !== "datos"}><TabDatos d={d} onGuardado={alGuardar} /></div> : null}
            {visitadas.has("tareas") ? (
              <div hidden={tab !== "tareas"}>
                <TabTareas
                  proyectoId={id}
                  puedeEditar={d.permisos.editar}
                  onConteo={(total, hechas) => {
                    setD((prev) => (prev ? { ...prev, proyecto: { ...prev.proyecto, tareas_total: total, tareas_hechas: hechas } } : prev));
                    if (d) onGuardado?.({ ...d.proyecto, tareas_total: total, tareas_hechas: hechas });
                  }}
                />
              </div>
            ) : null}
            {visitadas.has("comentarios") ? <div hidden={tab !== "comentarios"}><TabComentarios proyectoId={id} /></div> : null}
            {visitadas.has("archivos") ? <div hidden={tab !== "archivos"}><TabArchivos proyectoId={id} puedeEditar={d.permisos.editar} /></div> : null}
            {visitadas.has("historial") ? <div hidden={tab !== "historial"}><TabHistorial proyectoId={id} version={version} horario={horario} /></div> : null}
          </>
        ) : null}
      </div>

      {pide && d ? (
        <MotivoModal
          estado={pide}
          proyecto={d.proyecto.titulo}
          onCancel={() => setPide(null)}
          onConfirm={(m) => { const e = pide; setPide(null); void ejecutarMover(e.id, m); }}
        />
      ) : null}
      {confirmar === "archivar" && d ? (
        <Confirmar
          titulo={d.proyecto.archivado ? "Desarchivar proyecto" : "Archivar proyecto"}
          texto={d.proyecto.archivado
            ? "El proyecto vuelve al tablero con los demás."
            : "El proyecto sale del tablero (se ve con el filtro “Archivados”). No se borra nada y se puede desarchivar."}
          accion={d.proyecto.archivado ? "Desarchivar" : "Archivar"}
          ocupado={ocupado}
          onCancel={() => setConfirmar(null)}
          onConfirm={() => void archivar()}
        />
      ) : null}
      {confirmar === "eliminar" && d ? (
        <Confirmar
          titulo="Eliminar proyecto"
          peligro
          texto={<>Se elimina <strong>{d.proyecto.numero} · {d.proyecto.titulo}</strong> con sus tareas, comentarios, archivos e historial. <strong>No se puede deshacer.</strong> Si solo querés sacarlo del tablero, archivalo.</>}
          accion="Eliminar definitivamente"
          ocupado={ocupado}
          onCancel={() => setConfirmar(null)}
          onConfirm={() => void eliminar()}
        />
      ) : null}
    </div>
  );
}

// ── Resumen ──────────────────────────────────────────────────────────────────
function Dato({ etiqueta, children, ancho = false }: { etiqueta: string; children: React.ReactNode; ancho?: boolean }) {
  return (
    <div className={`min-w-0 ${ancho ? "sm:col-span-2" : ""}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-slate-400">{etiqueta}</p>
      <div className="mt-0.5 break-words text-[13.5px] text-slate-800">{children}</div>
    </div>
  );
}

function TileSla({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono: "teal" | "ambar" | "gris" }) {
  const t = tono === "teal" ? "border-[var(--brand)]/25 bg-[var(--brand)]/[0.06] text-[var(--brand-600)]" : tono === "ambar" ? "border-amber-200 bg-amber-50/70 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 ${t}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wide">{etiqueta}</span>
      <span className="text-base font-bold tabular-nums">{valor}</span>
    </div>
  );
}

function Resumen({ d, estado, irA }: { d: Detalle; estado: Estado | null; irA: (t: TabId) => void }) {
  const p = d.proyecto;
  const ahora = useAhora();
  const prio = estiloPrioridad(p.prioridad);
  // SLA acumulado: tramos cerrados + el actual corriendo (horas laborales).
  const vivo = d.tramo_actual && ahora ? (msLaborables(d.tramo_actual.entered_at, new Date(ahora).toISOString(), d.horario) ?? 0) / 3_600_000 : 0;
  const tipoVivo = d.tramo_actual?.tipo_sla;
  const sla = {
    interno: d.sla.interno + (tipoVivo === "interno" ? vivo : 0),
    cliente: d.sla.cliente + (tipoVivo === "cliente" ? vivo : 0),
    pausado: d.sla.pausado + (tipoVivo === "pausado" ? vivo : 0),
  };
  const cancelado = estado?.rol === "cancelado";
  const pausado = estado?.tipo_sla === "pausado";
  const prometidaVencida = !!p.fecha_prometida && !estado?.es_final && !!ahora && Date.parse(p.fecha_prometida) < ahora;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className={`${PANEL} md:col-span-3`}>
        <div className="flex flex-wrap items-start gap-4">
          <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--brand)]/12 text-[13px] font-bold text-[var(--brand-600)]">
            {iniciales(p.cliente_nombre ?? "?")}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-slate-400">Cliente</p>
            {p.cliente_id ? (
              <Link href={`/clientes/${p.cliente_id}`} className="mt-0.5 block text-[15px] font-semibold text-slate-900 hover:text-[var(--brand-600)] hover:underline">{p.cliente_nombre ?? "—"}</Link>
            ) : (
              <p className="mt-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                Este proyecto no tiene un cliente asignado: no aparece en la ficha de ningún cliente. Asignalo desde Datos.
              </p>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-slate-400">Monto vendido</p>
            <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-slate-900">{monto(p.monto_vendido, p.moneda)}</p>
          </div>
        </div>
      </div>

      <div className={`${PANEL} md:col-span-2`}>
        <TituloPanel>Ficha del proyecto</TituloPanel>
        <div className="mt-4 grid gap-x-6 gap-y-3.5 sm:grid-cols-2">
          <Dato etiqueta="Asesor comercial">{p.comercial_nombre ?? "—"}</Dato>
          <Dato etiqueta="Técnico responsable">{p.tecnico_nombre ?? "—"}</Dato>
          <Dato etiqueta="Project Manager">{p.pm_nombre ?? "Sin asignar"}</Dato>
          <Dato etiqueta="Prioridad">
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${prio.badge}`}>{PRIORIDAD_LABEL[p.prioridad] ?? p.prioridad}</span>
          </Dato>
          <Dato etiqueta="Fecha de ingreso">{fechaCorta(p.fecha_ingreso)}</Dato>
          <Dato etiqueta="Fecha prometida">
            {p.fecha_prometida ? <span className={prometidaVencida ? "font-semibold text-rose-600" : ""}>{fechaHoraPY(p.fecha_prometida)}{prometidaVencida ? " · vencida" : ""}</span> : <span className="font-semibold text-amber-600">A definir</span>}
          </Dato>
          {p.fecha_entrega ? <Dato etiqueta="Fecha de entrega">{fechaHoraPY(p.fecha_entrega)}</Dato> : null}
          <Dato etiqueta="Estado">
            {estado ? <EstadoChip nombre={estado.nombre} color={estado.color} /> : "—"}
            <span className="ml-2 text-[11px] text-slate-400">desde {fechaHoraPY(p.estado_desde)}</span>
          </Dato>
          <Dato etiqueta="Creado por">{p.creado_por_nombre ?? "—"} <span className="text-[11px] text-slate-400">· {fechaCorta(p.created_at)}</span></Dato>
          <Dato etiqueta="Tareas">
            {p.tareas_total > 0 ? (
              <button type="button" onClick={() => irA("tareas")} className="w-full text-left">
                <span className="text-[12px] text-slate-600">{p.tareas_hechas} de {p.tareas_total} completadas</span>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <span className="block h-full rounded-full bg-[var(--brand)]" style={{ width: `${Math.round((p.tareas_hechas / p.tareas_total) * 100)}%` }} />
                </span>
              </button>
            ) : (
              <button type="button" onClick={() => irA("tareas")} className="text-[12px] font-medium text-[var(--brand-600)] hover:underline">Sin tareas · agregar</button>
            )}
          </Dato>
        </div>
      </div>

      <div className={PANEL}>
        <TituloPanel>SLA acumulado</TituloPanel>
        <p className="mt-1 text-[11px] text-slate-400">Horas laborales por tipo de estado.</p>
        <div className="mt-3 space-y-2">
          <TileSla etiqueta="Tiempo interno" valor={horasTexto(sla.interno)} tono="teal" />
          <TileSla etiqueta="Espera cliente" valor={horasTexto(sla.cliente)} tono="ambar" />
          <TileSla etiqueta="Pausado" valor={horasTexto(sla.pausado)} tono="gris" />
        </div>
        {estado && !estado.es_final ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            Estado actual: <SlaBadge desde={p.estado_desde} estado={estado} horario={d.horario} />
          </div>
        ) : null}
      </div>

      {p.bloqueado || pausado || cancelado ? (
        <div className={`${PANEL} md:col-span-3 ${cancelado ? "" : "border-amber-200 bg-amber-50/40"}`}>
          <TituloPanel>{cancelado ? "Motivo de la cancelación" : p.bloqueado ? "Proyecto bloqueado" : "Motivo de la pausa"}</TituloPanel>
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <Dato etiqueta="Motivo" ancho>
              {(cancelado ? p.cancelacion_motivo : p.bloqueado ? p.bloqueo_motivo : p.pausa_motivo) || <span className="italic text-slate-400">Sin cargar</span>}
            </Dato>
            {p.bloqueado && !cancelado ? (
              <>
                <Dato etiqueta="Tipo de bloqueo">{p.bloqueo_tipo ? BLOQUEO_TIPO_LABEL[p.bloqueo_tipo as BloqueoTipo] : "—"}</Dato>
                <Dato etiqueta="Quién lo destraba">{p.bloqueo_responsable || "—"}</Dato>
                <Dato etiqueta="Próxima acción" ancho>{p.bloqueo_proxima_accion || "—"}</Dato>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={`${PANEL} md:col-span-3`}>
        <TituloPanel>Descripción</TituloPanel>
        {p.descripcion ? (
          <p className="mt-3 whitespace-pre-line break-words text-sm leading-relaxed text-slate-700">{p.descripcion}</p>
        ) : (
          <p className="mt-3 text-sm italic text-slate-400">Sin descripción. Cargala desde Datos.</p>
        )}
      </div>
    </div>
  );
}
