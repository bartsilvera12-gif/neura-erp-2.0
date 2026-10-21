"use client";

/**
 * Piezas visuales de Configuración › Facturación y › Facturación electrónica: tarjeta con
 * ícono (mismo estilo que Datos de la empresa), campo con etiqueta/ayuda, interruptor
 * accesible (44 px de toque en celular), avisos y la cifra del resumen.
 */
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

export function Tarjeta({ icono, titulo, detalle, acciones, children, className = "" }: {
  icono: ReactNode; titulo: ReactNode; detalle?: ReactNode; acciones?: ReactNode; children?: ReactNode; className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5 ${className}`}>
      <header className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${children ? "mb-4" : ""}`}>
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--brand-50,#eef7f7)] text-[var(--brand)]">{icono}</span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">{titulo}</h2>
            {detalle ? <div className="mt-0.5 text-xs leading-relaxed text-slate-500">{detalle}</div> : null}
          </div>
        </div>
        {acciones ? <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:[&>*]:min-h-11 max-sm:[&>*]:w-full sm:pl-2">{acciones}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function Campo({ etiqueta, requerido, opcional, ayuda, sinLabel = false, className = "", children }: {
  etiqueta: ReactNode; requerido?: boolean; opcional?: boolean; ayuda?: ReactNode; className?: string; children: ReactNode;
  /** el control no es un input (Select / SelectorFecha: botón con su lista aparte) */
  sinLabel?: boolean;
}) {
  const Raiz = sinLabel ? "div" : "label";
  return (
    <Raiz className={`block min-w-0 ${className}`}>
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {etiqueta}
        {requerido ? <span className="text-rose-500"> *</span> : null}
        {opcional ? <span className="font-normal text-slate-400"> (opcional)</span> : null}
      </span>
      {children}
      {ayuda ? <span className="mt-1 block text-[11px] leading-snug text-slate-400">{ayuda}</span> : null}
    </Raiz>
  );
}

/** Interruptor (role=switch). En celular el área de toque es de 44 px. */
export function Interruptor({ activo, onChange, etiqueta, disabled = false, descripcion }: {
  activo: boolean; onChange: (v: boolean) => void; etiqueta: ReactNode; disabled?: boolean; descripcion?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      disabled={disabled}
      onClick={() => onChange(!activo)}
      className="group flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0 sm:py-2.5"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800">{etiqueta}</span>
        {descripcion ? <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">{descripcion}</span> : null}
      </span>
      <span aria-hidden className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${activo ? "bg-[var(--brand)]" : "bg-slate-300"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${activo ? "translate-x-[22px]" : "translate-x-0.5"}`} />
      </span>
    </button>
  );
}

export function Aviso({ tono = "info", children, className = "" }: { tono?: "info" | "ok" | "alerta" | "error"; children: ReactNode; className?: string }) {
  const estilos = {
    info: "border-slate-200 bg-slate-50 text-slate-600",
    ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
    alerta: "border-amber-200 bg-amber-50 text-amber-800",
    error: "border-rose-200 bg-rose-50 text-rose-800",
  }[tono];
  const Icono = tono === "ok" ? CheckCircle2 : tono === "info" ? Info : AlertTriangle;
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-relaxed sm:text-[13px] ${estilos} ${className}`}>
      <Icono className="mt-px h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Cifra({ etiqueta, valor, mono = false }: { etiqueta: string; valor: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{etiqueta}</p>
      <p className={`mt-0.5 truncate text-sm font-semibold text-slate-800 ${mono ? "font-mono tabular-nums" : ""}`}>{valor}</p>
    </div>
  );
}

/** Chip de estado (Estado de la configuración SIFEN). */
export function Chip({ tono, children }: { tono: "ok" | "marca" | "neutro" | "alerta" | "violeta"; children: ReactNode }) {
  const estilos = {
    ok: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    marca: "bg-[var(--brand-50,#eef7f7)] text-[var(--brand)] ring-[var(--brand-100)]",
    neutro: "bg-slate-100 text-slate-600 ring-slate-200",
    alerta: "bg-amber-50 text-amber-800 ring-amber-200",
    violeta: "bg-violet-50 text-violet-900 ring-violet-200",
  }[tono];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${estilos}`}>{children}</span>;
}

export const fechaCorta = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

export const fechaHora = (iso: string) =>
  new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
