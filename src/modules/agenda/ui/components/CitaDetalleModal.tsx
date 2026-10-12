"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { CalendarClock, ClipboardPen, MapPin, Phone, User, UserPlus, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { TZ_PY } from "@/lib/fecha/paraguay";
import { ESTADOS_TERMINALES, inicialesNombre, nombreCapitular, type AgendaCitaEnriquecida, type AgendaEstado } from "@/modules/agenda/dominio";
import { estadoStyle, tipoLabel } from "../calendar-utils";

/** "viernes, 21 de agosto" — el día, sin la hora. */
function fmtDia(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-PY", { timeZone: TZ_PY, weekday: "long", day: "2-digit", month: "long" });
}

/** "10:00" */
function fmtHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-PY", { timeZone: TZ_PY, hour: "2-digit", minute: "2-digit", hour12: false });
}

/** "30 min" / "1 h 30 min" — se lee más rápido que restar dos horarios. */
function duracion(inicio: string, fin: string): string {
  const ms = Date.parse(fin) - Date.parse(inicio);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

/** Paleta estable por nombre, para que cada persona conserve su color. */
const AVATARES = [
  "bg-[#4FAEB2]/15 text-[#2F6E71]",
  "bg-violet-500/15 text-violet-700",
  "bg-amber-500/20 text-amber-700",
  "bg-emerald-600/15 text-emerald-700",
  "bg-rose-500/15 text-rose-700",
  "bg-sky-600/15 text-sky-700",
];
function avatarClase(nombre: string): string {
  let h = 0;
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) >>> 0;
  return AVATARES[h % AVATARES.length];
}

/** Encabezado con un brillo que sigue al mouse (SpotlightCard de React Bits, como el actual). */
function Spotlight({ children, color }: { children: React.ReactNode; color: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(0);
  return (
    <div
      ref={ref}
      onMouseMove={(e) => {
        const r = ref.current?.getBoundingClientRect();
        if (r) setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onMouseEnter={() => setOpacity(0.6)}
      onMouseLeave={() => setOpacity(0)}
      className="relative overflow-hidden"
    >
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-500 ease-in-out"
        style={{ opacity, background: `radial-gradient(circle at ${pos.x}px ${pos.y}px, ${color}, transparent 80%)` }}
      />
      {children}
    </div>
  );
}

export default function CitaDetalleModal({
  open,
  cita,
  onClose,
  onEditar,
  onReprogramar,
  onChanged,
}: {
  open: boolean;
  cita: AgendaCitaEnriquecida | null;
  onClose: () => void;
  onEditar: (c: AgendaCitaEnriquecida) => void;
  onReprogramar: (c: AgendaCitaEnriquecida) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open || !cita) return null;
  const terminal = ESTADOS_TERMINALES.has(cita.estado);
  const puede = cita.puede_editar !== false;
  const est = estadoStyle(cita.estado);

  async function setEstado(estado: AgendaEstado) {
    if (!cita) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/agenda/${cita.id}`, { method: "PATCH", body: JSON.stringify({ estado }) });
      setBusy(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar.");
      setBusy(false);
    }
  }

  async function cancelar() {
    if (!cita) return;
    const motivo = window.prompt("Motivo de cancelación (opcional):");
    if (motivo === null) return; // canceló el prompt
    setBusy(true);
    setError(null);
    try {
      const qs = motivo.trim() ? `?motivo=${encodeURIComponent(motivo.trim())}` : "";
      await apiFetch(`/api/agenda/${cita.id}${qs}`, { method: "DELETE" });
      setBusy(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cancelar.");
      setBusy(false);
    }
  }

  const responsables = cita.responsables?.length ? cita.responsables : [{ id: cita.responsable_id, nombre: cita.responsable?.nombre ?? null }];
  const cliente = cita.cliente?.nombre ?? cita.contacto_nombre ?? null;
  const telefono = cita.contacto_telefono ?? cita.cliente?.telefono ?? null;
  const dur = duracion(cita.inicio_at, cita.fin_at);
  const tipificacionId = typeof cita.metadata?.tipificacion_id === "string" ? cita.metadata.tipificacion_id : null;

  return (
    <CapaModal onClose={onClose} fondo="bg-slate-900/40">
      <div className={`flex w-full max-w-lg ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-xl`} onClick={(e) => e.stopPropagation()}>
        {/* Encabezado: título + estado como chip de color (es el dato que se mira primero). */}
        <div className="shrink-0">
        <Spotlight color="rgba(79, 174, 178, 0.14)">
          <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${est.chip}`}>
                  <i aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${est.dot}`} />
                  {est.label}
                </span>
                {cita.tipo ? (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">{tipoLabel(cita.tipo)}</span>
                ) : null}
              </div>
              <h2 className="mt-1.5 text-lg font-semibold leading-tight tracking-tight text-slate-900">{cita.titulo}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </Spotlight>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* Fecha y hora: un rango con la duración ya calculada. */}
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#4FAEB2]/12 text-[#3F8E91]">
              <CalendarClock className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              {/* first-letter:uppercase y no capitalize (que dejaría "Viernes 21 De Agosto"). */}
              <p className="text-[13px] font-semibold text-slate-900 first-letter:uppercase">{fmtDia(cita.inicio_at)}</p>
              <p className="text-[12px] text-slate-500">
                {fmtHora(cita.inicio_at)} – {fmtHora(cita.fin_at)}
                {dur ? <span className="text-slate-400"> · {dur}</span> : null}
              </p>
            </div>
          </div>

          <Seccion titulo={responsables.length > 1 ? "Responsables" : "Responsable"} icono={User}>
            <ul className="space-y-1.5">
              {responsables.map((r, i) => {
                const nombre = nombreCapitular(r.nombre ?? r.id);
                return (
                  <li key={r.id} className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${avatarClase(nombre)}`}
                    >
                      {inicialesNombre(r.nombre ?? r.id)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-slate-800">{nombre}</span>
                    {i === 0 && responsables.length > 1 ? (
                      <span className="shrink-0 rounded-md bg-[#4FAEB2]/12 px-1.5 py-0.5 text-[10px] font-semibold text-[#3F8E91]">principal</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Seccion>

          {cita.creado_por ? (
            <Seccion titulo="Cargada por" icono={UserPlus}>
              <p className="text-[13px] text-slate-800">{nombreCapitular(cita.creado_por.nombre ?? cita.creado_por.id)}</p>
            </Seccion>
          ) : null}

          {cliente || telefono ? (
            <Seccion titulo="Cliente / contacto" icono={Phone}>
              {cliente ? <p className="text-[13px] text-slate-800">{cliente}</p> : null}
              {telefono ? <p className="text-[12px] text-slate-500">{telefono}</p> : null}
              {cita.cliente_id && tipificacionId ? (
                <Link
                  href={`/clientes/${cita.cliente_id}/tipificacion#tip-${tipificacionId}`}
                  className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-[#3F8E91] hover:underline"
                >
                  <ClipboardPen className="h-3.5 w-3.5" /> Ver tipificación
                </Link>
              ) : null}
            </Seccion>
          ) : null}

          {cita.ubicacion ? (
            <Seccion titulo="Ubicación / enlace" icono={MapPin}>
              {/^https?:\/\//i.test(cita.ubicacion.trim()) ? (
                <a
                  href={cita.ubicacion.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-[13px] text-[#3F8E91] underline underline-offset-2 hover:text-[#2F6E71]"
                >
                  {cita.ubicacion}
                </a>
              ) : (
                <p className="break-words text-[13px] text-slate-800">{cita.ubicacion}</p>
              )}
            </Seccion>
          ) : null}

          {cita.observaciones ? (
            <Seccion titulo="Observaciones">
              <p className="whitespace-pre-wrap break-words text-[13px] text-slate-700">{cita.observaciones}</p>
            </Seccion>
          ) : null}

          {cita.cancelada_motivo ? (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">Motivo de cancelación</p>
              <p className="mt-0.5 break-words text-[13px] text-rose-900">{cita.cancelada_motivo}</p>
            </div>
          ) : null}

          {error ? <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div> : null}
        </div>

        {/* Acciones con jerarquía: la de avance va llena, el resto en contorno, y "Cancelar"
            queda separada a la izquierda porque es la destructiva. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3.5">
          {terminal ? (
            <span className="text-xs text-slate-400">Cita en estado terminal ({est.label.toLowerCase()}). No admite más cambios.</span>
          ) : !puede ? (
            <span className="text-xs text-slate-400">Sólo sus responsables, quien la cargó o un administrador pueden cambiarla.</span>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={cancelar}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
              >
                Cancelar cita
              </button>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <BtnSec disabled={busy} onClick={() => onEditar(cita)}>
                  Editar
                </BtnSec>
                <BtnSec disabled={busy} onClick={() => onReprogramar(cita)}>
                  Reprogramar
                </BtnSec>
                <BtnSec disabled={busy} onClick={() => setEstado("no_asistio")}>
                  No asistió
                </BtnSec>
                {cita.estado === "pendiente" ? (
                  <BtnPri disabled={busy} onClick={() => setEstado("confirmada")}>
                    Confirmar
                  </BtnPri>
                ) : (
                  <BtnPri disabled={busy} onClick={() => setEstado("completada")}>
                    Completar
                  </BtnPri>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </CapaModal>
  );
}

function Seccion({
  titulo,
  icono: Icono,
  children,
}: {
  titulo: string;
  icono?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-center gap-1.5">
        {Icono ? <Icono className="h-3 w-3 text-slate-400" aria-hidden /> : null}
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{titulo}</p>
      </div>
      {children}
    </div>
  );
}

function BtnPri({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-lg bg-[#3F8E91] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#2F6E71] disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function BtnSec({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-800 disabled:opacity-50"
    >
      {children}
    </button>
  );
}
