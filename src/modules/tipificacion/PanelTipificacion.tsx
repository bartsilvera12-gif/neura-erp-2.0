"use client";

/**
 * Tipificar a un cliente SIN salir de donde estás. Lo usan el modal (Gestión del Cliente, la
 * ficha, el registro de tipificaciones) y la página /clientes/[id]/tipificacion (respaldo
 * para enlaces directos). Mismas reglas de siempre:
 *   · Estado → Sub-estado (en UN buscador). Según la ACCIÓN del sub-estado:
 *     - ticket_error / ticket_cambio: clasificación (con su SLA; la prioridad sale de la
 *       clasificación), se asigna al responsable por defecto de Soporte, evidencias (se suben
 *       DESPUÉS de crear el ticket). Tipificación + ticket en UNA transacción.
 *     - capacitacion: agendarla (inicio, duración, quién la da, lugar) dentro del horario
 *       laboral; el servidor bloquea choques con otras citas del capacitador (409).
 *   · Al lado (abajo en celular, pestaña "Historial"), las tipificaciones del cliente con el
 *     estado en vivo del ticket o de la cita.
 * Rápido: el catálogo y el resto del contexto vienen cacheados (precarga al pasar el mouse),
 * el historial se muestra al instante si ya se vio, el foco arranca en el buscador del motivo,
 * Ctrl+Enter guarda, Esc cierra (en el modal) y lo escrito queda como borrador por cliente.
 * Al guardar, la fila nueva se suma al historial en el lugar (sin recargar todo).
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarCheck, ClipboardPen, GraduationCap, Headset, History, Paperclip, Send, Timer, UserRound, X,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchSWR, guardadoAlInstante } from "@/lib/api/cache-cliente";
import { Select } from "@/components/Select";
import { SelectorFechaHora } from "@/components/SelectorFecha";
import { BadgeEstado, CodigoChip, TEAL, codigoCliente, estadoDe } from "@/modules/clientes/ui";
import {
  DURACIONES, fechaHoraPy, mensajeHorario, numeroTicket, rangoEnHorarioLaboral, textoDuracion, textoHorario, tonoSla,
  vencimientoSla, type AltaTipificacion, type ContextoTipificacion, type HistorialTipificaciones, type TipificacionRegistro,
} from "@/modules/tipificacion/dominio";
import {
  borrarBorrador, cargarContexto, contextoAlInstante, guardarBorrador, invalidarCliente, leerBorrador, urlHistorial,
} from "@/modules/tipificacion/datos";
import { ElegirSubestado, type ElegirSubestadoRef } from "@/modules/tipificacion/ElegirSubestado";
import { HistorialEsqueleto, ItemTipificacion } from "@/modules/tipificacion/ItemTipificacion";
import { subirArchivos } from "@/modules/tipificacion/archivos";
import { ZonaArchivos } from "@/modules/tipificacion/ZonaArchivos";
import { ModalTicketResumen } from "@/modules/tipificacion/ModalTicketResumen";

const claseInput =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13.5px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15";
const claseEtiqueta = "mb-1.5 block text-[12.5px] font-semibold text-slate-600";
const TONO_SLA = {
  rosa: { suave: "bg-rose-50", texto: "text-rose-700", borde: "border-rose-300", solido: "bg-rose-500" },
  ambar: { suave: "bg-amber-50", texto: "text-amber-700", borde: "border-amber-300", solido: "bg-amber-500" },
  verde: { suave: "bg-emerald-50", texto: "text-emerald-700", borde: "border-emerald-300", solido: "bg-emerald-500" },
} as const;

type Agenda = { inicio: string; duracion_min: number; responsable_id: string; ubicacion: string };
const AGENDA_VACIA: Agenda = { inicio: "", duracion_min: 60, responsable_id: "", ubicacion: "" };

export type ResultadoGuardado = { alta: AltaTipificacion; mensaje: string; aviso: string | null };

export function PanelTipificacion({ clienteId, clienteNombre, modo, resaltar, onGuardada, onCerrar }: {
  clienteId: string;
  /** para pintar el encabezado antes de que llegue el historial */
  clienteNombre?: string;
  modo: "modal" | "pagina";
  /** tipificación a resaltar en el historial (llegada desde un ticket: #tip-<id>) */
  resaltar?: string | null;
  /** se guardó: en el modal, quien lo abrió lo cierra y muestra el aviso */
  onGuardada?: (r: ResultadoGuardado) => void;
  onCerrar?: () => void;
}) {
  const enModal = modo === "modal";
  const [ctx, setCtx] = useState<ContextoTipificacion | null>(() => contextoAlInstante());
  const [ctxError, setCtxError] = useState<string | null>(null);
  const [hist, setHist] = useState<HistorialTipificaciones | null>(() => guardadoAlInstante<HistorialTipificaciones>(urlHistorial(clienteId)) ?? null);
  const [histError, setHistError] = useState<string | null>(null);
  const [vista, setVista] = useState<"nueva" | "historial">(resaltar ? "historial" : "nueva");

  // Formulario (con borrador recuperado, si había).
  const [borradorInicial] = useState(() => (typeof window === "undefined" ? null : leerBorrador(clienteId)));
  const [estadoId, setEstadoId] = useState(borradorInicial?.estadoId ?? "");
  const [subestadoId, setSubestadoId] = useState(borradorInicial?.subestadoId ?? "");
  const [observacion, setObservacion] = useState(borradorInicial?.observacion ?? "");
  const [clasificacion, setClasificacion] = useState(borradorInicial?.clasificacion ?? "");
  const [agendar, setAgendar] = useState(borradorInicial?.agendar ?? true);
  const [agenda, setAgenda] = useState<Agenda>(borradorInicial?.agenda ?? AGENDA_VACIA);
  const [archivos, setArchivos] = useState<File[]>([]);
  const [recuperado, setRecuperado] = useState(!!borradorInicial);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<{ texto: string; ticket: { id: string; numero: number } | null } | null>(null);
  const [resaltada, setResaltada] = useState<string | null>(resaltar ?? null);
  const [verTicket, setVerTicket] = useState<string | null>(null);
  const picker = useRef<ElegirSubestadoRef>(null);
  const texto = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const avisoExito = useRef<HTMLDivElement>(null);

  // Guardado: el aviso (con "Ver ticket") queda arriba del formulario; se trae a la vista
  // porque en celular el botón Guardar está lejos y el aviso quedaba fuera de pantalla.
  useEffect(() => {
    if (!exito) return;
    const t = window.setTimeout(() => avisoExito.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 30);
    return () => window.clearTimeout(t);
  }, [exito]);

  // Contexto (cacheado 5 min) e historial (lo último visto al instante + refresco atrás), en paralelo.
  useEffect(() => {
    let vivo = true;
    cargarContexto().then((d) => { if (vivo) { setCtx(d); setCtxError(null); } })
      .catch((e) => { if (vivo) setCtxError((e as Error).message || "No se pudo cargar el catálogo"); });
    return () => { vivo = false; };
  }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    apiFetchSWR<HistorialTipificaciones>(urlHistorial(clienteId), (d) => { setHist(d); setHistError(null); }, { signal: ctrl.signal, maxEdadMs: 10_000 })
      .catch((e) => { if (!ctrl.signal.aborted) setHistError((e as Error).message || "No se pudo cargar el historial"); });
    return () => ctrl.abort();
  }, [clienteId]);

  // Foco: en el buscador del motivo, o en el texto si el borrador ya traía el motivo.
  const enfocado = useRef(false);
  useEffect(() => {
    if (!ctx || enfocado.current || vista !== "nueva") return;
    enfocado.current = true;
    const t = window.setTimeout(() => {
      if (subestadoId) texto.current?.focus({ preventScroll: true });
      else picker.current?.enfocar();
    }, enModal ? 60 : 0);
    return () => window.clearTimeout(t);
  }, [ctx, vista, subestadoId, enModal]);

  // Resaltado de la llegada desde un ticket.
  useEffect(() => {
    if (!resaltada || !hist) return;
    const t = window.setTimeout(() => document.getElementById(`tip-${resaltada}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 80);
    return () => window.clearTimeout(t);
  }, [resaltada, hist]);

  // Borrador: lo escrito queda guardado por cliente (si se cierra por error, vuelve).
  useEffect(() => {
    const t = window.setTimeout(() => guardarBorrador(clienteId, { estadoId, subestadoId, observacion, clasificacion, agendar, agenda }), 250);
    return () => window.clearTimeout(t);
  }, [clienteId, estadoId, subestadoId, observacion, clasificacion, agendar, agenda]);

  const estadoElegido = ctx?.familias.find((e) => e.id === estadoId) ?? null;
  const subElegido = estadoElegido?.subestados.find((s) => s.id === subestadoId) ?? null;
  const comp = subElegido?.comportamiento ?? "";
  const tipoTicket = comp === "ticket_error" ? "error" : comp === "ticket_cambio" ? "cambio" : null;
  const esTicket = tipoTicket != null;
  const esCambio = tipoTicket === "cambio";
  const esCapacitacion = comp === "capacitacion";
  const horario = ctx?.horario;

  const clasificaciones = useMemo(() => (ctx?.clasificaciones ?? []).filter((c) => c.tipo_codigo === tipoTicket), [ctx, tipoTicket]);
  const clasElegida = clasificaciones.find((c) => c.codigo === clasificacion) ?? null;
  const slaHoras = clasElegida ? Number(clasElegida.sla_horas) : null;
  const entrega = slaHoras != null ? vencimientoSla(Date.now(), slaHoras, horario) : null;
  const prioridad = clasElegida ? ctx?.prioridades.find((p) => p.codigo === (clasElegida.prioridad_sugerida || "normal")) ?? null : null;

  const capacitador = agenda.responsable_id || ctx?.usuario_actual.id || "";
  const inicioMs = agenda.inicio ? Date.parse(`${agenda.inicio}:00-03:00`) : NaN;
  const enHorario = rangoEnHorarioLaboral(inicioMs, inicioMs + agenda.duracion_min * 60_000, horario);

  const limpiarAvisos = () => { setError(null); setExito(null); };
  function elegir(fam: string, sub: string) {
    limpiarAvisos();
    setEstadoId(fam);
    setSubestadoId(sub);
    setClasificacion("");
    window.setTimeout(() => texto.current?.focus({ preventScroll: false }), 0);
  }

  function reiniciar() {
    setObservacion("");
    setEstadoId("");
    setSubestadoId("");
    setClasificacion("");
    setArchivos([]);
    setAgendar(true);
    setAgenda(AGENDA_VACIA);
    setRecuperado(false);
  }
  function descartarBorrador() {
    borrarBorrador(clienteId);
    reiniciar();
    picker.current?.enfocar();
  }

  const guardar = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (guardando) return;
    limpiarAvisos();
    if (!estadoId || !subestadoId) { picker.current?.enfocar(); return setError("Elegí el motivo (estado y sub-estado)."); }
    if (!observacion.trim()) { texto.current?.focus(); return setError("La observación es obligatoria."); }
    if (esCapacitacion && agendar && !agenda.inicio) return setError("Elegí fecha y hora de la capacitación, o desmarcá “Agendar”.");
    if (esCapacitacion && agendar && !enHorario) return setError(mensajeHorario(horario));
    if (esTicket) {
      if (!ctx?.puede_soporte) return setError("Tu usuario no puede cargar tickets de Soporte.");
      if (clasificaciones.length && !clasificacion) return setError("Completá: clasificación del ticket.");
    }

    setGuardando(true);
    try {
      const alta = await apiFetch<AltaTipificacion>(`/api/clientes/${clienteId}/tipificaciones`, {
        method: "POST",
        body: JSON.stringify({
          estado_id: estadoId,
          subestado_id: subestadoId,
          observacion: observacion.trim(),
          ...(esTicket ? { ticket: { clasificacion_codigo: clasificacion } } : {}),
          ...(esCapacitacion && agendar ? { agenda: { ...agenda, responsable_id: capacitador } } : {}),
        }),
      });
      // El ticket ya existe: si una evidencia falla se avisa (se puede volver a subir desde el ticket).
      let aviso: string | null = null;
      if (alta.ticket && archivos.length) {
        const s = await subirArchivos(alta.ticket.id, archivos);
        if (s.errores.length) aviso = `${s.errores.length} archivo(s) no se subieron: ${s.errores.join(" · ")}`;
      }
      const mensaje = alta.ticket
        ? `Tipificación guardada · Ticket ${numeroTicket(alta.ticket.numero)} creado`
        : alta.cita_id && agenda.inicio
          ? `Tipificación guardada · capacitación el ${agenda.inicio.slice(8, 10)}/${agenda.inicio.slice(5, 7)} a las ${agenda.inicio.slice(11, 16)}`
          : "Tipificación guardada";

      // El historial se actualiza en el lugar con la fila que devolvió el servidor.
      invalidarCliente(clienteId);
      if (alta.fila) {
        const fila: TipificacionRegistro = alta.fila;
        setHist((h) => h ? { ...h, total: h.total + 1, tipificaciones: [fila, ...h.tipificaciones.filter((x) => x.id !== fila.id)] } : h);
        setResaltada(fila.id);
      }
      borrarBorrador(clienteId);
      reiniciar();
      if (onGuardada) onGuardada({ alta, mensaje, aviso });
      else {
        setExito({ texto: aviso ? `${mensaje}. ${aviso}` : mensaje, ticket: alta.ticket });
        picker.current?.enfocar();
      }
    } catch (err) {
      setError((err as Error).message || (esTicket ? "No se pudo crear el ticket. No se guardó la tipificación." : "Error al guardar la tipificación."));
    } finally {
      setGuardando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardando, estadoId, subestadoId, observacion, esCapacitacion, agendar, agenda, enHorario, horario, esTicket, ctx, clasificaciones, clasificacion, clienteId, archivos, capacitador, onGuardada]);

  // Ctrl/⌘ + Enter guarda desde cualquier campo.
  function onKeyDownForm(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void guardar(); }
  }

  const cliente = hist?.cliente ?? null;
  const nombre = cliente?.nombre ?? clienteNombre ?? "";
  const tipificaciones = hist?.tipificaciones ?? [];
  const puedeEnviar = !guardando && !!ctx && (!esTicket || ctx.puede_soporte);
  const esAdmin = !!ctx?.es_admin;

  // ── Encabezado ──────────────────────────────────────────────────────────
  const encabezado = (
    <div className="flex shrink-0 items-start gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700"><ClipboardPen className="h-[18px] w-[18px]" aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: TEAL }}>Tipificación</p>
        <h2 className="truncate text-[15px] font-bold text-slate-900 sm:text-base">{nombre || <span className="inline-block h-4 w-48 animate-pulse rounded bg-slate-200 align-middle" />}</h2>
        {cliente ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-slate-500">
            <CodigoChip codigo={codigoCliente(cliente)} fondo="bg-white" />
            {cliente.ruc || cliente.documento ? <span>RUC {cliente.ruc || cliente.documento}</span> : null}
            {cliente.telefono ? <span className="max-sm:hidden">{cliente.telefono}</span> : null}
            <BadgeEstado estado={estadoDe(cliente)} />
          </div>
        ) : null}
      </div>
      {enModal && onCerrar ? (
        <button type="button" aria-label="Cerrar" onClick={onCerrar} title="Cerrar (Esc). Lo escrito queda como borrador."
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
          <X className="h-5 w-5" />
        </button>
      ) : null}
    </div>
  );

  // ── Pestañas (celular y tablet) ─────────────────────────────────────────
  const pestanas = (
    <div role="tablist" aria-label="Tipificación" className="flex shrink-0 gap-1 border-b border-slate-100 bg-slate-50/60 p-1.5 lg:hidden">
      {([["nueva", "Nueva", ClipboardPen], ["historial", `Historial${hist ? ` (${hist.total})` : ""}`, History]] as const).map(([k, l, Icono]) => (
        <button key={k} type="button" role="tab" aria-selected={vista === k} onClick={() => setVista(k)}
          className={`inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold transition ${vista === k ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-700"}`}>
          <Icono className="h-4 w-4" aria-hidden /> {l}
        </button>
      ))}
    </div>
  );

  // ── Formulario ──────────────────────────────────────────────────────────
  const cuerpoForm = (
    <div className="space-y-5 px-4 py-4 sm:px-5">
      {recuperado ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
          <span>Recuperamos lo que estabas escribiendo para este cliente.</span>
          <button type="button" onClick={descartarBorrador} className="rounded-lg px-2 py-1 font-semibold hover:bg-amber-100 max-sm:min-h-11">Descartar</button>
        </div>
      ) : null}
      {exito ? (
        <div ref={avisoExito} className="flex scroll-mt-20 flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[13px] font-semibold text-emerald-800" role="status">
          <span>✓ {exito.texto}</span>
          {exito.ticket ? (
            <button type="button" onClick={() => setVerTicket(exito.ticket!.id)} className="rounded-lg bg-white px-2.5 py-1 text-[12px] font-semibold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50 max-sm:min-h-11">
              Ver ticket {numeroTicket(exito.ticket.numero)}
            </button>
          ) : null}
        </div>
      ) : null}

      <div>
        <span className={claseEtiqueta}>Motivo <span className="text-rose-500">*</span></span>
        {ctxError ? (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{ctxError}</p>
        ) : !ctx ? (
          <div className="space-y-2" aria-hidden>
            <div className="h-11 animate-pulse rounded-xl bg-slate-200/70" />
            <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
          </div>
        ) : ctx.familias.length === 0 ? (
          <p className="text-sm text-slate-500">
            No hay estados de tipificación cargados.{" "}
            {esAdmin ? <Link href="/clientes/tipificaciones?vista=catalogo" className="font-semibold underline" style={{ color: TEAL }}>Configuralos</Link> : "Pedile a un administrador que los configure."}
          </p>
        ) : (
          <ElegirSubestado ref={picker} familias={ctx.familias} estadoId={estadoId} subestadoId={subestadoId} onElegir={elegir} deshabilitado={guardando} />
        )}
        {esTicket ? <p className="mt-1.5 text-[11.5px] font-semibold text-rose-600">Este motivo crea un ticket de Soporte ({esCambio ? "cambio" : "error"}).</p> : null}
        {esCapacitacion ? <p className="mt-1.5 text-[11.5px] font-semibold text-indigo-600">Este motivo agenda una capacitación.</p> : null}
      </div>

      {/* ── Ticket de Soporte (inline) ── */}
      {esTicket && ctx ? (
        !ctx.puede_soporte ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
            Tu usuario no puede cargar tickets de Soporte (lo pueden los administradores y quienes usan Soporte). Pedíselo a un administrador.
          </div>
        ) : (
          <div className="space-y-3 rounded-2xl border border-rose-200/70 bg-rose-50/30 p-3.5 sm:p-4">
            <p className="flex items-center gap-2 text-[13px] font-bold text-slate-800"><Headset className="h-4 w-4 text-rose-600" aria-hidden /> Ticket de Soporte</p>
            <div>
              <span className={claseEtiqueta}>Clasificación <span className="text-rose-500">*</span></span>
              {clasificaciones.length === 0 ? (
                <p className="text-[12.5px] text-slate-400">No hay clasificaciones de {esCambio ? "cambio" : "error"} configuradas en Soporte.</p>
              ) : (
                <div role="radiogroup" aria-label="Clasificación" className="grid gap-2 sm:grid-cols-3">
                  {clasificaciones.map((c) => {
                    const t = TONO_SLA[tonoSla(c.sla_horas)];
                    const activa = clasificacion === c.codigo;
                    return (
                      <button key={c.codigo} type="button" role="radio" aria-checked={activa} onClick={() => { setError(null); setClasificacion(c.codigo); }}
                        className={`relative flex min-h-11 items-center justify-between overflow-hidden rounded-xl border px-3.5 py-2 text-left transition ${activa ? `${t.borde} ${t.suave} shadow-sm` : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`}>
                        <span className={`absolute inset-y-0 left-0 w-1 ${activa ? t.solido : "bg-transparent"}`} aria-hidden />
                        <span className={`text-[13px] font-bold ${activa ? t.texto : "text-slate-800"}`}>{c.nombre}</span>
                        <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-slate-500"><Timer className="h-3.5 w-3.5" aria-hidden /> {c.sla_horas} h</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-2 text-[12.5px] sm:grid-cols-3">
              <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200/70">
                <dt className="text-[11px] text-slate-500">Prioridad</dt>
                <dd className="font-semibold text-slate-800">{prioridad?.nombre ?? <span className="font-normal text-slate-400">Según clasificación</span>}</dd>
              </div>
              <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200/70">
                <dt className="text-[11px] text-slate-500">Entrega (SLA)</dt>
                <dd className="font-semibold text-slate-800">{entrega ? <span className="inline-flex items-center gap-1"><CalendarCheck className="h-3.5 w-3.5 text-rose-500" aria-hidden />{fechaHoraPy(entrega)}</span> : <span className="font-normal text-slate-400">—</span>}</dd>
              </div>
              <div className="col-span-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200/70 sm:col-span-1">
                <dt className="text-[11px] text-slate-500">Se asigna a</dt>
                <dd className="flex items-center gap-1 font-semibold text-slate-800"><UserRound className="h-3.5 w-3.5 text-slate-400" aria-hidden />{ctx.responsable_defecto?.nombre ?? <span className="font-normal text-slate-400">Sin responsable</span>}</dd>
              </div>
            </dl>
            <p className="text-[11.5px] text-slate-500">Entra como Pendiente. La descripción del ticket es la observación de abajo (el asunto, su primera línea).</p>
          </div>
        )
      ) : null}

      <div>
        <label htmlFor={`obs-${clienteId}`} className={claseEtiqueta}>
          {esTicket ? (esCambio ? "Detalles del cambio" : "Detalles del error") : "Observación"} <span className="text-rose-500">*</span>
        </label>
        <textarea
          id={`obs-${clienteId}`}
          ref={texto}
          value={observacion}
          onChange={(e) => { limpiarAvisos(); setObservacion(e.target.value); }}
          rows={4}
          maxLength={5000}
          placeholder={esCambio ? "Qué hay que cambiar, cómo debería quedar…" : esTicket ? "Qué pasa, desde cuándo, qué mensaje aparece…" : "Describí la gestión realizada con el cliente…"}
          className={`${claseInput} resize-y leading-relaxed`}
        />
      </div>

      {esTicket && ctx?.puede_soporte ? (
        <div>
          <span className={`${claseEtiqueta} flex items-center gap-1.5`}><Paperclip className="h-3.5 w-3.5" aria-hidden /> Evidencias <span className="font-normal text-slate-400">(quedan en el ticket)</span></span>
          <ZonaArchivos archivos={archivos} onCambio={setArchivos} deshabilitada={guardando} />
        </div>
      ) : null}

      {/* ── Capacitación (inline) ── */}
      {esCapacitacion ? (
        <div className="space-y-4 rounded-2xl border border-indigo-200/70 bg-indigo-50/30 p-3.5 sm:p-4">
          <label className="flex w-fit cursor-pointer items-center gap-2.5 text-[13px] font-bold text-slate-800 max-sm:min-h-11">
            <input type="checkbox" checked={agendar} onChange={(e) => setAgendar(e.target.checked)} className="h-4 w-4 [@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:w-6" style={{ accentColor: TEAL }} />
            <GraduationCap className="h-4 w-4 text-indigo-600" aria-hidden /> Agendar la capacitación ahora
          </label>
          {agendar ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <span className={claseEtiqueta}>Fecha y hora <span className="text-rose-500">*</span></span>
                <SelectorFechaHora block etiqueta="Fecha y hora de la capacitación" value={agenda.inicio} onChange={(v) => { setError(null); setAgenda((a) => ({ ...a, inicio: v })); }} />
                <p className={`mt-1 text-[11.5px] ${agenda.inicio && !enHorario ? "font-semibold text-amber-600" : "text-slate-400"}`}>
                  {agenda.inicio && !enHorario ? `Fuera de horario: ${textoHorario(horario)}.` : `Horario laboral: ${textoHorario(horario)}.`}
                </p>
              </div>
              <div>
                <span className={claseEtiqueta}>Duración</span>
                <div role="radiogroup" aria-label="Duración" className="flex flex-wrap gap-2">
                  {DURACIONES.map((m) => {
                    const activa = agenda.duracion_min === m;
                    return (
                      <button key={m} type="button" role="radio" aria-checked={activa} onClick={() => setAgenda((a) => ({ ...a, duracion_min: m }))}
                        className={`rounded-xl border px-3.5 py-2 text-[13px] font-semibold transition max-sm:min-h-11 ${activa ? "border-indigo-300 bg-indigo-50 text-indigo-700 shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"}`}>
                        {textoDuracion(m)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <span className={claseEtiqueta}>Quién la da</span>
                <Select block etiqueta="Quién da la capacitación" value={capacitador} onChange={(v) => setAgenda((a) => ({ ...a, responsable_id: v }))}
                  options={(ctx?.equipo ?? []).map((p): [string, string] => [p.id, p.nombre])} />
              </div>
              <div>
                <label htmlFor={`lugar-${clienteId}`} className={claseEtiqueta}>Lugar o enlace</label>
                <input id={`lugar-${clienteId}`} className={claseInput} value={agenda.ubicacion} maxLength={500} onChange={(e) => setAgenda((a) => ({ ...a, ubicacion: e.target.value }))} placeholder="Ej.: Google Meet, oficina del cliente…" />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const pie = (
    <div className={`shrink-0 border-t border-slate-100 bg-white px-4 py-3 sm:px-5 ${enModal ? "" : "max-lg:sticky max-lg:bottom-0 max-lg:z-10"}`}>
      {error ? <p className="mb-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] font-medium text-rose-700" role="alert">{error}</p> : null}
      <div className="flex items-center gap-2">
        <p className="mr-auto hidden text-[11.5px] text-slate-400 sm:block">
          {ctx ? <>Se registra como <span className="font-semibold text-slate-600">{ctx.usuario_actual.nombre}</span> · </> : null}
          <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-sans">Ctrl</kbd>+<kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-sans">Enter</kbd> guarda
        </p>
        {enModal && onCerrar ? (
          <button type="button" onClick={onCerrar} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 sm:min-h-10 max-sm:hidden">Cancelar</button>
        ) : null}
        <button type="submit" disabled={!puedeEnviar}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-[14px] font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 max-sm:flex-1 sm:min-h-10"
          style={{ backgroundColor: TEAL }}>
          {esTicket ? <Headset className="h-4 w-4" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
          {guardando ? (esTicket ? "Creando ticket…" : "Guardando…") : esTicket ? "Guardar y crear ticket" : "Guardar tipificación"}
        </button>
      </div>
    </div>
  );

  // ── Historial ───────────────────────────────────────────────────────────
  const historial = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 max-lg:hidden">
        <p className="flex items-center gap-2 text-[13px] font-bold text-slate-700"><History className="h-4 w-4 text-indigo-500" aria-hidden /> Historial del cliente</p>
        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold tabular-nums text-indigo-700">{hist ? hist.total : "…"}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {histError && !hist ? <p className="m-4 rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{histError}</p> : null}
        {!hist && !histError ? <HistorialEsqueleto /> : null}
        {hist && tipificaciones.length === 0 ? <p className="px-4 py-12 text-center text-[13px] text-slate-400">Todavía no hay tipificaciones de este cliente.</p> : null}
        {tipificaciones.length ? (
          <ol className="divide-y divide-slate-100">
            {tipificaciones.map((t) => (
              <ItemTipificacion key={t.id} t={t} compacta resaltada={resaltada === t.id} puedeSoporte={ctx?.puede_soporte} onVerTicket={setVerTicket} />
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );

  const raiz = enModal
    ? `flex w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl modal-alto max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3rem)] max-sm:h-[calc(var(--capa-alto,100dvh)-max(0.75rem,env(safe-area-inset-top)))] sm:h-[min(820px,calc(100dvh-3rem))]`
    : "flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm max-lg:overflow-visible lg:h-[max(560px,calc(100dvh-11rem))]";

  return (
    <div role={enModal ? "dialog" : undefined} aria-modal={enModal || undefined} aria-label={enModal ? `Tipificación · ${nombre}` : undefined}
      className={raiz} style={enModal ? { animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" } : undefined}>
      {encabezado}
      {pestanas}
      <div className="flex min-h-0 flex-1">
        <form ref={form} onSubmit={guardar} onKeyDown={onKeyDownForm} noValidate
          className={`min-h-0 min-w-0 flex-1 flex-col ${vista === "nueva" ? "flex" : "hidden lg:flex"}`}>
          <div className={`min-h-0 flex-1 ${enModal ? "overflow-y-auto overscroll-contain" : "lg:overflow-y-auto lg:overscroll-contain"}`}>{cuerpoForm}</div>
          {pie}
        </form>
        <aside className={`min-h-0 flex-col bg-slate-50/40 lg:flex lg:w-[380px] lg:shrink-0 lg:border-l lg:border-slate-100 xl:w-[420px] ${vista === "historial" ? "flex flex-1 lg:flex-none" : "hidden"}`} aria-label="Historial de tipificaciones">
          {historial}
        </aside>
      </div>
      {verTicket ? <ModalTicketResumen ticketId={verTicket} onClose={() => setVerTicket(null)} /> : null}
    </div>
  );
}
