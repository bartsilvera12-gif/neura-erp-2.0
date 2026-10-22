"use client";

/**
 * Piezas visuales de la fase 2 (copiadas del Monitoreo del sistema actual): reloj de 15 s
 * compartido, espera relativa, chip de SLA, selector de estado del asesor, tarjeta de
 * métrica, sección con filete turquesa y avatar con color estable.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronDown, Timer } from "lucide-react";
import { inicial } from "@/modules/conversaciones/dominio";
import {
  ESTADOS_ELEGIBLES, ESTADO_AGENTE_CLASE, ESTADO_AGENTE_LABEL, esperaLegible, tonoAvatar, type EstadoAgente,
} from "@/modules/conversaciones/supervision";

// ── Reloj compartido de 15 s (un solo setInterval para todas las etiquetas) ──
const subs = new Set<() => void>();
let reloj: number | null = null;
export function useReloj15(): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const fn = () => setT(Date.now());
    subs.add(fn);
    if (reloj == null) reloj = window.setInterval(() => subs.forEach((f) => f()), 15_000);
    return () => {
      subs.delete(fn);
      if (!subs.size && reloj != null) {
        window.clearInterval(reloj);
        reloj = null;
      }
    };
  }, []);
  return t;
}

/** "<1 min", "5 min", "1 h 20 min" — se actualiza sola cada 15 s. */
export function Desde({ iso }: { iso: string | null | undefined }) {
  const ahora = useReloj15();
  return <span className="tabular-nums">{esperaLegible(iso, ahora)}</span>;
}

// ── SLA de primera respuesta ─────────────────────────────────────────────────
/**
 * Cuenta regresiva del SLA (vence a los N min de asignada sin primera respuesta). Solo se
 * muestra mientras no hubo primera respuesta humana; vencido → rojo.
 */
export function SlaBadge({ vence, primera, compacta }: { vence: string | null | undefined; primera: string | null | undefined; compacta?: boolean }) {
  const ahora = useReloj15();
  if (!vence || primera) return null;
  const t = Date.parse(vence);
  if (!Number.isFinite(t)) return null;
  const restante = t - ahora;
  const base = compacta
    ? "inline-flex shrink-0 items-center gap-0.5 rounded border px-1.5 py-0.5 text-[9px] font-semibold"
    : "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold";
  if (restante <= 0) {
    return (
      <span className={`${base} border-rose-200 bg-rose-50 text-rose-700`} title="Venció el tiempo para la primera respuesta: el sistema puede reasignarla a otro asesor.">
        <Timer className={compacta ? "h-2.5 w-2.5" : "h-3 w-3"} aria-hidden /> SLA vencido{compacta ? "" : ` · hace ${esperaLegible(vence, ahora)}`}
      </span>
    );
  }
  const min = Math.max(1, Math.ceil(restante / 60_000));
  const poco = restante < 2 * 60_000;
  return (
    <span
      className={`${base} ${poco ? "border-amber-200 bg-amber-50 text-amber-800" : "border-sky-200 bg-sky-50 text-sky-800"}`}
      title="Tiempo para la primera respuesta antes de que el chat se reasigne a otro asesor."
    >
      <Timer className={compacta ? "h-2.5 w-2.5" : "h-3 w-3"} aria-hidden /> {compacta ? `${min} min` : `SLA: quedan ${min} min`}
    </span>
  );
}

// ── Estado del asesor ────────────────────────────────────────────────────────
export function PillEstado({ estado, online }: { estado: EstadoAgente; online?: boolean }) {
  const c = ESTADO_AGENTE_CLASE[estado];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${c.pill}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {ESTADO_AGENTE_LABEL[estado]}
      {online === false && estado !== "desconectado" ? <span className="font-normal opacity-70">· sin conexión</span> : null}
    </span>
  );
}

export function PuntoOnline({ online, className = "" }: { online: boolean; className?: string }) {
  return (
    <span
      aria-label={online ? "En línea" : "Fuera de línea"}
      title={online ? "En línea" : "Fuera de línea"}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${online ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]" : "bg-slate-300"} ${className}`}
    />
  );
}

/** Selector del estado del asesor (cabecera de la bandeja y del Monitoreo). */
export function SelectorEstado({
  estado,
  error,
  onCambiar,
  compacto = false,
}: {
  estado: EstadoAgente | null;
  error?: string | null;
  onCambiar: (e: Exclude<EstadoAgente, "desconectado">) => void;
  /** sólo el punto de color (celular: la barra de la bandeja no tiene lugar para el texto) */
  compacto?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setAbierto(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [abierto]);
  const c = estado ? ESTADO_AGENTE_CLASE[estado] : null;
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-label={compacto ? `Tu estado: ${estado ? ESTADO_AGENTE_LABEL[estado] : "conectando"}` : undefined}
        title={error ? `No se pudo actualizar tu estado: ${error}` : "Tu estado: define si te llegan chats nuevos"}
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-2 text-xs font-semibold shadow-sm transition-colors max-md:h-11 ${
          c ? c.pill : "border-slate-200 bg-white text-slate-500"
        } ${error ? "ring-2 ring-rose-200" : ""}`}
      >
        <span aria-hidden className={`h-2 w-2 rounded-full ${c ? c.dot : "animate-pulse bg-slate-300"}`} />
        <span className={compacto ? "sr-only" : ""}>{estado ? ESTADO_AGENTE_LABEL[estado] : "Conectando…"}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
      </button>
      {abierto ? (
        <div role="menu" className="absolute right-0 z-[60] mt-1 w-64 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl" style={{ animation: "modal-pop 0.15s cubic-bezier(0.16,1,0.3,1)" }}>
          {ESTADOS_ELEGIBLES.map((o) => (
            <button
              key={o.id}
              type="button"
              role="menuitemradio"
              aria-checked={estado === o.id}
              onClick={() => {
                setAbierto(false);
                if (estado !== o.id) onCambiar(o.id);
              }}
              className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-slate-50 max-md:min-h-12"
            >
              <span aria-hidden className={`mt-1 h-2 w-2 shrink-0 rounded-full ${ESTADO_AGENTE_CLASE[o.id].dot}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-slate-800">{o.label}</span>
                <span className="block text-[11px] leading-snug text-slate-500">{o.detalle}</span>
              </span>
              {estado === o.id ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#3F8E91]" aria-hidden /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── Estructura de pantalla (look del Monitoreo actual) ───────────────────────
/** Destino del "← Omnicanal" de las pantallas del módulo (el panel de tarjetas). */
export const VOLVER_OMNICANAL = { href: "/omnicanal", label: "Omnicanal" } as const;

/** "← Omnicanal": mismo look que el `volver` de EncabezadoPagina. */
export function VolverOmnicanal({ href = VOLVER_OMNICANAL.href, label = VOLVER_OMNICANAL.label, className = "" }: { href?: string; label?: string; className?: string }) {
  return (
    <Link href={href} className={`-ml-1 inline-flex min-h-9 items-center gap-1 rounded-lg px-1 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-800 ${className}`}>
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {label}
    </Link>
  );
}

export function Encabezado({ eyebrow, titulo, detalle, children, volver }: {
  eyebrow: string;
  titulo: string;
  detalle?: ReactNode;
  children?: ReactNode;
  /** link "← …" arriba del título (ej. al panel Omnicanal) */
  volver?: { href: string; label: string };
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        {volver ? <VolverOmnicanal href={volver.href} label={volver.label} className="mb-1.5" /> : null}
        <div className="flex items-center gap-2">
          <span aria-hidden className="h-2 w-2 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">{eyebrow}</p>
        </div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 [overflow-wrap:anywhere] sm:text-2xl">{titulo}</h1>
        {detalle ? <p className="mt-1 max-w-2xl text-[13px] text-slate-500 sm:text-sm">{detalle}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}

// Al dedo (celular / táctil) los botones miden 44 px (min-h/min-w: no pisan el diseño de escritorio).
export const btnSecundario =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:text-[#3F8E91] disabled:cursor-not-allowed disabled:opacity-50 max-sm:min-h-11 [@media(pointer:coarse)]:min-h-11";
export const btnPrimario =
  "inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91] disabled:opacity-50 max-sm:min-h-11 [@media(pointer:coarse)]:min-h-11";
export const btnIcono =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:bg-[#4FAEB2]/8 hover:text-[#3F8E91] disabled:opacity-50 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11";
export const thClase = "px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500";

export function Seccion({
  titulo,
  contador,
  tonoContador = "slate",
  ayuda,
  acciones,
  destacada,
  children,
}: {
  titulo: string;
  contador?: number;
  tonoContador?: "amber" | "orange" | "slate" | "teal";
  ayuda?: ReactNode;
  acciones?: ReactNode;
  destacada?: boolean;
  children: ReactNode;
}) {
  const pill = {
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    orange: "border-orange-200 bg-orange-50 text-orange-700",
    slate: "border-slate-200 bg-slate-50 text-slate-600",
    teal: "border-[#4FAEB2]/30 bg-[#4FAEB2]/10 text-[#3F8E91]",
  }[tonoContador];
  return (
    <section className={`min-w-0 rounded-2xl border bg-white p-4 shadow-sm sm:p-6 ${destacada ? "border-[#4FAEB2]/45" : "border-slate-200"}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span aria-hidden className="block h-5 w-1 rounded-full bg-[#4FAEB2]" />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">{titulo}</h2>
            {contador != null ? <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums ${pill}`}>{contador}</span> : null}
          </div>
          {ayuda ? <p className="mt-1.5 max-w-3xl pl-3 text-[11px] text-slate-500 max-sm:text-xs">{ayuda}</p> : null}
        </div>
        {acciones ? <div className="flex flex-wrap items-center gap-2">{acciones}</div> : null}
      </div>
      {children}
    </section>
  );
}

type Tono = "neutral" | "warning" | "success" | "featured" | "danger";
export function Metrica({ label, valor, icono, tono = "neutral", pie }: { label: string; valor: ReactNode; icono: ReactNode; tono?: Tono; pie?: ReactNode }) {
  const card =
    tono === "featured"
      ? "relative min-w-0 overflow-hidden rounded-2xl border border-[#4FAEB2]/55 bg-gradient-to-br from-white via-white to-[#4FAEB2]/8 p-3.5 shadow-[0_4px_18px_rgba(79,174,178,0.08)] sm:p-4"
      : "min-w-0 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-4";
  const chip = {
    featured: "border-[#4FAEB2]/30 bg-[#4FAEB2]/12 text-[#4FAEB2]",
    warning: "border-amber-200 bg-amber-50 text-amber-600",
    success: "border-emerald-200 bg-emerald-50 text-emerald-600",
    danger: "border-rose-200 bg-rose-50 text-rose-600",
    neutral: "border-slate-200 bg-slate-50 text-slate-500",
  }[tono];
  const valorCls = { featured: "text-[#3F8E91]", warning: "text-amber-700", success: "text-emerald-700", danger: "text-rose-700", neutral: "text-slate-900" }[tono];
  return (
    <div className={card}>
      {tono === "featured" ? (
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#4FAEB2] via-[#4FAEB2]/70 to-[#4FAEB2]/30" />
      ) : null}
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${chip}`}>{icono}</span>
      <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${valorCls}`}>{valor}</p>
      {pie ? <p className="mt-0.5 text-[11px] text-slate-400">{pie}</p> : null}
    </div>
  );
}

export function AvatarTono({ nombre, chico }: { nombre: string; chico?: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full border font-semibold ${chico ? "h-7 w-7 text-[10px]" : "h-8 w-8 text-[11px]"} ${tonoAvatar(nombre)}`}
    >
      {inicial(nombre)}
    </span>
  );
}

export function Cargando({ texto = "Cargando…" }: { texto?: string }) {
  return (
    <div className="flex items-center gap-3 py-8 text-sm text-slate-500">
      <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-[#4FAEB2]" />
      {texto}
    </div>
  );
}

export function Vacio({ children, ok }: { children: ReactNode; ok?: boolean }) {
  if (ok) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
          <Check className="h-4 w-4" aria-hidden />
        </span>
        {children}
      </div>
    );
  }
  return <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">{children}</p>;
}
