"use client";

/**
 * Piezas compartidas de Tareas del equipo, Dashboard Ejecutivo y Dashboard PM (las del
 * dashboard-ui del sistema actual): tarjeta, título, KPI con ícono, barra simple (divs,
 * sin librerías de gráficos), estado de carga y formatos. Sin gráficos a propósito.
 */
import { useEffect, useRef } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  PRIORIDAD_LABEL, SEMAFORO_TONO, estiloPrioridad, nombreCorto,
  type Metrica, type Prioridad, type Semaforo,
} from "@/modules/proyectos/tipos";

export const TABLA_TH = "pb-1.5 pr-2 text-[10px] font-medium uppercase tracking-wide text-slate-400";
export const TABLA_TD = "py-2 pr-2 text-[12px]";

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}>{children}</div>;
}

export function CardTitle({ children, right, sub }: { children: React.ReactNode; right?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="h-4 w-1 rounded-full bg-[var(--brand)]" />
          <h2 className="truncate text-[13px] font-semibold text-slate-800">{children}</h2>
        </div>
        {sub ? <p className="mt-0.5 pl-3 text-[11px] text-slate-400">{sub}</p> : null}
      </div>
      {right}
    </div>
  );
}

export type Tono = "teal" | "verde" | "rojo" | "ambar" | "naranja" | "azul" | "violeta" | "gris";
const TONOS: Record<Tono, { circulo: string; icono: string }> = {
  teal: { circulo: "bg-[var(--brand)]/12", icono: "text-[var(--brand)]" },
  verde: { circulo: "bg-emerald-50", icono: "text-emerald-500" },
  rojo: { circulo: "bg-rose-50", icono: "text-rose-500" },
  ambar: { circulo: "bg-amber-50", icono: "text-amber-500" },
  naranja: { circulo: "bg-orange-50", icono: "text-orange-500" },
  azul: { circulo: "bg-sky-50", icono: "text-sky-500" },
  violeta: { circulo: "bg-violet-50", icono: "text-violet-500" },
  gris: { circulo: "bg-slate-100", icono: "text-slate-500" },
};

/** KPI del actual: círculo con ícono + etiqueta, número grande y pie. Clic opcional (filtra). */
export function Kpi({ icon: Icon, tono, label, valor, pie, pieTono, onClick, activo }: {
  icon: React.ComponentType<{ className?: string }>;
  tono: Tono;
  label: string;
  valor: React.ReactNode;
  pie?: React.ReactNode;
  pieTono?: "bueno" | "malo";
  onClick?: () => void;
  activo?: boolean;
}) {
  const t = TONOS[tono];
  const cuerpo = (
    <>
      <div className="flex items-start gap-2.5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${t.circulo}`}><Icon className={`h-4 w-4 ${t.icono}`} /></span>
        <span className="min-w-0 pt-0.5 text-[12px] leading-tight text-slate-500">{label}</span>
      </div>
      <div className="mt-2 truncate text-[26px] font-bold leading-none tracking-tight tabular-nums text-slate-800">{valor}</div>
      <div className={`mt-1.5 truncate text-[11px] font-medium ${pieTono === "malo" ? "text-rose-500" : pieTono === "bueno" ? "text-emerald-600" : "text-slate-400"}`}>{pie ?? "—"}</div>
    </>
  );
  const base = "rounded-2xl border bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow";
  if (!onClick) return <div className={`${base} border-slate-200`}>{cuerpo}</div>;
  return (
    <button type="button" onClick={onClick} aria-pressed={activo}
      className={`${base} cursor-pointer hover:shadow-md ${activo ? "border-transparent ring-2 ring-[var(--brand)] ring-offset-1" : "border-slate-200"}`}>
      {cuerpo}
    </button>
  );
}

/** Barra horizontal simple (proporción 0..1), con color propio o por tono. */
export function Barra({ valor, max, color, clase = "bg-[var(--brand)]", alto = "h-1.5", marca }: {
  valor: number; max: number; color?: string; clase?: string; alto?: string; /** línea de referencia (0..max) */ marca?: number;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (valor / max) * 100)) : 0;
  const mk = marca != null && max > 0 ? Math.max(0, Math.min(100, (marca / max) * 100)) : null;
  return (
    <div className={`relative w-full overflow-hidden rounded-full bg-slate-100 ${alto}`}>
      <div className={`h-full rounded-full ${color ? "" : clase}`} style={{ width: `${pct}%`, ...(color ? { background: color } : {}) }} />
      {mk != null ? <span aria-hidden className="absolute inset-y-0 w-px bg-slate-500/60" style={{ left: `${mk}%` }} /> : null}
    </div>
  );
}

export function Cargando({ alto = "h-[118px]", n = 8 }: { alto?: string; n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: n }).map((_, i) => <div key={i} className={`${alto} animate-pulse rounded-2xl border border-slate-200 bg-white/60`} />)}
    </div>
  );
}

export function ErrorCaja({ error, onReintentar }: { error: string; onReintentar?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      <span className="inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" /> {error}</span>
      {onReintentar ? <button type="button" onClick={onReintentar} className="font-semibold underline">Reintentar</button> : null}
    </div>
  );
}

export function Girando({ activo }: { activo: boolean }) {
  return activo ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" /> : null;
}

/** Píldora de estado con el color que configuró la empresa. */
export function EstadoPill({ nombre, color }: { nombre: string; color: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 truncate whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: `${color}1A`, color }} title={nombre}>
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      {nombre}
    </span>
  );
}

export function PrioridadPill({ p }: { p: Prioridad }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-4 ${estiloPrioridad(p).badge}`}>{PRIORIDAD_LABEL[p] ?? p}</span>;
}

/** Horas laborales legibles, como el actual: "45 min", "4,5 h", "44 h". */
export function fmtHoras(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h)) return "—";
  if (h < 1) return `${Math.max(0, Math.round(h * 60))} min`;
  if (h < 10) return `${(Math.round(h * 10) / 10).toString().replace(".", ",")} h`;
  return `${Math.round(h).toLocaleString("es-PY")} h`;
}

/** Badge del SLA del estado: horas en el estado (y % del objetivo) con el semáforo. */
export function SemaforoBadge({ horas, objetivo, semaforo, pct }: { horas: number; objetivo: number | null; semaforo: Semaforo; pct: number | null }) {
  const titulo = semaforo === "sin_sla"
    ? "Horas laborales en el estado actual (este estado no cuenta SLA o no tiene objetivo)"
    : `SLA del estado: ${fmtHoras(horas)} de ${fmtHoras(objetivo)} laborales (${pct ?? 0}%)`;
  return (
    <span title={titulo} className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-4 tabular-nums ${SEMAFORO_TONO[semaforo]}`}>
      {semaforo === "sin_sla" ? `En estado ${fmtHoras(horas)}` : semaforo === "rojo" ? `Vencido · ${fmtHoras(horas)} / ${fmtHoras(objetivo)}` : `${fmtHoras(horas)} / ${fmtHoras(objetivo)}`}
    </span>
  );
}

export const persona = (n: string | null | undefined) => (n ? nombreCorto(n) : null);

/** Celda "Proyecto": título clickeable (abre el detalle) + número y cliente. */
export function CeldaProyecto({ m, onAbrir }: { m: Pick<Metrica, "id" | "numero" | "titulo" | "cliente_nombre">; onAbrir: (id: string) => void }) {
  return (
    <div className="min-w-0">
      <button type="button" onClick={() => onAbrir(m.id)} className="block max-w-full truncate text-left font-semibold text-slate-800 hover:text-[var(--brand-600)] hover:underline" title={m.titulo}>
        {m.titulo}
      </button>
      <div className="truncate text-[11px] text-slate-400"><span className="font-mono">{m.numero}</span>{m.cliente_nombre ? ` · ${m.cliente_nombre}` : ""}</div>
    </div>
  );
}

/**
 * Refresco periódico SOLO con la pestaña visible: cada `ms` llama a `cb`; oculta no pide
 * nada y, al volver, refresca enseguida si ya pasó el intervalo.
 */
export function useRefrescoVisible(cb: () => void, ms: number) {
  const ref = useRef(cb);
  useEffect(() => { ref.current = cb; }, [cb]);
  useEffect(() => {
    let ultimo = Date.now();
    const correr = () => { ultimo = Date.now(); ref.current(); };
    const id = setInterval(() => { if (!document.hidden) correr(); }, ms);
    const alVolver = () => { if (!document.hidden && Date.now() - ultimo >= ms) correr(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", alVolver); };
  }, [ms]);
}
