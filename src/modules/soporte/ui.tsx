"use client";

/**
 * Sistema visual del módulo Soporte (copia del actual: turquesa Zentra como acento,
 * fondos claros, bordes finos, y cada concepto con su tono: QA violeta, Técnico
 * celeste, lo resuelto verde, lo vencido rojo).
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Check, ChevronDown, Loader2, Search, type LucideIcon } from "lucide-react";
import { Select } from "@/components/Select";
import { HojaInferior } from "@/components/HojaInferior";
import { useEsMovil } from "@/lib/ui/responsive";
import { buscar } from "@/lib/busqueda";

export const ACENTO = "#4FAEB2";
export const ACENTO_OSC = "#2F6E71";

export type Tono = "turquesa" | "celeste" | "azul" | "violeta" | "ambar" | "naranja" | "verde" | "rosa" | "pizarra" | "indigo";

export const TONOS: Record<Tono, { suave: string; texto: string; borde: string; solido: string; hex: string }> = {
  turquesa: { suave: "bg-[#4FAEB2]/12", texto: "text-[#2F6E71]", borde: "border-[#4FAEB2]/30", solido: "bg-[#4FAEB2]", hex: "#4FAEB2" },
  celeste: { suave: "bg-sky-100", texto: "text-sky-700", borde: "border-sky-200", solido: "bg-sky-500", hex: "#0ea5e9" },
  azul: { suave: "bg-blue-100", texto: "text-blue-700", borde: "border-blue-200", solido: "bg-blue-500", hex: "#3b82f6" },
  violeta: { suave: "bg-violet-100", texto: "text-violet-700", borde: "border-violet-200", solido: "bg-violet-500", hex: "#8b5cf6" },
  ambar: { suave: "bg-amber-100", texto: "text-amber-700", borde: "border-amber-200", solido: "bg-amber-500", hex: "#f59e0b" },
  naranja: { suave: "bg-orange-100", texto: "text-orange-700", borde: "border-orange-200", solido: "bg-orange-500", hex: "#f97316" },
  verde: { suave: "bg-emerald-100", texto: "text-emerald-700", borde: "border-emerald-200", solido: "bg-emerald-500", hex: "#10b981" },
  rosa: { suave: "bg-rose-100", texto: "text-rose-700", borde: "border-rose-200", solido: "bg-rose-500", hex: "#f43f5e" },
  pizarra: { suave: "bg-slate-100", texto: "text-slate-700", borde: "border-slate-200", solido: "bg-slate-600", hex: "#475569" },
  indigo: { suave: "bg-indigo-100", texto: "text-indigo-700", borde: "border-indigo-200", solido: "bg-indigo-500", hex: "#6366f1" },
};

export const PALETA_TIPOS = ["#4FAEB2", "#8b5cf6", "#f59e0b", "#0ea5e9", "#f43f5e", "#10b981", "#6366f1"];

export const TONO_ESTADO: Record<string, Tono> = {
  pendiente: "pizarra",
  en_proceso: "celeste",
  falta_informacion: "ambar",
  listo_revision: "violeta",
  reabierto: "naranja",
  resuelto: "verde",
  cancelado: "rosa",
  cerrado: "pizarra",
};

export const TONO_AREA: Record<string, Tono> = { Técnico: "celeste", QA: "violeta", Admin: "ambar", Equipo: "pizarra" };

export const claseInput =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition focus:border-[#4FAEB2] focus:outline-none focus:ring-4 focus:ring-[#4FAEB2]/15";

export const claseEtiqueta = "mb-1.5 block text-[12px] font-semibold text-slate-600";

export const SOMBRA = "shadow-[0_1px_3px_rgba(15,23,42,0.05),0_8px_24px_-12px_rgba(15,23,42,0.08)]";
export const TARJETA = `rounded-2xl border border-slate-200/80 bg-white ${SOMBRA}`;

export function Pagina({ children, ancho = "max-w-[1400px]" }: { children: ReactNode; ancho?: string }) {
  // En celular el <main> ya da el margen lateral: sin padding propio (no doble margen).
  return <div className={`mx-auto w-full ${ancho} px-0 pb-10 pt-0 sm:px-2 sm:pt-2 md:px-8 md:pb-14 md:pt-6`}>{children}</div>;
}

export function IconoTile({ icono: Icono, tono = "turquesa", tam = "md" }: { icono: LucideIcon; tono?: Tono; tam?: "sm" | "md" | "lg" }) {
  const t = TONOS[tono];
  const caja = tam === "lg" ? "h-12 w-12 rounded-2xl" : tam === "sm" ? "h-8 w-8 rounded-lg" : "h-10 w-10 rounded-xl";
  const ic = tam === "lg" ? "h-6 w-6" : tam === "sm" ? "h-4 w-4" : "h-5 w-5";
  return (
    <span className={`grid shrink-0 place-items-center ${caja} ${t.suave} ${t.texto}`} aria-hidden>
      <Icono className={ic} strokeWidth={2.1} />
    </span>
  );
}

export function Encabezado({
  titulo,
  subtitulo,
  acciones,
  icono,
  tono = "turquesa",
  volver,
}: {
  titulo: string;
  subtitulo?: ReactNode;
  acciones?: ReactNode;
  icono?: LucideIcon;
  tono?: Tono;
  /** link "← …" arriba del título (ej. "← Soporte" al panel /soporte/panel). */
  volver?: { href: string; label: string };
}) {
  return (
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3 sm:mb-6 sm:gap-4">
      {volver ? (
        <div className="-mb-2 basis-full sm:-mb-3">
          <Link href={volver.href} className="-ml-1 inline-flex min-h-9 items-center gap-1 rounded-lg px-1 text-xs font-semibold text-slate-500 no-underline transition-colors hover:text-slate-800">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {volver.label}
          </Link>
        </div>
      ) : null}
      <div className="flex min-w-0 items-center gap-3 sm:gap-3.5">
        {icono ? <IconoTile icono={icono} tono={tono} tam="lg" /> : null}
        <div className="min-w-0">
          <h1 className="text-[20px] font-bold leading-tight tracking-tight text-slate-900 [overflow-wrap:anywhere] sm:text-[24px]" style={{ animation: "fade-in 0.3s ease-out" }}>
            {titulo}
          </h1>
          {subtitulo ? <p className="mt-0.5 text-[13px] text-slate-500 sm:text-sm">{subtitulo}</p> : null}
        </div>
      </div>
      {acciones ? <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:w-full max-sm:[&>*]:min-h-11 max-sm:[&>*]:flex-1">{acciones}</div> : null}
    </header>
  );
}

export function Tarjeta({
  children,
  className = "",
  titulo,
  icono,
  tono = "turquesa",
  accion,
  padding = "p-4 sm:p-5",
}: {
  children: ReactNode;
  className?: string;
  titulo?: ReactNode;
  icono?: LucideIcon;
  tono?: Tono;
  accion?: ReactNode;
  padding?: string;
}) {
  return (
    <section className={`${TARJETA} ${className}`}>
      {titulo ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
          <h2 className="flex items-center gap-2.5 text-sm font-semibold text-slate-800">
            {icono ? <IconoTile icono={icono} tono={tono} tam="sm" /> : null}
            {titulo}
          </h2>
          {accion}
        </div>
      ) : null}
      <div className={padding}>{children}</div>
    </section>
  );
}

/** Tarjeta clickeable (KPIs, accesos): se eleva al pasar el mouse. */
export function TarjetaViva({ children, className = "" }: { children: ReactNode; tono?: Tono; className?: string }) {
  return (
    <div
      className={`relative overflow-hidden ${TARJETA} transition-[box-shadow,transform] duration-200 hover:-translate-y-px hover:shadow-[0_2px_6px_rgba(15,23,42,0.06),0_14px_32px_-14px_rgba(15,23,42,0.18)] ${className}`}
    >
      {children}
    </div>
  );
}

type VarianteBoton = "primario" | "secundario" | "fantasma" | "peligro";

const BOTON: Record<VarianteBoton, string> = {
  primario: "bg-[#4FAEB2] text-white hover:bg-[#439A9E] border border-transparent shadow-[0_6px_16px_-6px_rgba(79,174,178,0.75)] active:translate-y-px",
  secundario: "bg-white text-slate-700 border border-slate-200 hover:border-[#4FAEB2]/50 hover:bg-[#4FAEB2]/5 hover:text-[#2F6E71]",
  fantasma: "bg-transparent text-slate-600 border border-transparent hover:bg-slate-100",
  peligro: "bg-white text-rose-600 border border-rose-200 hover:bg-rose-50",
};

export function claseBoton(v: VarianteBoton = "primario", tam: "sm" | "md" = "md") {
  const t = tam === "sm" ? "px-2.5 py-1.5 text-[12px] [@media(pointer:coarse)]:min-h-10" : "px-4 py-2 text-sm max-sm:min-h-11 [@media(pointer:coarse)]:min-h-11";
  return `inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold no-underline transition disabled:cursor-not-allowed disabled:opacity-50 ${t} ${BOTON[v]}`;
}

export function Boton({
  variante = "primario",
  tam = "md",
  cargando,
  children,
  ...resto
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: VarianteBoton; tam?: "sm" | "md"; cargando?: boolean }) {
  return (
    <button type="button" {...resto} disabled={resto.disabled || cargando} className={`${claseBoton(variante, tam)} ${resto.className ?? ""}`}>
      {cargando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

/** El mismo color, más oscuro: texto legible sobre su fondo suave. */
export function oscurecer(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = 0.66;
  return `rgb(${Math.round(((n >> 16) & 255) * f)}, ${Math.round(((n >> 8) & 255) * f)}, ${Math.round((n & 255) * f)})`;
}

/** Insignia de estado o prioridad con el color del catálogo. */
export function Insignia({ color, children, punto = false }: { color: string; children: ReactNode; punto?: boolean }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset"
      style={{ backgroundColor: `${color}1F`, color: oscurecer(color), ["--tw-ring-color" as string]: `${color}40` }}
    >
      {punto ? <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Fase del ticket: cuántas veces volvió de QA con cambios (la 1 no se muestra). */
export function Fase({ n, bloque = false }: { n?: number | null; bloque?: boolean }) {
  if (!n || n < 2) return null;
  return (
    <span
      className={`${bloque ? "mt-1 flex w-fit" : "inline-flex"} items-center whitespace-nowrap rounded-full bg-violet-50 px-2 py-0.5 text-[10.5px] font-bold text-violet-700 ring-1 ring-inset ring-violet-200`}
      title={`QA pidió cambios ${n - 1} ${n - 1 === 1 ? "vez" : "veces"}`}
    >
      Fase {n}
    </span>
  );
}

/** Estado del SLA como chip (en tiempo / en riesgo / vencido / cumplido / incumplido / sin SLA). */
export function ChipSla({ estado, compacto = false }: { estado: string; compacto?: boolean }) {
  const cfg: Record<string, { t: string; cls: string }> = {
    en_tiempo: { t: "SLA en tiempo", cls: "bg-emerald-50 text-emerald-700" },
    en_riesgo: { t: "SLA en riesgo", cls: "bg-amber-50 text-amber-600" },
    vencido: { t: "SLA vencido", cls: "bg-rose-50 text-rose-600" },
    cumplido: { t: "SLA cumplido", cls: "bg-emerald-50 text-emerald-700" },
    incumplido: { t: "SLA incumplido", cls: "bg-rose-50 text-rose-600" },
    sin_sla: { t: "Sin SLA", cls: "bg-slate-100 text-slate-500" },
  };
  const c = cfg[estado] ?? cfg.sin_sla;
  if (compacto && (estado === "en_tiempo" || estado === "sin_sla" || estado === "cumplido")) return null;
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-bold ${c.cls}`}>{c.t}</span>;
}

const PALETA_AVATAR: Tono[] = ["turquesa", "celeste", "violeta", "ambar", "verde", "rosa", "indigo", "naranja", "azul"];

/** Avatar con color estable por persona. */
export function Avatar({ nombre, tam = 32, tono }: { nombre: string | null | undefined; tam?: number; tono?: Tono }) {
  const limpio = (nombre ?? "").trim();
  const w = limpio.split(/\s+/).filter(Boolean);
  const ini = w.length ? (w[0][0] + (w[1]?.[0] ?? "")).toUpperCase() : "—";
  let h = 0;
  for (const c of limpio) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const t = TONOS[tono ?? PALETA_AVATAR[h % PALETA_AVATAR.length]];
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-bold ring-2 ring-white ${t.suave} ${t.texto}`}
      style={{ width: tam, height: tam, fontSize: Math.max(10, Math.round(tam * 0.36)) }}
      aria-hidden
    >
      {ini}
    </span>
  );
}

export function Esqueleto({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gradient-to-r from-slate-100 via-slate-200/70 to-slate-100 ${className}`} />;
}

export function Cargando({ filas = 5 }: { filas?: number }) {
  return (
    <div className="space-y-3 p-5" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Esqueleto className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Esqueleto className="h-3 w-2/5" />
            <Esqueleto className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Vacio({ titulo, detalle, accion, icono: Icono, tono = "turquesa" }: { titulo: string; detalle?: string; accion?: ReactNode; icono?: LucideIcon; tono?: Tono }) {
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      {Icono ? (
        <span className={`mb-3 grid h-14 w-14 place-items-center rounded-2xl ${TONOS[tono].suave} ${TONOS[tono].texto}`}>
          <Icono className="h-7 w-7" aria-hidden />
        </span>
      ) : null}
      <p className="text-sm font-semibold text-slate-700">{titulo}</p>
      {detalle ? <p className="mt-1 max-w-sm text-[13px] text-slate-500">{detalle}</p> : null}
      {accion ? <div className="mt-4">{accion}</div> : null}
    </div>
  );
}

export function Aviso({ tipo = "error", children }: { tipo?: "error" | "ok" | "info"; children: ReactNode }) {
  const c =
    tipo === "error" ? "border-rose-200 bg-rose-50 text-rose-700" : tipo === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-sky-200 bg-sky-50 text-sky-800";
  return <div className={`rounded-xl border px-3.5 py-2.5 text-sm ${c}`}>{children}</div>;
}

/** Interruptor on/off. */
export function Interruptor({ activo, onCambio, etiqueta, disabled }: { activo: boolean; onCambio: (v: boolean) => void; etiqueta: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={etiqueta}
      disabled={disabled}
      onClick={() => onCambio(!activo)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${activo ? "bg-[#4FAEB2]" : "bg-slate-300"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${activo ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

/** Desplegable simple (el Select del 2.0) con opciones { value, label }. */
export function Desplegable({
  value,
  onChange,
  options,
  disabled,
  minWidth,
  etiqueta,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  minWidth?: number;
  /** título de la hoja inferior en celular */
  etiqueta?: string;
}) {
  return <Select block value={value} onChange={onChange} options={options.map((o) => [o.value, o.label] as [string, string])} disabled={disabled} minWidth={minWidth} etiqueta={etiqueta} />;
}

export function EnlaceMiga({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-slate-500 no-underline hover:text-[#2F6E71]">
      {children}
    </Link>
  );
}

// ------------------------------------------------------------ selector con buscador

export type OpcionSelector = { value: string; label: string; detalle?: string; tono?: Tono };

/** Selector con buscador (clientes, responsables), con iniciales de color y área. */
export function SelectorBuscable({
  opciones,
  value,
  onChange,
  placeholder = "Seleccionar…",
  ariaLabel,
  disabled = false,
  avatares = false,
  buscarPlaceholder = "Buscar…",
  vacio = "Sin resultados",
}: {
  opciones: OpcionSelector[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  avatares?: boolean;
  buscarPlaceholder?: string;
  vacio?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const buscador = useRef<HTMLInputElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [activo, setActivo] = useState(0);
  const elegida = opciones.find((o) => o.value === value) ?? null;
  // Celular: la lista va en una hoja inferior (no la corta ningún contenedor con scroll).
  const esMovil = useEsMovil();
  // búsqueda inteligente (sin tildes, en cualquier orden, errores de tipeo), más parecido primero
  const visibles = useMemo(() => buscar(opciones, q, (o) => ({ principal: o.label, otros: [o.detalle] })).slice(0, 200), [opciones, q]);

  useEffect(() => {
    if (!abierto || esMovil) return;
    const fuera = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setAbierto(false);
    document.addEventListener("mousedown", fuera);
    requestAnimationFrame(() => buscador.current?.focus());
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto, esMovil]);

  const elegir = (v: string) => {
    onChange(v);
    setAbierto(false);
    setQ("");
  };

  return (
    <div ref={ref} className="relative w-full">
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        onClick={() => {
          setAbierto((a) => !a);
          setActivo(0);
        }}
        className="flex h-[42px] w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-left text-sm font-medium text-slate-700 max-sm:h-11 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
        style={abierto ? { borderColor: ACENTO, boxShadow: "0 0 0 4px rgba(79,174,178,0.15)" } : undefined}
      >
        {avatares && elegida?.value ? <Avatar nombre={elegida.label} tam={22} tono={elegida.tono} /> : null}
        <span className={`min-w-0 flex-1 truncate ${elegida ? "" : "text-slate-400"}`}>{elegida?.label ?? placeholder}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${abierto ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {abierto && esMovil ? (
        <HojaInferior titulo={ariaLabel ?? placeholder} onClose={() => setAbierto(false)} sinPadding>
          <div className="relative border-b border-slate-100 p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              ref={buscador}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActivo(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActivo((a) => Math.min(a + 1, visibles.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActivo((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (visibles[activo]) elegir(visibles[activo].value);
                } else if (e.key === "Escape") {
                  setAbierto(false);
                }
              }}
              placeholder={buscarPlaceholder}
              enterKeyHint="search"
              className="w-full rounded-lg bg-slate-50 py-1.5 pl-7 pr-2 text-[13px] outline-none max-sm:h-11"
            />
          </div>
          <ul role="listbox" className={esMovil ? "p-2" : "max-h-72 overflow-y-auto p-1"}>
            {visibles.length === 0 ? <li className="px-3 py-2 text-[12.5px] text-slate-400">{vacio}</li> : null}
            {visibles.map((o, i) => {
              const sel = o.value === value;
              return (
                <li key={o.value || "_vacio"}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={sel}
                    onMouseEnter={() => setActivo(i)}
                    onClick={() => elegir(o.value)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] max-sm:min-h-12 max-sm:px-3 max-sm:text-[15px] ${i === activo ? "bg-slate-50" : ""} ${sel ? "font-semibold text-[#2F6E71]" : "text-slate-700"}`}
                  >
                    {avatares && o.value ? <Avatar nombre={o.label} tam={22} tono={o.tono} /> : null}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.detalle ? (
                      <span className={`shrink-0 rounded-full px-1.5 py-px text-[10.5px] font-bold ${TONOS[o.tono ?? "pizarra"].suave} ${TONOS[o.tono ?? "pizarra"].texto}`}>{o.detalle}</span>
                    ) : null}
                    {sel ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </HojaInferior>
      ) : null}
      {abierto && !esMovil ? (
        <div
          className="absolute left-0 right-0 z-40 mt-1.5 min-w-[240px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_12px_32px_-8px_rgba(2,48,71,0.25)]"
          style={{ animation: "rb-pop 0.15s cubic-bezier(0.16,1,0.3,1)" }}
        >
          <div className="relative border-b border-slate-100 p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              ref={buscador}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActivo(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActivo((a) => Math.min(a + 1, visibles.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActivo((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (visibles[activo]) elegir(visibles[activo].value);
                } else if (e.key === "Escape") {
                  setAbierto(false);
                }
              }}
              placeholder={buscarPlaceholder}
              enterKeyHint="search"
              className="w-full rounded-lg bg-slate-50 py-1.5 pl-7 pr-2 text-[13px] outline-none max-sm:h-11"
            />
          </div>
          <ul role="listbox" className={esMovil ? "p-2" : "max-h-72 overflow-y-auto p-1"}>
            {visibles.length === 0 ? <li className="px-3 py-2 text-[12.5px] text-slate-400">{vacio}</li> : null}
            {visibles.map((o, i) => {
              const sel = o.value === value;
              return (
                <li key={o.value || "_vacio"}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={sel}
                    onMouseEnter={() => setActivo(i)}
                    onClick={() => elegir(o.value)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] max-sm:min-h-12 max-sm:px-3 max-sm:text-[15px] ${i === activo ? "bg-slate-50" : ""} ${sel ? "font-semibold text-[#2F6E71]" : "text-slate-700"}`}
                  >
                    {avatares && o.value ? <Avatar nombre={o.label} tam={22} tono={o.tono} /> : null}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.detalle ? (
                      <span className={`shrink-0 rounded-full px-1.5 py-px text-[10.5px] font-bold ${TONOS[o.tono ?? "pizarra"].suave} ${TONOS[o.tono ?? "pizarra"].texto}`}>{o.detalle}</span>
                    ) : null}
                    {sel ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
