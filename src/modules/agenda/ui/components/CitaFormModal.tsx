"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { Select } from "@/components/Select";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { AGENDA_ESTADOS, type AgendaCitaEnriquecida } from "@/modules/agenda/dominio";
import { HORARIO_DEFECTO, fechaLocalAIso, rangoEnHorarioLaboral, textoHorario, type Horario } from "@/modules/agenda/horario";
import { aPared, ahoraPared, estadoStyle, hhmm, pad, tipoLabel, ymd } from "../calendar-utils";
import { ResponsablesSelect } from "./ResponsablesSelect";
import { ClienteSelect, type ClienteOpcion } from "./ClienteSelect";

export type AgendaOptions = {
  responsables: { id: string; nombre: string | null; rol: string | null }[];
  tipos: string[];
  horario: Horario;
};

type Mode = "crear" | "editar" | "reprogramar";
type ClienteMode = "existente" | "nuevo";

const DURACIONES = [15, 30, 45, 60, 90, 120];

const TEAL = "#4FAEB2";
const TEAL_DARK = "#3F8E91";

/** fecha (YYYY-MM-DD) + hora (HH:mm), en hora de Paraguay → ISO. */
function combinar(fecha: string, hora: string): string | null {
  if (!fecha || !hora) return null;
  return fechaLocalAIso(`${fecha}T${hora}`) ?? null;
}
function addMinToHora(hora: string, min: number): string {
  const [h, m] = hora.split(":").map((x) => parseInt(x, 10));
  const total = (((h || 0) * 60 + (m || 0) + min) % 1440 + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}
function diffMin(hi: string, hf: string): number | null {
  const [h1, m1] = hi.split(":").map((x) => parseInt(x, 10));
  const [h2, m2] = hf.split(":").map((x) => parseInt(x, 10));
  if ([h1, m1, h2, m2].some((n) => Number.isNaN(n))) return null;
  return h2 * 60 + m2 - (h1 * 60 + m1);
}

// Horarios cada 15 min para los selectores de hora (si la cita trae una hora fuera de la
// grilla, se agrega tal cual para no perderla).
const SLOTS = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`);
const aMin = (h: string) => { const [a, b] = h.split(":").map((x) => parseInt(x, 10)); return a * 60 + b; };
function opcionesHora(valor: string, desde?: string): [string, string][] {
  const base = desde ? SLOTS.filter((h) => aMin(h) > aMin(desde)) : SLOTS;
  const lista = valor && !base.includes(valor) ? [...base, valor].sort((x, y) => aMin(x) - aMin(y)) : base;
  return lista.map((h) => {
    if (!desde) return [h, h];
    const d = aMin(h) - aMin(desde);
    const txt = d < 60 ? `${d} min` : d % 60 === 0 ? `${d / 60} h` : `${Math.floor(d / 60)} h ${d % 60} min`;
    return [h, `${h}  ·  ${txt}`];
  });
}

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20";
const labelCls = "block text-xs font-medium text-slate-600 mb-1";

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-5 w-1 rounded-full" style={{ backgroundColor: TEAL }} />
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: TEAL }}>
        {children}
      </span>
    </div>
  );
}

export default function CitaFormModal({
  open,
  mode,
  cita,
  prefill,
  options,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: Mode;
  cita: AgendaCitaEnriquecida | null;
  /** Fechas de pared de Paraguay. */
  prefill: { inicio: Date; fin: Date } | null;
  options: AgendaOptions;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [titulo, setTitulo] = useState("");
  const [responsableId, setResponsableId] = useState("");
  /** Lista completa; `responsableId` (el principal) va siempre primero. */
  const [responsableIds, setResponsableIds] = useState<string[]>([]);
  const [tipo, setTipo] = useState("reunion");
  const [estado, setEstado] = useState("pendiente");

  const [fecha, setFecha] = useState("");
  const [horaInicio, setHoraInicio] = useState("");
  const [horaFin, setHoraFin] = useState("");

  const [clienteMode, setClienteMode] = useState<ClienteMode>("existente");
  const [cliente, setCliente] = useState<ClienteOpcion | null>(null);
  const [contactoNombre, setContactoNombre] = useState("");
  const [contactoTelefono, setContactoTelefono] = useState("");
  const [contactoEmail, setContactoEmail] = useState("");
  const [contactoEmpresa, setContactoEmpresa] = useState("");

  const [ubicacion, setUbicacion] = useState("");
  const [observaciones, setObservaciones] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setAviso(null);
    if (mode === "crear") {
      const ini =
        prefill?.inicio ??
        (() => {
          const d = ahoraPared();
          d.setUTCMinutes(0, 0, 0);
          d.setUTCHours(d.getUTCHours() + 1);
          return d;
        })();
      const fin = prefill?.fin ?? new Date(ini.getTime() + 30 * 60_000);
      setTitulo("");
      // Sin preselección: elegir al primero de la lista metía a alguien que muy probablemente
      // no participa de la reunión, y encima quedaba como principal.
      setResponsableId("");
      setResponsableIds([]);
      setTipo("reunion");
      setEstado("pendiente");
      setFecha(ymd(ini));
      setHoraInicio(hhmm(ini));
      setHoraFin(hhmm(fin));
      setClienteMode("existente");
      setCliente(null);
      setContactoNombre("");
      setContactoTelefono("");
      setContactoEmail("");
      setContactoEmpresa("");
      setUbicacion("");
      setObservaciones("");
    } else if (cita) {
      const ini = aPared(cita.inicio_at);
      const fin = aPared(cita.fin_at);
      const meta = (cita.metadata ?? {}) as Record<string, unknown>;
      setTitulo(cita.titulo);
      setResponsableId(cita.responsable_id);
      setResponsableIds(cita.responsables?.length ? cita.responsables.map((r) => r.id) : [cita.responsable_id]);
      setTipo(cita.tipo || "reunion");
      setEstado(cita.estado);
      setFecha(ymd(ini));
      setHoraInicio(hhmm(ini));
      setHoraFin(hhmm(fin));
      setClienteMode(cita.cliente_id ? "existente" : cita.contacto_nombre || cita.contacto_telefono ? "nuevo" : "existente");
      setCliente(cita.cliente_id ? { id: cita.cliente_id, nombre: cita.cliente?.nombre ?? null, telefono: cita.cliente?.telefono ?? null } : null);
      setContactoNombre(cita.contacto_nombre ?? "");
      setContactoTelefono(cita.contacto_telefono ?? "");
      setContactoEmail(typeof meta.contacto_email === "string" ? meta.contacto_email : "");
      setContactoEmpresa(typeof meta.contacto_empresa === "string" ? meta.contacto_empresa : "");
      setUbicacion(cita.ubicacion ?? "");
      setObservaciones(cita.observaciones ?? "");
    }
  }, [open, mode, cita, prefill]);

  // Disponibilidad (advertencia no bloqueante).
  useEffect(() => {
    if (!open) return;
    const inicioIso = combinar(fecha, horaInicio);
    const finIso = combinar(fecha, horaFin);
    if (!responsableId || !inicioIso || !finIso || Date.parse(finIso) <= Date.parse(inicioIso)) {
      setAviso(null);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ responsable_id: responsableId, inicio: inicioIso, fin: finIso });
    // Al editar y al reprogramar la propia cita no cuenta como choque.
    if (mode !== "crear" && cita) params.set("exclude_id", cita.id);
    const t = setTimeout(async () => {
      try {
        const r = await apiFetch<{ disponible: boolean; conflicto: { mensaje: string } | null }>(`/api/agenda/disponibilidad?${params.toString()}`);
        if (cancelled) return;
        setAviso(r.disponible === false ? r.conflicto?.mensaje ?? "El responsable ya tiene una cita en ese horario." : null);
      } catch {
        /* silencioso */
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, responsableId, fecha, horaInicio, horaFin, mode, cita]);

  const duracionActual = useMemo(() => diffMin(horaInicio, horaFin), [horaInicio, horaFin]);
  const horario = options.horario ?? HORARIO_DEFECTO;
  const fueraDeHorario = useMemo(() => {
    const ini = combinar(fecha, horaInicio);
    const fin = combinar(fecha, horaFin);
    if (!ini || !fin || Date.parse(fin) <= Date.parse(ini)) return false;
    return !rangoEnHorarioLaboral(Date.parse(ini), Date.parse(fin), horario);
  }, [fecha, horaInicio, horaFin, horario]);

  const tituloModal = mode === "crear" ? "Nueva cita" : mode === "reprogramar" ? "Reprogramar cita" : "Editar cita";
  const subtitulo =
    mode === "crear" ? "Programá una nueva cita o reunión" : mode === "reprogramar" ? "Mové la cita a un nuevo horario" : "Actualizá los datos de la cita";

  if (!open) return null;

  function aplicarDuracion(min: number) {
    if (!horaInicio) return;
    setHoraFin(addMinToHora(horaInicio, min));
  }
  function onChangeInicio(v: string) {
    const prevDur = duracionActual && duracionActual > 0 ? duracionActual : 30;
    setHoraInicio(v);
    if (v) setHoraFin(addMinToHora(v, prevDur));
  }

  async function submit() {
    setError(null);
    const inicioIso = combinar(fecha, horaInicio);
    const finIso = combinar(fecha, horaFin);
    if (mode !== "reprogramar" && !titulo.trim()) return setError("El título es obligatorio.");
    if (!responsableId) return setError("Elegí al menos un responsable.");
    if (!inicioIso || !finIso) return setError("Indicá fecha, hora de inicio y fin.");
    if (Date.parse(finIso) <= Date.parse(inicioIso)) return setError("El fin debe ser posterior al inicio.");

    const metadata: Record<string, unknown> = { ...((cita?.metadata as Record<string, unknown>) ?? {}) };
    const esNuevo = clienteMode === "nuevo";
    if (esNuevo) {
      if (contactoEmail.trim()) metadata.contacto_email = contactoEmail.trim();
      else delete metadata.contacto_email;
      if (contactoEmpresa.trim()) metadata.contacto_empresa = contactoEmpresa.trim();
      else delete metadata.contacto_empresa;
    }

    setSaving(true);
    try {
      if (mode === "reprogramar" && cita) {
        await apiFetch(`/api/agenda/${cita.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            accion: "reprogramar",
            responsable_id: responsableId,
            responsable_ids: responsableIds,
            inicio_at: inicioIso,
            fin_at: finIso,
            observaciones: observaciones || null,
          }),
        });
      } else {
        const payload = {
          titulo: titulo.trim(),
          responsable_id: responsableId,
          responsable_ids: responsableIds,
          tipo: tipo || null,
          estado,
          inicio_at: inicioIso,
          fin_at: finIso,
          cliente_id: esNuevo ? null : cliente?.id ?? null,
          contacto_nombre: esNuevo ? contactoNombre || null : null,
          contacto_telefono: esNuevo ? contactoTelefono || null : null,
          ubicacion: ubicacion || null,
          observaciones: observaciones || null,
          metadata,
        };
        await apiFetch(mode === "crear" ? "/api/agenda" : `/api/agenda/${cita!.id}`, {
          method: mode === "crear" ? "POST" : "PATCH",
          body: JSON.stringify(payload),
        });
      }
      setSaving(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
      setSaving(false);
    }
  }

  const reprog = mode === "reprogramar";
  // Un tipo viejo que ya no está en la lista se sigue mostrando (no se pierde al editar).
  const tipos = [...new Set([...(options.tipos.length ? options.tipos : ["reunion"]), tipo].filter(Boolean))];

  return (
    <CapaModal onClose={onClose} fondo="bg-slate-900/55 backdrop-blur-sm">
      <div className={`relative flex w-full max-w-lg ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-[#4FAEB2]/10 ring-1 ring-[#4FAEB2]/15`}>
        {/* barra superior degradé */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#4FAEB2] via-[#4FAEB2]/80 to-[#4FAEB2]/40" />

        {/* header con gradiente sutil */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-br from-white via-white to-[#4FAEB2]/5 px-4 pb-3 pt-4 sm:px-5 sm:pb-4 sm:pt-5">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">{tituloModal}</h2>
            <p className="mt-0.5 text-sm text-slate-500">{subtitulo}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-400 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2]"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {/* BÁSICO */}
          {!reprog && (
            <section className="space-y-3">
              <SectionHead>Básico</SectionHead>
              <div>
                <label className={labelCls}>Título *</label>
                <input className={inputCls} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej: Reunión con cliente" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="col-span-1 sm:col-span-2">
                  <label className={labelCls}>Responsables *</label>
                  <ResponsablesSelect
                    opciones={options.responsables}
                    valor={responsableIds}
                    principalId={responsableId || null}
                    onChange={(ids) => {
                      setResponsableIds(ids);
                      // El principal es SIEMPRE el primero de la lista. Si se lo saca, hereda
                      // el siguiente; si no queda ninguno, el formulario lo pide al guardar.
                      setResponsableId(ids[0] ?? "");
                    }}
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    El primero es el responsable principal; el horario se valida contra su agenda. Todos reciben el recordatorio.
                  </p>
                </div>
                <div>
                  <label className={labelCls}>Tipo</label>
                  <Select block value={tipo} onChange={setTipo} options={tipos.map((t) => [t, tipoLabel(t)] as [string, string])} />
                </div>
                <div>
                  <label className={labelCls}>Estado</label>
                  <Select
                    block
                    value={estado}
                    onChange={setEstado}
                    options={AGENDA_ESTADOS.filter((s) => s !== "reprogramada" || estado === "reprogramada").map((s) => [s, estadoStyle(s).label] as [string, string])}
                  />
                </div>
              </div>
            </section>
          )}

          {reprog && (
            <div className="rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-2.5 text-xs text-violet-700">
              Vas a reprogramar “{cita?.titulo}”. La cita original quedará marcada como <b>reprogramada</b> y se creará una nueva.
            </div>
          )}

          {/* FECHA Y HORA */}
          <section className="space-y-3">
            <SectionHead>Fecha y hora</SectionHead>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className={labelCls}>Fecha *</label>
                <input type="date" className={inputCls} value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Inicio *</label>
                <Select block value={horaInicio} onChange={onChangeInicio} options={[["", "Elegí la hora"] as [string, string], ...opcionesHora(horaInicio)].slice(horaInicio ? 1 : 0)} />
              </div>
              <div>
                <label className={labelCls}>Fin *</label>
                <Select block value={horaFin} onChange={setHoraFin} options={[["", "Elegí la hora"] as [string, string], ...opcionesHora(horaFin, horaInicio || undefined)].slice(horaFin ? 1 : 0)} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-400">Duración:</span>
              {DURACIONES.map((d) => {
                const active = duracionActual === d;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => aplicarDuracion(d)}
                    style={active ? { backgroundColor: TEAL, borderColor: TEAL } : undefined}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                      active ? "text-white shadow-sm" : "border-slate-300 text-slate-600 hover:border-[#4FAEB2]/60 hover:text-[#3F8E91]"
                    }`}
                  >
                    {d < 60 ? `${d}m` : d === 60 ? "1h" : `${d / 60}h`}
                  </button>
                );
              })}
              {duracionActual != null && !DURACIONES.includes(duracionActual) && duracionActual > 0 && (
                <span className="text-[11px] text-slate-500">({duracionActual}m)</span>
              )}
            </div>
            {aviso && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-700">⚠ {aviso}</div>}
            {fueraDeHorario && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
                Fuera del horario laboral ({textoHorario(horario)}). Se puede guardar igual.
              </div>
            )}
          </section>

          {/* PERSONA */}
          {!reprog && (
            <section className="space-y-3">
              <SectionHead>Persona</SectionHead>
              <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setClienteMode("existente")}
                  style={clienteMode === "existente" ? { backgroundColor: TEAL } : undefined}
                  className={`flex-1 rounded-lg px-3 py-2 font-medium transition-colors ${
                    clienteMode === "existente" ? "text-white shadow-sm" : "text-slate-600 hover:text-slate-800"
                  }`}
                >
                  Cliente existente
                </button>
                <button
                  type="button"
                  onClick={() => setClienteMode("nuevo")}
                  style={clienteMode === "nuevo" ? { backgroundColor: TEAL } : undefined}
                  className={`flex-1 rounded-lg px-3 py-2 font-medium transition-colors ${
                    clienteMode === "nuevo" ? "text-white shadow-sm" : "text-slate-600 hover:text-slate-800"
                  }`}
                >
                  Nuevo contacto
                </button>
              </div>

              {clienteMode === "existente" ? (
                <ClienteSelect valor={cliente} onChange={setCliente} />
              ) : (
                <div className="space-y-3 rounded-2xl border border-[#4FAEB2]/20 bg-[#4FAEB2]/5 p-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className={labelCls}>Nombre</label>
                      <input className={inputCls} value={contactoNombre} onChange={(e) => setContactoNombre(e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>Teléfono</label>
                      <input className={inputCls} value={contactoTelefono} onChange={(e) => setContactoTelefono(e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className={labelCls}>Email</label>
                      <input className={inputCls} value={contactoEmail} onChange={(e) => setContactoEmail(e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>Empresa / referencia</label>
                      <input className={inputCls} value={contactoEmpresa} onChange={(e) => setContactoEmpresa(e.target.value)} />
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* EXTRA */}
          <section className="space-y-3">
            <SectionHead>Extra</SectionHead>
            {!reprog && (
              <div>
                <label className={labelCls}>Ubicación / enlace</label>
                <input className={inputCls} value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} placeholder="Dirección, sala o link" />
              </div>
            )}
            <div>
              <label className={labelCls}>Observaciones internas</label>
              <textarea className={inputCls} rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
            </div>
          </section>

          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700">{error}</div>}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3 max-sm:[&>*]:flex-1 sm:px-5 sm:py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            style={!saving ? { backgroundColor: TEAL } : undefined}
            onMouseEnter={(e) => {
              if (!saving) e.currentTarget.style.backgroundColor = TEAL_DARK;
            }}
            onMouseLeave={(e) => {
              if (!saving) e.currentTarget.style.backgroundColor = TEAL;
            }}
            className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </CapaModal>
  );
}
