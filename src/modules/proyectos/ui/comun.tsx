"use client";

/**
 * Piezas compartidas de Proyectos: estilos (los mismos del CRM), modal grande del
 * detalle / alta, persona con avatar, badge de SLA que corre solo, chip de estado y
 * el modal de motivo (pausa / cancelación).
 */
import { memo, useCallback, useState } from "react";
import { Ban, Pause } from "lucide-react";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { BTN_PRIMARIO, BTN_SECUNDARIO, INPUT, LABEL } from "@/modules/crm/ui/comun";
import {
  TONO_SLA, iniciales, nombreCorto, slaEstado,
  type Estado, type HorarioLaboral,
} from "@/modules/proyectos/tipos";
import { useAhora } from "./reloj";

export { BTN_PRIMARIO, BTN_SECUNDARIO, INPUT, LABEL, SectionTitle, useAvisos, useUsuarios } from "@/modules/crm/ui/comun";

export const PANEL = "min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5";

export function TituloPanel({ children, extra }: { children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-5 w-1 rounded-full bg-[var(--brand)]" />
      <h2 className="text-sm font-semibold text-slate-900">{children}</h2>
      {extra ? <div className="ml-auto">{extra}</div> : null}
    </div>
  );
}

// ── Modal grande (detalle / alta) ────────────────────────────────────────────
/**
 * Panel del modal: flex-col + overflow-hidden; cabecera y pie shrink-0; el cuerpo
 * (lo pone cada contenido) min-h-0 flex-1 overflow-y-auto. Nunca queda cortado.
 */
export function ModalProyecto({ onClose, children, ancho = "max-w-5xl", etiqueta }: {
  onClose: () => void; children: React.ReactNode; ancho?: string; etiqueta?: string;
}) {
  // Si hay un modal chico encima (motivo, confirmar), el Escape lo cierra a él primero.
  const cerrar = useCallback(() => {
    if (!document.querySelector("[data-modal-chico]")) onClose();
  }, [onClose]);
  return (
    <CapaModal onClose={cerrar} z="z-[45]" fondo="bg-slate-900/55 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={etiqueta}
        className={`relative flex h-[min(90dvh,940px)] ${ALTO_MAX_MODAL} w-full ${ancho} flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ring-1 ring-[var(--brand)]/15`}
        style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}
      >
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-1 bg-gradient-to-r from-[var(--brand)] via-[var(--brand)]/80 to-[var(--brand)]/40" />
        {children}
      </div>
    </CapaModal>
  );
}

/** Modal chico (motivo, confirmaciones, configurar estados): cabecera y pie fijos, cuerpo con scroll. */
export function ModalChico({ titulo, subtitulo, icono, tono = "brand", onClose, children, pie, ancho = "max-w-md" }: {
  titulo: string; subtitulo?: React.ReactNode; icono?: React.ReactNode; tono?: "brand" | "amber" | "rose";
  onClose: () => void; children: React.ReactNode; pie?: React.ReactNode; ancho?: string;
}) {
  const barra = tono === "amber" ? "from-amber-400 via-amber-400/80 to-amber-300/40" : tono === "rose" ? "from-rose-500 via-rose-500/80 to-rose-400/40" : "from-[var(--brand)] via-[var(--brand)]/80 to-[var(--brand)]/40";
  const chip = tono === "amber" ? "bg-amber-50 text-amber-600 ring-amber-200" : tono === "rose" ? "bg-rose-50 text-rose-600 ring-rose-200" : "bg-[var(--brand-50)] text-[var(--brand)] ring-[var(--brand)]/25";
  return (
    <CapaModal onClose={onClose} z="z-[60]" fondo="bg-slate-900/45 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        data-modal-chico
        className={`relative flex w-full ${ancho} ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl`}
        style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <span aria-hidden className={`pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${barra}`} />
        <div className="flex shrink-0 items-start gap-3 border-b border-slate-100 px-4 pb-3 pt-4 sm:px-5 sm:pb-4 sm:pt-5">
          {icono ? <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ${chip}`}>{icono}</div> : null}
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-slate-900">{titulo}</h2>
            {subtitulo ? <div className="mt-1 text-xs text-slate-500">{subtitulo}</div> : null}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">{children}</div>
        {pie ? <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 px-4 py-3 max-sm:[&>*]:flex-1 sm:px-5">{pie}</div> : null}
      </div>
    </CapaModal>
  );
}

// ── Motivo de pausa / cancelación ────────────────────────────────────────────
export function MotivoModal({ estado, proyecto, onCancel, onConfirm }: {
  estado: Pick<Estado, "nombre" | "tipo_sla" | "rol">; proyecto: string; onCancel: () => void; onConfirm: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const cancelar = estado.rol === "cancelado";
  const sugerencias = cancelar
    ? ["El cliente desistió", "Sin presupuesto", "Proyecto duplicado", "No se pudo concretar"]
    : ["Falta material del cliente", "Esperando un pago", "Prioridad de otro proyecto", "Bloqueo de un tercero"];
  return (
    <ModalChico
      titulo={cancelar ? "Cancelar proyecto" : `Pasar a ${estado.nombre}`}
      subtitulo={<>Dejá acotado por qué{cancelar ? " se cancela" : " se pausa"} <strong className="text-slate-700">{proyecto}</strong>. Queda en el historial.</>}
      icono={cancelar ? <Ban className="h-[18px] w-[18px]" /> : <Pause className="h-[18px] w-[18px]" />}
      tono={cancelar ? "rose" : "amber"}
      onClose={onCancel}
      pie={
        <>
          <button type="button" onClick={onCancel} className={BTN_SECUNDARIO}>Volver</button>
          <button
            type="button"
            disabled={!motivo.trim()}
            onClick={() => onConfirm(motivo.trim())}
            className={`rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none ${cancelar ? "bg-rose-600 hover:bg-rose-700" : "bg-amber-500 hover:bg-amber-600"}`}
          >
            {cancelar ? "Cancelar proyecto" : "Pausar proyecto"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {sugerencias.map((s) => (
            <button key={s} type="button" onClick={() => setMotivo(s)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${motivo === s ? (cancelar ? "border-rose-300 bg-rose-50 text-rose-700" : "border-amber-300 bg-amber-50 text-amber-700") : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
              {s}
            </button>
          ))}
        </div>
        <label className="block">
          <span className={LABEL}>Motivo <span className="text-rose-500">*</span></span>
          <textarea
            autoFocus
            rows={3}
            value={motivo}
            maxLength={1000}
            onChange={(e) => setMotivo(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && motivo.trim()) onConfirm(motivo.trim()); }}
            placeholder={cancelar ? "Por qué no continúa…" : "Ej.: falta que el cliente mande el logo y los textos."}
            className={`${INPUT} resize-none`}
          />
        </label>
      </div>
    </ModalChico>
  );
}

// ── Confirmación simple ──────────────────────────────────────────────────────
export function Confirmar({ titulo, texto, accion, peligro = false, ocupado = false, onCancel, onConfirm }: {
  titulo: string; texto: React.ReactNode; accion: string; peligro?: boolean; ocupado?: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <ModalChico
      titulo={titulo}
      tono={peligro ? "rose" : "brand"}
      onClose={onCancel}
      pie={
        <>
          <button type="button" onClick={onCancel} className={BTN_SECUNDARIO} disabled={ocupado}>Cancelar</button>
          <button type="button" onClick={onConfirm} disabled={ocupado}
            className={peligro ? "rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-rose-700 disabled:opacity-50" : BTN_PRIMARIO}>
            {ocupado ? "Procesando…" : accion}
          </button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-slate-600">{texto}</div>
    </ModalChico>
  );
}

// ── Persona (rol + avatar + nombre corto) ───────────────────────────────────
const COLORES_PERSONA = ["#4FAEB2", "#8b5cf6", "#f59e0b", "#ec4899", "#22c55e", "#0ea5e9"];

export function colorPersona(nombre: string): string {
  let h = 0;
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) >>> 0;
  return COLORES_PERSONA[h % COLORES_PERSONA.length];
}

export const Avatar = memo(function Avatar({ nombre, tam = 20 }: { nombre: string; tam?: number }) {
  const color = colorPersona(nombre);
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full font-bold"
      style={{ width: tam, height: tam, fontSize: Math.max(8, Math.round(tam * 0.4)), background: `${color}22`, color }}
    >
      {iniciales(nombre)}
    </span>
  );
});

export function PersonaMeta({ rol, nombre }: { rol: string; nombre?: string | null }) {
  const completo = (nombre ?? "").trim();
  if (!completo) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="w-7 shrink-0 text-[9px] font-bold uppercase tracking-wide text-slate-400">{rol}</span>
        <span className="text-[11px] text-slate-300">Sin asignar</span>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-1.5" title={`${rol}: ${completo}`}>
      <span className="w-7 shrink-0 text-[9px] font-bold uppercase tracking-wide text-slate-400">{rol}</span>
      <Avatar nombre={completo} />
      <span className="min-w-0 truncate text-[11px] font-medium text-slate-700">{nombreCorto(completo)}</span>
    </div>
  );
}

// ── Badge de SLA del estado actual (corre solo cada minuto) ─────────────────
export function SlaBadge({ desde, estado, horario, className = "" }: {
  desde: string | null | undefined;
  estado: Pick<Estado, "tipo_sla" | "sla_horas_objetivo" | "es_final"> | null | undefined;
  horario: HorarioLaboral;
  className?: string;
}) {
  const ahora = useAhora();
  if (!ahora || !estado || estado.es_final) return null;
  const s = slaEstado(desde, estado, horario, ahora);
  return (
    <span title={s.titulo} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium leading-4 tabular-nums ${TONO_SLA[s.nivel]} ${className}`}>
      {s.texto}
    </span>
  );
}

export function EstadoChip({ nombre, color, className = "" }: { nombre: string; color: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${className}`}
      style={{ borderColor: `${color}55`, background: `${color}14`, color }}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {nombre}
    </span>
  );
}
