"use client";

/**
 * Tipificación del cliente (portada tal cual del sistema actual).
 *
 * Gestión de clientes › <CLIENTE> › Tipificación. Se elige Estado → Sub-estado y se cargan
 * los detalles. Según la ACCIÓN del sub-estado:
 *   · ticket_error / ticket_cambio: clasificación (con su SLA en horas; la prioridad sale de
 *     la clasificación), a quién se asigna (responsable por defecto de Soporte), evidencias
 *     (se suben DESPUÉS de crear el ticket) y el resumen con el Service level.
 *   · capacitacion: agendarla (inicio, duración, quién la da, lugar), avisando si queda fuera
 *     del horario laboral; el servidor bloquea choques con otras citas del capacitador (409).
 * Abajo, el historial con el estado en vivo del ticket (#0001) o de la cita.
 */
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarCheck, CircleCheckBig, ClipboardPen, ExternalLink, GraduationCap, Headset, History, Mail, Paperclip,
  Phone, Send, Settings2, Timer, UserRound, X, type LucideIcon,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchCache, invalidar } from "@/lib/api/cache-cliente";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { Avatar, CodigoChip, TEAL, codigoCliente } from "@/modules/clientes/ui";
import {
  DURACIONES, estadoCita, fechaHoraPy, mensajeHorario, numeroTicket, rangoEnHorarioLaboral, textoDuracion, textoHorario,
  tonoSla, vencimientoSla, type EstadoCat, type ListadoTipificaciones,
} from "@/modules/tipificacion/dominio";
import { subirArchivos } from "@/modules/tipificacion/archivos";
import { ZonaArchivos } from "@/modules/tipificacion/ZonaArchivos";

// ── Estilos ──────────────────────────────────────────────────────────────────
type Tono = "rosa" | "ambar" | "verde" | "indigo" | "turquesa" | "pizarra";
const TONOS: Record<Tono, { suave: string; texto: string; borde: string; solido: string }> = {
  rosa: { suave: "bg-rose-50", texto: "text-rose-700", borde: "border-rose-300", solido: "bg-rose-500" },
  ambar: { suave: "bg-amber-50", texto: "text-amber-700", borde: "border-amber-300", solido: "bg-amber-500" },
  verde: { suave: "bg-emerald-50", texto: "text-emerald-700", borde: "border-emerald-300", solido: "bg-emerald-500" },
  indigo: { suave: "bg-indigo-50", texto: "text-indigo-700", borde: "border-indigo-300", solido: "bg-indigo-500" },
  turquesa: { suave: "bg-teal-50", texto: "text-teal-700", borde: "border-teal-300", solido: "bg-teal-500" },
  pizarra: { suave: "bg-slate-100", texto: "text-slate-600", borde: "border-slate-300", solido: "bg-slate-500" },
};
const claseInput =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13.5px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15";
const claseEtiqueta = "mb-1.5 block text-[12.5px] font-semibold text-slate-600";
const sombra = "shadow-[0_1px_3px_rgba(15,23,42,0.05),0_8px_24px_-12px_rgba(15,23,42,0.08)]";

function IconoTile({ icono: Icono, tono }: { icono: LucideIcon; tono: Tono }) {
  return (
    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${TONOS[tono].suave} ${TONOS[tono].texto}`}>
      <Icono className="h-[18px] w-[18px]" aria-hidden />
    </span>
  );
}

function Seccion({ titulo, detalle, icono, tono, children }: { titulo: string; detalle?: string; icono: LucideIcon; tono: Tono; children: React.ReactNode }) {
  return (
    <section className={`rounded-2xl border border-slate-200/80 bg-white ${sombra}`}>
      <header className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
        <IconoTile icono={icono} tono={tono} />
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-slate-800">{titulo}</h2>
          {detalle ? <p className="text-[12.5px] text-slate-500">{detalle}</p> : null}
        </div>
      </header>
      <div className="space-y-5 p-5">{children}</div>
    </section>
  );
}

function Campo({ etiqueta, requerido, ayuda, alerta, children }: { etiqueta: string; requerido?: boolean; ayuda?: string; alerta?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <span className={claseEtiqueta}>
        {etiqueta} {requerido ? <span className="text-rose-500">*</span> : null}
      </span>
      {children}
      {ayuda ? <p className={`mt-1 text-[11.5px] ${alerta ? "font-semibold text-amber-600" : "text-slate-400"}`}>{ayuda}</p> : null}
    </div>
  );
}

function FilaResumen({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-[13px]">
      <span className="shrink-0 text-slate-500">{etiqueta}</span>
      <span className="min-w-0 text-right font-semibold text-slate-800">{children}</span>
    </div>
  );
}

const SinElegir = ({ t = "Sin elegir" }: { t?: string }) => <span className="font-normal text-slate-400">{t}</span>;

type Agenda = { inicio: string; duracion_min: number; responsable_id: string; ubicacion: string };
const AGENDA_VACIA: Agenda = { inicio: "", duracion_min: 60, responsable_id: "", ubicacion: "" };

// ── Página ───────────────────────────────────────────────────────────────────
export default function TipificacionPage() {
  const params = useParams();
  const router = useRouter();
  const me = useUsuario();
  const id = (params?.id as string | undefined) ?? "";

  const [listado, setListado] = useState<ListadoTipificaciones | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [estadosCat, setEstadosCat] = useState<EstadoCat[]>([]);
  const [estadoId, setEstadoId] = useState("");
  const [subestadoId, setSubestadoId] = useState("");
  const [observacion, setObservacion] = useState("");
  const [clasificacion, setClasificacion] = useState("");
  const [archivos, setArchivos] = useState<File[]>([]);
  const [agendar, setAgendar] = useState(true);
  const [agenda, setAgenda] = useState<Agenda>(AGENDA_VACIA);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [creado, setCreado] = useState<{ id: string; numero: number; aviso: string | null } | null>(null);
  const [resaltada, setResaltada] = useState<string | null>(null);

  const cargarListado = useCallback(async () => {
    try {
      setListado(await apiFetch<ListadoTipificaciones>(`/api/clientes/${id}/tipificaciones`));
    } catch (e) {
      const m = (e as Error).message;
      if (/no encontrado|inválido/i.test(m)) setNotFound(true);
      else setError(m || "No se pudo cargar el historial de tipificaciones.");
    }
  }, [id]);

  // Catálogo (Estado → Sub-estados): sólo lo activo.
  const cargarCatalogo = useCallback(async () => {
    try {
      const r = await apiFetchCache<{ familias: EstadoCat[] }>("/api/tipificaciones");
      setEstadosCat(r.familias.filter((e) => e.activo).map((e) => ({ ...e, subestados: e.subestados.filter((s) => s.activo) })));
    } catch {
      setEstadosCat([]);
    }
  }, []);

  useEffect(() => {
    if (!id) { setNotFound(true); return; }
    void Promise.all([cargarListado(), cargarCatalogo()]);
  }, [id, cargarListado, cargarCatalogo]);

  // Llegada desde un ticket (#tip-<id>): se resalta y se lleva a la vista.
  useEffect(() => {
    if (!listado || typeof window === "undefined") return;
    const m = window.location.hash.match(/^#tip-([0-9a-f-]{36})$/i);
    if (!m) return;
    setResaltada(m[1]);
    requestAnimationFrame(() => document.getElementById(`tip-${m[1]}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, [listado]);

  const estadoElegido = estadosCat.find((e) => e.id === estadoId) ?? null;
  const subEstadoElegido = estadoElegido?.subestados.find((s) => s.id === subestadoId) ?? null;
  const comp = subEstadoElegido?.comportamiento ?? "";
  const tipoTicket = comp === "ticket_error" ? "error" : comp === "ticket_cambio" ? "cambio" : null;
  const esTicket = tipoTicket != null;
  const esCambio = tipoTicket === "cambio";
  const esCapacitacion = comp === "capacitacion";
  const horario = listado?.horario;

  const clasificaciones = useMemo(
    () => (listado?.clasificaciones ?? []).filter((c) => c.tipo_codigo === tipoTicket),
    [listado, tipoTicket],
  );
  const clasElegida = clasificaciones.find((c) => c.codigo === clasificacion) ?? null;
  const slaHoras = clasElegida ? Number(clasElegida.sla_horas) : null;
  const entrega = slaHoras != null ? vencimientoSla(Date.now(), slaHoras, horario) : null;
  const prioridad = clasElegida ? listado?.prioridades.find((p) => p.codigo === (clasElegida.prioridad_sugerida || "normal")) ?? null : null;

  // Quién da la capacitación: por defecto, quien la registra.
  const capacitador = agenda.responsable_id || listado?.usuario_actual.id || "";
  const capacitadorNombre = listado?.equipo.find((p) => p.id === capacitador)?.nombre ?? null;
  const inicioMs = agenda.inicio ? Date.parse(`${agenda.inicio}:00-03:00`) : NaN;
  const enHorario = rangoEnHorarioLaboral(inicioMs, inicioMs + agenda.duracion_min * 60_000, horario);

  function limpiarAvisos() { setError(null); setExito(null); }
  function elegirEstado(v: string) { limpiarAvisos(); setEstadoId(v); setSubestadoId(""); setClasificacion(""); }
  function elegirSubestado(v: string) { limpiarAvisos(); setSubestadoId(v); setClasificacion(""); }

  function reiniciar() {
    setObservacion("");
    setEstadoId("");
    setSubestadoId("");
    setClasificacion("");
    setArchivos([]);
    setAgendar(true);
    setAgenda(AGENDA_VACIA);
  }

  async function guardar(e?: React.FormEvent) {
    e?.preventDefault();
    limpiarAvisos();
    if (!estadoId || !subestadoId) return setError("Elegí el estado y el sub-estado.");
    if (!observacion.trim()) return setError("La observación es obligatoria.");
    if (esCapacitacion && agendar && !agenda.inicio) return setError("Elegí fecha y hora de la capacitación, o desmarcá “Agendar”.");
    if (esCapacitacion && agendar && !enHorario) return setError(mensajeHorario(horario));
    if (esTicket) {
      if (!listado?.puede_soporte) return setError("Tu usuario no puede cargar tickets de Soporte.");
      if (clasificaciones.length && !clasificacion) return setError("Completá: clasificación.");
    }

    setGuardando(true);
    try {
      const r = await apiFetch<{ tipificacion_id: string; ticket: { id: string; numero: number } | null; cita_id: string | null }>(
        `/api/clientes/${id}/tipificaciones`,
        {
          method: "POST",
          body: JSON.stringify({
            estado_id: estadoId,
            subestado_id: subestadoId,
            observacion: observacion.trim(),
            ...(esTicket ? { ticket: { clasificacion_codigo: clasificacion } } : {}),
            ...(esCapacitacion && agendar ? { agenda: { ...agenda, responsable_id: capacitador } } : {}),
          }),
        },
      );
      if (r.ticket) {
        // El ticket ya existe. Si una evidencia falla se avisa: se puede volver a subir desde el ticket.
        let aviso: string | null = null;
        if (archivos.length) {
          const s = await subirArchivos(r.ticket.id, archivos);
          if (s.errores.length) aviso = `${s.errores.length} archivo(s) no se subieron: ${s.errores.join(" · ")}`;
        }
        setCreado({ ...r.ticket, aviso });
        document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setExito(
          r.cita_id && agenda.inicio
            ? `Tipificación registrada y capacitación agendada para el ${agenda.inicio.slice(8, 10)}/${agenda.inicio.slice(5, 7)} a las ${agenda.inicio.slice(11, 16)}.`
            : "Tipificación registrada correctamente.",
        );
        setTimeout(() => setExito(null), 3500);
      }
      invalidar(`/api/clientes/${id}/historial`);
      reiniciar();
      await cargarListado();
    } catch (err) {
      setError((err as Error).message || (esTicket ? "No se pudo crear el ticket. No se guardó la tipificación." : "Error al guardar la tipificación."));
    } finally {
      setGuardando(false);
    }
  }

  if (notFound) {
    return (
      <div className="mx-auto mt-10 max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <h1 className="text-xl font-bold text-slate-800">Cliente no encontrado</h1>
        <button onClick={() => router.push("/clientes")} className="mt-3 text-sm font-medium underline" style={{ color: TEAL }}>
          ← Volver a Clientes
        </button>
      </div>
    );
  }

  const cliente = listado?.cliente;
  const tipificaciones = listado?.tipificaciones ?? [];
  const puedeEnviar = !guardando && !!listado && (!esTicket || listado.puede_soporte);
  const esAdmin = me?.rol === "ADMIN";

  return (
    <div className="space-y-5 pb-10">
      {/* ── Encabezado ─────────────────────────────────────────────── */}
      <div>
        <nav className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400" aria-label="Migas">
          <Link href={cliente ? `/clientes/gestion?cliente=${encodeURIComponent(cliente.id)}` : "/clientes/gestion"} className="hover:text-slate-600">Gestión de clientes</Link>
          <span aria-hidden>›</span>
          {cliente ? <Link href={`/clientes/${cliente.id}`} className="hover:text-slate-600">{cliente.nombre}</Link> : <span>…</span>}
          <span aria-hidden>›</span>
          <span className="font-medium text-slate-600">Tipificación</span>
        </nav>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <IconoTile icono={ClipboardPen} tono="turquesa" />
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">Tipificación</h1>
              <p className="text-[13px] text-slate-500">Registrá la gestión con el cliente. Un error o un cambio se escala a Soporte con su ticket.</p>
            </div>
          </div>
          {esAdmin ? (
            <Link href="/clientes/tipificaciones" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:border-[var(--brand)] hover:text-[var(--brand)]">
              <Settings2 className="h-3.5 w-3.5" /> Configurar tipificaciones
            </Link>
          ) : null}
        </div>
        {/* Cliente: una línea chica, el formulario es lo importante */}
        {cliente ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-500">
            <span className="font-semibold text-slate-800">{cliente.nombre}</span>
            <CodigoChip codigo={codigoCliente(cliente)} fondo="bg-white" />
            {cliente.ruc || cliente.documento ? <span>RUC {cliente.ruc || cliente.documento}</span> : null}
            {cliente.telefono ? <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" aria-hidden />{cliente.telefono}</span> : null}
            {cliente.email ? <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" aria-hidden />{cliente.email}</span> : null}
            <span className={`rounded-full px-2 py-px text-[11px] font-bold ${cliente.activo && !cliente.baja_at ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
              {cliente.baja_at ? "De baja" : cliente.activo ? "Activo" : "Inactivo"}
            </span>
          </div>
        ) : null}
      </div>

      {/* ── Ticket creado ─────────────────────────────────────────── */}
      {creado ? (
        <div className="relative overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-teal-50 px-6 py-5 shadow-sm">
          <button type="button" onClick={() => setCreado(null)} className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
            <X className="h-3.5 w-3.5" /> Cerrar
          </button>
          <div className="flex flex-wrap items-center justify-between gap-4 pr-16">
            <div className="flex items-center gap-4">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-500 text-white shadow">
                <CircleCheckBig className="h-6 w-6" aria-hidden />
              </span>
              <div className="space-y-0.5 text-[14px] font-semibold text-emerald-800">
                <p>✓ Tipificación registrada</p>
                <p>✓ Ticket {numeroTicket(creado.numero)} creado correctamente</p>
                {creado.aviso ? <p className="text-xs font-medium text-amber-700">{creado.aviso}</p> : null}
              </div>
            </div>
            <Link href={`/soporte/tickets/${creado.id}`} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-emerald-700">
              Ver ticket {numeroTicket(creado.numero)} <ExternalLink className="h-4 w-4" />
            </Link>
          </div>
        </div>
      ) : null}

      <form onSubmit={guardar} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* ── Columna principal ─────────────────────────────────── */}
        <div className="min-w-0 space-y-6">
          <Seccion titulo="Nueva tipificación" detalle="¿Qué gestión se hizo con el cliente?" icono={ClipboardPen} tono="turquesa">
            {estadosCat.length === 0 ? (
              <p className="text-sm text-slate-500">
                No hay estados de tipificación cargados.{" "}
                {esAdmin ? <Link href="/clientes/tipificaciones" className="font-semibold underline" style={{ color: TEAL }}>Configuralos en Tipificaciones</Link> : "Pedile a un administrador que los configure."}
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo etiqueta="Estado" requerido>
                  <select aria-label="Estado" value={estadoId} onChange={(e) => elegirEstado(e.target.value)} className={claseInput}>
                    <option value="">Elegí un estado…</option>
                    {estadosCat.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                  </select>
                </Campo>
                <Campo
                  etiqueta="Sub-estado"
                  requerido
                  ayuda={esTicket ? "Crea un ticket de Soporte" : esCapacitacion ? "Agenda una capacitación" : undefined}
                >
                  <select aria-label="Sub-estado" value={subestadoId} onChange={(e) => elegirSubestado(e.target.value)} disabled={!estadoId} className={`${claseInput} disabled:bg-slate-50 disabled:text-slate-400`}>
                    <option value="">{estadoId ? "Elegí un sub-estado…" : "Elegí un estado primero"}</option>
                    {(estadoElegido?.subestados ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nombre}
                        {s.comportamiento === "ticket_error" || s.comportamiento === "ticket_cambio" ? " · crea ticket" : s.comportamiento === "capacitacion" ? " · agenda capacitación" : ""}
                      </option>
                    ))}
                  </select>
                </Campo>
              </div>
            )}

            {esTicket && listado?.puede_soporte ? (
              <Campo etiqueta="Clasificación" requerido ayuda={entrega ? `Entrega: ${fechaHoraPy(entrega)}` : undefined}>
                {clasificaciones.length === 0 ? (
                  <p className="text-[12.5px] text-slate-400">No hay clasificaciones de {esCambio ? "cambio" : "error"} configuradas en Soporte.</p>
                ) : (
                  <div role="radiogroup" aria-label="Clasificación" className="grid gap-2 sm:grid-cols-3">
                    {clasificaciones.map((c) => {
                      const t = TONOS[tonoSla(c.sla_horas)];
                      const activa = clasificacion === c.codigo;
                      return (
                        <button
                          key={c.codigo}
                          type="button"
                          role="radio"
                          aria-checked={activa}
                          onClick={() => { setError(null); setClasificacion(c.codigo); }}
                          className={`relative flex items-center justify-between overflow-hidden rounded-xl border px-3.5 py-2.5 text-left transition ${
                            activa ? `${t.borde} ${t.suave} shadow-sm` : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          <span className={`absolute inset-y-0 left-0 w-1 ${activa ? t.solido : "bg-transparent"}`} aria-hidden />
                          <span className={`text-[13.5px] font-bold ${activa ? t.texto : "text-slate-800"}`}>{c.nombre}</span>
                          <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-slate-500">
                            <Timer className="h-3.5 w-3.5" aria-hidden /> {c.sla_horas} h
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="mt-2 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">
                  <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  {listado.responsable_defecto ? (
                    <span>
                      Se asigna a <strong className="text-slate-800">{listado.responsable_defecto.nombre}</strong> (responsable por defecto de Soporte). Entra como Pendiente.
                    </span>
                  ) : (
                    <span>Entra como Pendiente, sin responsable.</span>
                  )}
                </div>
              </Campo>
            ) : null}

            <Campo etiqueta={esTicket ? (esCambio ? "Detalles del cambio" : "Detalles del error") : "Detalles de la gestión"} requerido>
              <textarea
                value={observacion}
                onChange={(e) => { limpiarAvisos(); setObservacion(e.target.value); }}
                rows={4}
                maxLength={5000}
                placeholder={esCambio ? "Qué hay que cambiar, cómo debería quedar…" : esTicket ? "Qué pasa, desde cuándo, qué mensaje aparece…" : "Describí la gestión realizada con el cliente…"}
                className={`${claseInput} resize-none leading-relaxed`}
              />
            </Campo>
          </Seccion>

          {/* ── Capacitación: agenda directa ─────────────────────── */}
          {esCapacitacion ? (
            <Seccion titulo="Agendar capacitación" detalle="Queda en la Agenda, vinculada al cliente" icono={GraduationCap} tono="indigo">
              <label className="flex w-fit cursor-pointer items-center gap-2.5 text-[13.5px] font-semibold text-slate-700">
                <input type="checkbox" checked={agendar} onChange={(e) => setAgendar(e.target.checked)} className="h-4 w-4" style={{ accentColor: TEAL }} />
                Agendar la capacitación ahora
              </label>
              {agendar ? (
                <>
                  <div className="grid gap-5 lg:grid-cols-2">
                    <Campo
                      etiqueta="Fecha y hora"
                      requerido
                      alerta={!!agenda.inicio && !enHorario}
                      ayuda={agenda.inicio && !enHorario ? `Fuera de horario: ${textoHorario(horario)}.` : `Horario laboral: ${textoHorario(horario)}.`}
                    >
                      <input
                        type="datetime-local"
                        aria-label="Fecha y hora de la capacitación"
                        value={agenda.inicio}
                        step={900}
                        onChange={(e) => { setError(null); setAgenda((a) => ({ ...a, inicio: e.target.value })); }}
                        className={claseInput}
                      />
                    </Campo>
                    <Campo etiqueta="Duración" requerido>
                      <div role="radiogroup" aria-label="Duración" className="flex flex-wrap gap-2">
                        {DURACIONES.map((m) => {
                          const activa = agenda.duracion_min === m;
                          return (
                            <button
                              key={m}
                              type="button"
                              role="radio"
                              aria-checked={activa}
                              onClick={() => setAgenda((a) => ({ ...a, duracion_min: m }))}
                              className={`rounded-xl border px-3.5 py-2 text-[13px] font-semibold transition ${
                                activa ? "border-indigo-300 bg-indigo-50 text-indigo-700 shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                              }`}
                            >
                              {textoDuracion(m)}
                            </button>
                          );
                        })}
                      </div>
                    </Campo>
                  </div>
                  <div className="grid gap-5 lg:grid-cols-2">
                    <Campo etiqueta="Quién la da" requerido>
                      <select aria-label="Quién da la capacitación" value={capacitador} onChange={(e) => setAgenda((a) => ({ ...a, responsable_id: e.target.value }))} className={claseInput}>
                        {(listado?.equipo ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                    </Campo>
                    <Campo etiqueta="Lugar o enlace">
                      <input className={claseInput} value={agenda.ubicacion} maxLength={500} onChange={(e) => setAgenda((a) => ({ ...a, ubicacion: e.target.value }))} placeholder="Ej.: Google Meet, oficina del cliente…" />
                    </Campo>
                  </div>
                </>
              ) : null}
            </Seccion>
          ) : null}

          {/* ── Ticket de soporte (Error o Cambio) ───────────────── */}
          {esTicket ? (
            !listado?.puede_soporte ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
                Tu usuario no puede cargar tickets de Soporte (lo pueden los administradores y quienes usan Soporte). Pedíselo a un administrador.
              </div>
            ) : (
              <Seccion titulo="Evidencias" detalle="Capturas, videos o documentos. Quedan en el ticket." icono={Paperclip} tono="indigo">
                <ZonaArchivos archivos={archivos} onCambio={setArchivos} deshabilitada={guardando} />
              </Seccion>
            )
          ) : null}

          {/* ── Historial de tipificaciones ──────────────────────── */}
          <section className={`overflow-hidden rounded-2xl border border-slate-200/80 bg-white ${sombra}`}>
            <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-3">
                <IconoTile icono={History} tono="indigo" />
                <h2 className="text-[15px] font-bold text-slate-800">Historial de tipificaciones</h2>
              </div>
              <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-bold tabular-nums text-indigo-700">{tipificaciones.length}</span>
            </header>

            {tipificaciones.length === 0 ? (
              <div className="py-14 text-center text-sm text-slate-400">
                {listado ? "No hay tipificaciones registradas para este cliente." : "Cargando…"}
              </div>
            ) : (
              <ol className="divide-y divide-slate-100">
                {tipificaciones.map((t) => {
                  const ce = t.cita ? estadoCita(t.cita.estado) : null;
                  return (
                    <li
                      key={t.id}
                      id={`tip-${t.id}`}
                      className={`grid gap-3 px-5 py-4 transition-colors md:grid-cols-[170px_minmax(0,1fr)] ${resaltada === t.id ? "bg-teal-50" : "hover:bg-slate-50/60"}`}
                    >
                      <div className="flex items-start gap-3 md:block">
                        <p className="text-[12px] tabular-nums text-slate-400">{fechaHoraPy(t.fecha)}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700">
                          <Avatar nombre={t.usuario || "?"} /> <span className="truncate">{t.usuario}</span>
                        </p>
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-bold ${TONOS.turquesa.suave} ${TONOS.turquesa.texto}`}>
                            <ClipboardPen className="h-3.5 w-3.5" aria-hidden /> {t.tipo_gestion}
                          </span>
                          <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-bold ${t.ticket ? `${TONOS.rosa.suave} ${TONOS.rosa.texto}` : `${TONOS.pizarra.suave} ${TONOS.pizarra.texto}`}`}>{t.resultado}</span>
                        </div>
                        <p className="mt-1.5 whitespace-pre-line text-[13.5px] leading-relaxed text-slate-700">{t.observacion}</p>

                        {t.cita ? (
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50/60 px-4 py-3">
                            <p className="inline-flex flex-wrap items-center gap-2 text-[13px] font-semibold text-indigo-800">
                              <GraduationCap className="h-4 w-4" aria-hidden />
                              Capacitación agendada · {fechaHoraPy(t.cita.inicio_at)}
                              {t.cita.responsable ? <span className="font-medium text-indigo-600">· {t.cita.responsable}</span> : null}
                              {ce ? <span className={`rounded-full px-2 py-px text-[11px] font-bold ${ce.color}`}>{ce.nombre}</span> : null}
                            </p>
                            <Link href="/clientes/agenda" className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-semibold text-indigo-700 shadow-sm ring-1 ring-indigo-200 hover:bg-indigo-50">
                              Ver en Agenda <ExternalLink className="h-3.5 w-3.5" />
                            </Link>
                          </div>
                        ) : null}

                        {t.ticket ? (
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-200 bg-gradient-to-r from-teal-50/70 to-transparent px-4 py-3">
                            <div className="min-w-0">
                              <p className="text-[13px] font-bold text-slate-800">
                                Ticket {numeroTicket(t.ticket.numero)} <span className="font-medium text-slate-500">· {t.ticket.asunto}</span>
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-600">
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="h-2 w-2 rounded-full" style={{ background: t.ticket.estado_color ?? "#94a3b8" }} aria-hidden />
                                  {t.ticket.estado_nombre}
                                </span>
                                <span>Prioridad {t.ticket.prioridad_nombre}</span>
                              </div>
                            </div>
                            {listado?.puede_soporte ? (
                              <Link href={`/soporte/tickets/${t.ticket.id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-semibold text-teal-700 shadow-sm ring-1 ring-teal-200 hover:bg-teal-50">
                                Ver ticket <ExternalLink className="h-3.5 w-3.5" />
                              </Link>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>

        {/* ── Resumen fijo ──────────────────────────────────────── */}
        <aside className="space-y-4 xl:sticky xl:top-0 xl:self-start">
          <div className={`overflow-hidden rounded-2xl border border-slate-200/80 bg-white ${sombra}`}>
            <div className="px-5 pb-4 pt-5" style={{ backgroundImage: `linear-gradient(135deg, ${TEAL}1f, transparent 70%)` }}>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Resumen</p>
              <div className="mt-3 flex items-center gap-3">
                <IconoTile icono={ClipboardPen} tono="turquesa" />
                <div className="min-w-0">
                  <p className="truncate text-[16px] font-bold text-slate-900">{estadoElegido?.nombre ?? "Nueva tipificación"}</p>
                  <p className="text-[12.5px] text-slate-500">{esTicket ? "Se crea un ticket de Soporte" : subEstadoElegido?.nombre ?? "Tipificación del cliente"}</p>
                </div>
              </div>
            </div>

            <div className="divide-y divide-slate-100 px-5">
              <FilaResumen etiqueta="Cliente">{cliente?.nombre ?? "…"}</FilaResumen>
              {esTicket || !subEstadoElegido ? null : (
                <FilaResumen etiqueta="Sub-estado">
                  <span className={`rounded-full px-2 py-0.5 text-[12px] ${TONOS.turquesa.suave} ${TONOS.turquesa.texto}`}>{subEstadoElegido.nombre}</span>
                </FilaResumen>
              )}
              {esCapacitacion && agendar ? (
                <>
                  <FilaResumen etiqueta="Capacitación">
                    {agenda.inicio ? `${agenda.inicio.slice(8, 10)}/${agenda.inicio.slice(5, 7)} ${agenda.inicio.slice(11, 16)}` : <SinElegir t="Sin fecha" />}
                  </FilaResumen>
                  <FilaResumen etiqueta="Duración">{agenda.duracion_min} min</FilaResumen>
                  <FilaResumen etiqueta="La da">{capacitadorNombre ?? <SinElegir />}</FilaResumen>
                </>
              ) : null}
              {esTicket ? (
                <>
                  <FilaResumen etiqueta="Clasificación">{clasElegida?.nombre ?? <SinElegir />}</FilaResumen>
                  <FilaResumen etiqueta="Prioridad">{prioridad?.nombre ?? <SinElegir />}</FilaResumen>
                  <FilaResumen etiqueta="Entrega">
                    {entrega ? (
                      <span className="inline-flex items-center gap-1.5"><CalendarCheck className="h-3.5 w-3.5 text-rose-500" aria-hidden />{fechaHoraPy(entrega)}</span>
                    ) : <SinElegir />}
                  </FilaResumen>
                  <FilaResumen etiqueta="Responsable">{listado?.responsable_defecto?.nombre ?? <SinElegir t="Sin asignar" />}</FilaResumen>
                  <FilaResumen etiqueta="Evidencias">{archivos.length || <SinElegir t="Ninguna" />}</FilaResumen>
                </>
              ) : null}
            </div>

            {esTicket ? (
              <div className={`mx-5 mb-1 mt-3 rounded-2xl px-4 py-3.5 ${slaHoras == null ? "bg-slate-50" : TONOS[tonoSla(slaHoras)].suave}`}>
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <Timer className="h-3.5 w-3.5" aria-hidden /> Service level
                </p>
                {slaHoras == null ? (
                  <p className="mt-1 text-[13px] text-slate-400">Elegí la clasificación para ver el SLA.</p>
                ) : (
                  <p className={`mt-0.5 text-3xl font-extrabold tabular-nums ${TONOS[tonoSla(slaHoras)].texto}`}>
                    {slaHoras} <span className="text-base font-bold">{slaHoras === 1 ? "hora" : "horas"}</span>
                  </p>
                )}
              </div>
            ) : null}

            <div className="space-y-3 p-5">
              <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5">
                {listado ? <Avatar nombre={listado.usuario_actual.nombre} /> : <UserRound className="h-5 w-5 text-slate-400" />}
                <div className="min-w-0 text-[12.5px]">
                  <p className="text-slate-500">Se registrará como</p>
                  <p className="truncate font-semibold text-slate-800">{listado?.usuario_actual.nombre ?? "…"}</p>
                </div>
              </div>

              {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] font-medium text-rose-700">{error}</p> : null}
              {exito ? (
                <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] font-semibold text-emerald-700">
                  <CircleCheckBig className="h-4 w-4 shrink-0" aria-hidden /> {exito}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={!puedeEnviar}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[15px] font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: TEAL }}
              >
                {esTicket ? <Headset className="h-4 w-4" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                {guardando ? (esTicket ? "Creando ticket…" : "Guardando…") : esTicket ? "Crear ticket de soporte" : "Guardar tipificación"}
              </button>
            </div>
          </div>
        </aside>
      </form>
    </div>
  );
}
