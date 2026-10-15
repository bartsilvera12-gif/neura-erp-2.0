"use client";

/**
 * Piezas comunes de las pantallas de reportes: filtros en la URL (rango con atajos +
 * sucursal), encabezado con "← Reportes", números clave, tarjetas, tablas, descargas y la
 * carga de datos (stale-while-revalidate). Todas las pantallas de /reportes se ven iguales.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { apiFetchSWR } from "@/lib/api/cache-cliente";
import { descargarArchivo } from "@/lib/api/client-blob";
import { hoyPY } from "@/lib/fecha/paraguay";
import { Select } from "@/components/Select";
import { DeltaTexto } from "@/components/graficos/Graficos";
import type { SucursalOpcion } from "@/modules/reportes/tipos";

// ── Rango de fechas ─────────────────────────────────────────────────────────
export type Atajo = "hoy" | "semana" | "mes" | "mes_anterior" | "3m" | "6m" | "12m" | "24m" | "anio" | "todo";
export const ATAJO_LABEL: Record<Atajo, string> = {
  hoy: "Hoy", semana: "Esta semana", mes: "Este mes", mes_anterior: "Mes anterior", "3m": "3 meses", "6m": "6 meses",
  "12m": "12 meses", "24m": "24 meses", anio: "Este año", todo: "Todo",
};
export const ATAJOS_BASE: Atajo[] = ["hoy", "semana", "mes", "mes_anterior", "anio"];

const ymd = (d: Date) => d.toISOString().slice(0, 10);
export function rangoAtajo(k: Atajo): { desde: string; hasta: string } {
  const hoy = hoyPY();
  const [y, m, dd] = hoy.split("-").map(Number);
  const ini = (yy: number, mm: number) => ymd(new Date(Date.UTC(yy, mm - 1, 1)));
  const fin = (yy: number, mm: number) => ymd(new Date(Date.UTC(yy, mm, 0)));
  switch (k) {
    case "hoy": return { desde: hoy, hasta: hoy };
    case "semana": {
      const d = new Date(Date.UTC(y, m - 1, dd));
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // lunes
      return { desde: ymd(d), hasta: hoy };
    }
    case "mes_anterior": return { desde: ini(y, m - 1), hasta: fin(y, m - 1) };
    case "3m": return { desde: ini(y, m - 2), hasta: hoy };
    case "6m": return { desde: ini(y, m - 5), hasta: hoy };
    case "12m": return { desde: ini(y, m - 11), hasta: hoy };
    case "24m": return { desde: ini(y, m - 23), hasta: hoy };
    case "anio": return { desde: `${y}-01-01`, hasta: hoy };
    case "todo": return { desde: "", hasta: "" };
    default: return { desde: ini(y, m), hasta: hoy };
  }
}

export type Filtros = { desde: string; hasta: string; sucursal: string; atajo: Atajo | null };

/** Filtros guardados en la URL (se pueden compartir y los enlaces del Inicio llegan filtrados). */
export function useFiltrosReporte(defecto: Atajo = "mes", extras: string[] = []) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tieneRango = sp.has("desde") || sp.has("hasta");
  const atajoUrl = sp.get("atajo") as Atajo | null;
  const base = rangoAtajo(atajoUrl ?? defecto);
  const f: Filtros = {
    desde: tieneRango ? sp.get("desde") ?? "" : base.desde,
    hasta: tieneRango ? sp.get("hasta") ?? "" : base.hasta,
    sucursal: sp.get("sucursal") ?? "",
    atajo: tieneRango && !atajoUrl ? null : atajoUrl ?? defecto,
  };
  const extra = Object.fromEntries(extras.map((k) => [k, sp.get(k) ?? ""]));

  const cambiar = useCallback((cambios: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(cambios)) {
      if (v == null || v === "") p.delete(k);
      else p.set(k, v);
    }
    router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  }, [sp, router, pathname]);

  const setAtajo = (k: Atajo) => {
    const r = rangoAtajo(k);
    cambiar({ atajo: k, desde: r.desde || null, hasta: r.hasta || null });
  };
  const setRango = (desde: string, hasta: string) => cambiar({ atajo: null, desde: desde || null, hasta: hasta || null });
  const setSucursal = (s: string) => cambiar({ sucursal: s || null });

  /** Query para la API: desde, hasta, sucursal (+ extras). */
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (f.desde) p.set("desde", f.desde);
    if (f.hasta) p.set("hasta", f.hasta);
    if (f.sucursal) p.set("sucursal", f.sucursal);
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
    return p.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.desde, f.hasta, f.sucursal, JSON.stringify(extra)]);

  return { f, extra, query, setAtajo, setRango, setSucursal, cambiar };
}

/** Datos de un reporte (muestra lo último visto al instante y actualiza en segundo plano). */
export function useReporte<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [recarga, setRecarga] = useState(0);
  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    setCargando(true);
    apiFetchSWR<T>(url, (d) => { setData(d); setError(null); }, { signal: ctrl.signal, fresco: recarga > 0 })
      .catch((e) => { if (!ctrl.signal.aborted) setError((e as Error).message); })
      .finally(() => { if (!ctrl.signal.aborted) setCargando(false); });
    return () => ctrl.abort();
  }, [url, recarga]);
  return { data, error, cargando, recargar: () => setRecarga((n) => n + 1) };
}

// ── Encabezado y filtros ────────────────────────────────────────────────────
export function EncabezadoReporte({ kicker, titulo, subtitulo, volver = { href: "/reportes", label: "Reportes" }, children }: {
  kicker: string; titulo: ReactNode; subtitulo?: ReactNode; volver?: { href: string; label: string } | null; children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {volver ? (
          <Link href={volver.href} className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-800">
            <ArrowLeft className="h-3.5 w-3.5" /> {volver.label}
          </Link>
        ) : null}
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: "var(--brand)", boxShadow: "0 0 0 3px var(--brand-100)" }} />
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">{kicker}</p>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{titulo}</h1>
        {subtitulo ? <p className="mt-1 max-w-3xl text-sm text-slate-500">{subtitulo}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

const INPUT_FECHA = "h-[36px] rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";

export function FiltrosReporte({ filtros, atajos = ATAJOS_BASE, sucursales, cargando, children, sinFechas = false, etiquetaFechas }: {
  filtros: ReturnType<typeof useFiltrosReporte>;
  atajos?: Atajo[];
  sucursales?: SucursalOpcion[] | null;
  cargando?: boolean;
  children?: ReactNode;
  sinFechas?: boolean;
  /** ej. "Emitidas" (CxC / CxP filtran por fecha de emisión) */
  etiquetaFechas?: string;
}) {
  const { f, setAtajo, setRango, setSucursal } = filtros;
  return (
    <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      {!sinFechas ? (
        <>
          <div className="flex flex-wrap rounded-xl bg-slate-100 p-1">
            {atajos.map((k) => (
              <button key={k} type="button" onClick={() => setAtajo(k)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${f.atajo === k ? "bg-white text-[var(--brand)] shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                {ATAJO_LABEL[k]}
              </button>
            ))}
          </div>
          {etiquetaFechas ? <span className="text-xs font-medium text-slate-400">{etiquetaFechas}</span> : null}
          <label className="flex items-center gap-1.5 text-xs text-slate-500">Desde
            <input type="date" value={f.desde} max={f.hasta || undefined} onChange={(e) => setRango(e.target.value, f.hasta)} className={INPUT_FECHA} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">Hasta
            <input type="date" value={f.hasta} min={f.desde || undefined} max={hoyPY()} onChange={(e) => setRango(f.desde, e.target.value)} className={INPUT_FECHA} />
          </label>
        </>
      ) : null}
      {sucursales && sucursales.length > 1 ? (
        <Select value={f.sucursal} onChange={setSucursal} minWidth={190}
          options={[["", "Todas las sucursales"], ...sucursales.map((s): [string, string] => [s.id, s.nombre])]} />
      ) : sucursales && sucursales.length === 1 ? (
        <span className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">{sucursales[0].nombre}</span>
      ) : null}
      {children}
      {cargando ? <span className="inline-flex items-center gap-1 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Actualizando…</span> : null}
    </section>
  );
}

// ── Descargas ───────────────────────────────────────────────────────────────
export function Descargas({ excel, pdf, deshabilitado }: { excel?: string; pdf?: string; deshabilitado?: boolean }) {
  const [bajando, setBajando] = useState<"" | "xlsx" | "pdf">("");
  const [error, setError] = useState<string | null>(null);
  const bajar = async (tipo: "xlsx" | "pdf", url: string) => {
    setBajando(tipo);
    setError(null);
    try {
      await descargarArchivo(url, `reporte.${tipo}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBajando("");
    }
  };
  return (
    <>
      {error ? <span className="text-xs text-rose-600">{error}</span> : null}
      {excel ? (
        <button type="button" onClick={() => bajar("xlsx", excel)} disabled={!!bajando || deshabilitado}
          className="inline-flex h-[38px] items-center gap-2 rounded-xl border border-[var(--brand-100)] bg-white px-4 text-sm font-semibold text-[var(--brand)] transition hover:bg-[var(--brand-50)] disabled:opacity-50">
          {bajando === "xlsx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Excel
        </button>
      ) : null}
      {pdf ? (
        <button type="button" onClick={() => bajar("pdf", pdf)} disabled={!!bajando || deshabilitado}
          className="inline-flex h-[38px] items-center gap-2 rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50">
          {bajando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} PDF
        </button>
      ) : null}
    </>
  );
}

// ── Números clave, tarjetas, tablas ─────────────────────────────────────────
export function Kpi({ label, valor, hint, delta, acento, tono, href, onClick }: {
  label: string;
  valor: ReactNode;
  hint?: ReactNode;
  /** variación contra el período anterior */
  delta?: { actual: number; anterior: number; invertir?: boolean; texto?: string } | null;
  acento?: boolean;
  tono?: "bueno" | "malo" | "alerta";
  href?: string;
  onClick?: () => void;
}) {
  const color = tono === "bueno" ? "text-emerald-700" : tono === "malo" ? "text-rose-600" : tono === "alerta" ? "text-amber-600" : acento ? "text-[var(--brand)]" : "text-slate-900";
  const cuerpo = (
    <>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <p className={`mt-1 truncate text-xl font-semibold tabular-nums ${color}`}>{valor}</p>
      {delta ? (
        <p className="mt-0.5 truncate text-xs"><DeltaTexto actual={delta.actual} anterior={delta.anterior} invertir={delta.invertir} />{delta.texto ? <span className="text-slate-400"> {delta.texto}</span> : null}</p>
      ) : null}
      {hint ? <p className="mt-0.5 truncate text-xs text-slate-400">{hint}</p> : null}
    </>
  );
  const clase = `block min-w-0 rounded-2xl border bg-white p-4 text-left shadow-sm transition ${acento ? "border-[var(--brand-100)] bg-[var(--brand-50)]" : "border-slate-200"} ${href || onClick ? "hover:-translate-y-0.5 hover:shadow-md" : ""}`;
  if (href) return <Link href={href} className={clase}>{cuerpo}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={`${clase} w-full`}>{cuerpo}</button>;
  return <div className={clase}>{cuerpo}</div>;
}

export function Tarjeta({ titulo, sub, extra, children, className = "" }: { titulo: ReactNode; sub?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="block h-5 w-1 shrink-0 rounded-full bg-[var(--brand)]" />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">{titulo}</h2>
          </div>
          {sub ? <p className="mt-1 pl-3.5 text-xs text-slate-400">{sub}</p> : null}
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}

export function Tabla({ cols, filas, der = [], pie, onFila, vacio = "Sin datos.", minW }: {
  cols: ReactNode[];
  filas: { key: string; celdas: ReactNode[]; tenue?: boolean; titulo?: string }[];
  der?: number[];
  pie?: ReactNode[];
  onFila?: (key: string) => void;
  vacio?: string;
  minW?: number;
}) {
  if (!filas.length) return <p className="py-8 text-center text-sm text-slate-400">{vacio}</p>;
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full text-left text-sm" style={minW ? { minWidth: minW } : undefined}>
        <thead>
          <tr className="bg-slate-50 text-xs font-semibold text-slate-500">
            {cols.map((c, i) => (
              <th key={i} className={`whitespace-nowrap px-3 py-2.5 ${i === 0 ? "rounded-l-lg" : ""} ${i === cols.length - 1 ? "rounded-r-lg" : ""} ${der.includes(i) ? "text-right" : ""}`}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.key} onClick={onFila ? () => onFila(f.key) : undefined} title={f.titulo}
              className={`border-b border-slate-100 last:border-0 ${onFila ? "cursor-pointer transition-colors hover:bg-slate-50" : ""} ${f.tenue ? "opacity-60" : ""}`}>
              {f.celdas.map((c, i) => (
                <td key={i} className={`whitespace-nowrap px-3 py-2.5 ${der.includes(i) ? "text-right tabular-nums" : ""} ${i === 0 ? "text-slate-800" : "text-slate-600"}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {pie ? (
          <tfoot>
            <tr className="border-t-2 border-slate-200 font-semibold text-slate-900">
              {pie.map((c, i) => <td key={i} className={`whitespace-nowrap px-3 py-2.5 ${der.includes(i) ? "text-right tabular-nums" : ""}`}>{c}</td>)}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

export function EstadoCarga({ error, vacio }: { error?: string | null; vacio?: boolean }) {
  if (error) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">No se pudo cargar el reporte: {error}</div>;
  if (vacio) return null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-[92px] animate-pulse rounded-2xl border border-slate-200 bg-white" />)}</div>
      <div className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-white" />
    </div>
  );
}

export function Nota({ children }: { children: ReactNode }) {
  return <p className="text-[11px] leading-relaxed text-slate-400">{children}</p>;
}

/** Botón-pestaña chico (vista: por proveedor / por documento, etc.). */
export function Segmentos<T extends string>({ valor, opciones, onChange }: { valor: T; opciones: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-xl bg-slate-100 p-1">
      {opciones.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${valor === v ? "bg-white text-[var(--brand)] shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{l}</button>
      ))}
    </div>
  );
}
