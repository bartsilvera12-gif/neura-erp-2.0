"use client";

/**
 * Piezas visuales compartidas por las pantallas de documentos de Inventario (Traslados,
 * Ajustes y pérdidas, Depósitos): cabecera, pestañas, paginado, modal de documento
 * (CapaModal con cabecera y pie fijos) y el modal "pedir motivo" (anular / rechazar).
 */
import { useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { clienteConfig } from "@/cliente.config";

export const TEAL = clienteConfig.color;
export const INPUT = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)] disabled:bg-slate-50 disabled:text-slate-400";
export const INPUT_FILTRO = "h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
export const ET = "mb-1 block text-xs font-medium text-slate-600";
export const BOTON_PRIMARIO = "inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 active:scale-[0.98] disabled:opacity-40";
export const BOTON_SECUNDARIO = "inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:opacity-50";

export function Cabecera({ kicker, titulo, subtitulo, children }: { kicker: string; titulo: string; subtitulo?: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>{kicker}</p>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{titulo}</h1>
        {subtitulo ? <p className="mt-1 text-sm text-slate-500">{subtitulo}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}

export function Pestanas({ opciones, valor, onChange }: {
  opciones: { id: string; label: string; badge?: number }[];
  valor: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100/80 p-1" role="tablist">
      {opciones.map((o) => {
        const sel = valor === o.id;
        return (
          <button key={o.id} role="tab" aria-selected={sel} onClick={() => onChange(o.id)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${sel ? "bg-white text-[var(--brand)] shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
            {o.label}
            {o.badge ? (
              <span className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums ${sel ? "bg-[var(--brand)] text-white" : "bg-amber-100 text-amber-700"}`}>{o.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function Paginador({ pagina, porPagina, total, cargando, onCambiar }: {
  pagina: number; porPagina: number; total: number; cargando?: boolean; onCambiar: (n: number) => void;
}) {
  if (total <= 0) return null;
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const de = (pagina - 1) * porPagina + 1;
  const a = Math.min(pagina * porPagina, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/40 px-5 py-3.5">
      <p className="text-xs text-slate-500">
        Mostrando <span className="font-semibold text-slate-700">{de.toLocaleString("es-PY")}</span>–<span className="font-semibold text-slate-700">{a.toLocaleString("es-PY")}</span> de{" "}
        <span className="font-semibold text-slate-700">{total.toLocaleString("es-PY")}</span>
      </p>
      <div className="flex items-center gap-1.5">
        <button disabled={pagina <= 1 || cargando} onClick={() => onCambiar(pagina - 1)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-40">
          <ChevronLeft className="h-3.5 w-3.5" /> Anterior
        </button>
        <span className="px-3 py-1.5 text-xs font-semibold tabular-nums text-slate-700">{pagina} / {totalPaginas}</span>
        <button disabled={pagina >= totalPaginas || cargando} onClick={() => onCambiar(pagina + 1)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-40">
          Siguiente <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Modal de documento: cabecera y pie fijos, cuerpo con scroll (patrón de CapaModal). */
export function ModalDocumento({ titulo, subtitulo, extra, ancho = "max-w-3xl", onClose, footer, children }: {
  titulo: React.ReactNode;
  subtitulo?: React.ReactNode;
  extra?: React.ReactNode;
  ancho?: string;
  onClose?: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <CapaModal onClose={onClose} z="z-[110]">
      <div role="dialog" aria-modal="true"
        className={`flex w-full ${ancho} ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-[#4FAEB2]/15`}
        style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-900">{titulo}</h2>
            {subtitulo ? <p className="mt-0.5 text-xs text-slate-500">{subtitulo}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {extra}
            {onClose ? (
              <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3.5">{footer}</div> : null}
      </div>
    </CapaModal>
  );
}

/** Pide un motivo y confirma (anular, rechazar). */
export function PedirMotivo({ titulo, descripcion, etiqueta = "Motivo", confirmar, onConfirmar, onClose }: {
  titulo: string;
  descripcion: React.ReactNode;
  etiqueta?: string;
  confirmar: string;
  onConfirmar: (motivo: string) => Promise<void>;
  onClose: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function ok() {
    if (!motivo.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirmar(motivo.trim());
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <CapaModal onClose={busy ? undefined : onClose} z="z-[130]" fondo="bg-slate-900/40 backdrop-blur-sm">
      <div className={`flex w-full max-w-md ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5`} style={{ animation: "rb-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="shrink-0 border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">{titulo}</h3>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div className="text-[13px] leading-relaxed text-slate-600">{descripcion}</div>
          <label className="block">
            <span className={ET}>{etiqueta} *</span>
            <textarea autoFocus rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} className={`${INPUT} resize-none`} />
          </label>
          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
        </div>
        <div className="flex shrink-0 gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
          <button type="button" onClick={onClose} disabled={busy} className="flex-1 rounded-lg border-2 border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">Volver</button>
          <button type="button" onClick={ok} disabled={busy || !motivo.trim()} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {confirmar}
          </button>
        </div>
      </div>
    </CapaModal>
  );
}

/** Dato con etiqueta (fichas de documentos). */
export function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{etiqueta}</p>
      <div className="mt-0.5 truncate text-sm text-slate-800">{children}</div>
    </div>
  );
}
