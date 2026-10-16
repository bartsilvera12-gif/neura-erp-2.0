"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Building2, ClipboardPen, Clock, Lock, MapPin, Phone, StickyNote, User, UserPlus, X } from "lucide-react";
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

/** "oct" y "13" para la hoja de calendario. */
function fmtMes(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-PY", { timeZone: TZ_PY, month: "short" }).replace(".", "");
}
function fmtNumDia(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-PY", { timeZone: TZ_PY, day: "numeric" });
}

const MSJ_TERMINAL: Record<string, string> = {
  reprogramada: "Esta cita se reprogramó (hay una nueva en su lugar)",
  completada: "Esta cita ya se completó",
  cancelada: "Esta cita fue cancelada",
  no_asistio: "El cliente no asistió a esta cita",
};

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
        <div aria-hidden="true" className={`h-1 ${est.dot}`} />
        <Spotlight color="rgba(79, 174, 178, 0.14)">
          <div className="flex items-start gap-3 border-b border-slate-100 py-3 pl-4 pr-2 sm:px-5 sm:py-4">
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

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {/* Fecha y hora: hoja de calendario con el día + rango grande con la duración. */}
          <div className="flex items-center gap-4 rounded-2xl border border-[#4FAEB2]/25 bg-gradient-to-br from-[#4FAEB2]/[0.07] via-white to-white p-3.5">
            <div className="flex w-14 shrink-0 flex-col overflow-hidden rounded-xl border border-[#4FAEB2]/30 bg-white text-center shadow-sm">
              <span className="bg-[#3F8E91] py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">{fmtMes(cita.inicio_at)}</span>
              <span className="py-1 text-xl font-bold leading-none tabular-nums text-slate-900">{fmtNumDia(cita.inicio_at)}</span>
            </div>
            <div className="min-w-0 flex-1">
              {/* first-letter:uppercase y no capitalize (que dejaría "Viernes 21 De Agosto"). */}
              <p className="text-[12px] font-medium text-slate-500 first-letter:uppercase">{fmtDia(cita.inicio_at)}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-semibold tabular-nums tracking-tight text-slate-900">
                {fmtHora(cita.inicio_at)} – {fmtHora(cita.fin_at)}
                {dur ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#4FAEB2]/12 px-2 py-0.5 text-[11px] font-semibold text-[#2F6E71]">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    {dur}
                  </span>
                ) : null}
              </p>
            </div>
          </div>

          {/* Datos en una sola tarjeta con filas: ícono · etiqueta · valor. */}
          <div className="mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-200">
            <Fila titulo={responsables.length > 1 ? "Responsables" : "Responsable"} icono={User}>
              <ul className="space-y-1.5">
                {responsables.map((r, i) => {
                  const nombre = nombreCapitular(r.nombre ?? r.id);
                  return (
                    <li key={r.id} className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${avatarClase(nombre)}`}
                      >
                        {inicialesNombre(r.nombre ?? r.id)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-800">{nombre}</span>
                      {i === 0 && responsables.length > 1 ? (
                        <span className="shrink-0 rounded-md bg-[#4FAEB2]/12 px-1.5 py-0.5 text-[10px] font-semibold text-[#3F8E91]">principal</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Fila>

            {cliente || telefono ? (
              <Fila titulo="Cliente / contacto" icono={Building2}>
                {cliente ? (
                  cita.cliente_id ? (
                    <Link href={`/clientes/${cita.cliente_id}`} className="text-[13px] font-medium text-slate-800 hover:text-[#3F8E91] hover:underline">
                      {cliente}
                    </Link>
                  ) : (
                    <p className="text-[13px] font-medium text-slate-800">{cliente}</p>
                  )
                ) : null}
                {telefono ? (
                  <a href={`tel:${telefono.replace(/\s+/g, "")}`} className="mt-0.5 flex w-fit items-center gap-1 text-[12px] text-slate-500 hover:text-[#3F8E91]">
                    <Phone className="h-3 w-3" aria-hidden="true" /> {telefono}
                  </a>
                ) : null}
                {cita.cliente_id && tipificacionId ? (
                  <Link
                    href={`/clientes/${cita.cliente_id}/tipificacion#tip-${tipificacionId}`}
                    className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-[#3F8E91] hover:underline"
                  >
                    <ClipboardPen className="h-3.5 w-3.5" /> Ver tipificación
                  </Link>
                ) : null}
              </Fila>
            ) : null}

            {cita.ubicacion ? (
              <Fila titulo="Ubicación / enlace" icono={MapPin}>
                {/^https?:\/\//i.test(cita.ubicacion.trim()) ? (
                  <a
                    href={cita.ubicacion.trim()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-[13px] font-medium text-[#3F8E91] underline underline-offset-2 hover:text-[#2F6E71]"
                  >
                    {cita.ubicacion}
                  </a>
                ) : (
                  <p className="break-words text-[13px] font-medium text-slate-800">{cita.ubicacion}</p>
                )}
              </Fila>
            ) : null}

            {cita.creado_por ? (
              <Fila titulo="Cargada por" icono={UserPlus}>
                <p className="text-[13px] text-slate-600">{nombreCapitular(cita.creado_por.nombre ?? cita.creado_por.id)}</p>
              </Fila>
            ) : null}
          </div>

          {cita.observaciones ? (
            <div className="mt-4 rounded-2xl border border-amber-200/70 bg-amber-50/50 px-4 py-3">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-700">
                <StickyNote className="h-3 w-3" aria-hidden="true" /> Observaciones
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-[13px] text-slate-700">{cita.observaciones}</p>
            </div>
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
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-5 sm:py-3.5">
          {terminal ? (
            <span className="flex items-center gap-2 text-xs text-slate-500">
              <Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
              {MSJ_TERMINAL[cita.estado] ?? `Esta cita está ${est.label.toLowerCase()}`}: ya no se puede modificar.
            </span>
          ) : !puede ? (
            <span className="flex items-center gap-2 text-xs text-slate-500"><Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />Sólo sus responsables, quien la cargó o un administrador pueden cambiarla.</span>
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
              <div className="ml-auto flex flex-wrap items-center gap-2 max-sm:order-first max-sm:ml-0 max-sm:grid max-sm:w-full max-sm:grid-cols-2">
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

function Fila({
  titulo,
  icono: Icono,
  children,
}: {
  titulo: string;
  icono: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 px-4 py-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
        <Icono className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{titulo}</p>
        {children}
      </div>
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
