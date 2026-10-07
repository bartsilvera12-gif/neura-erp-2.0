"use client";

/**
 * Gráficos gerenciales del reporte de Cierres de caja:
 *   1. Ventas por día, apiladas por medio de pago (incluye crédito)
 *   2. Mix de medios del período (barra 100% + lista con montos)
 *   3. Diferencias por turno (faltante hacia abajo, sobrante hacia arriba)
 *
 * SVG propio (sin librería). Paleta categórica validada (orden fijo, nunca por rango);
 * los estados de diferencia usan colores de estado + etiqueta, nunca color solo.
 * Los números exactos siguen en la tabla "Detalle de turnos" (vista tabular).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { formatGs } from "@/modules/caja/lib";
import type { CajaReporteFila, CajasReporte } from "@/modules/caja/reporte-cajas";

// Orden fijo de series → color fijo por medio (no cambia al filtrar).
const SERIES = [
  { key: "efectivo", label: "Efectivo", color: "#2a78d6" },
  { key: "tarjeta", label: "Tarjeta", color: "#eb6834" },
  { key: "pos", label: "POS", color: "#1baf7a" },
  { key: "transferencia", label: "Transferencia", color: "#eda100" },
  { key: "credito", label: "Crédito", color: "#e87ba4" },
  { key: "otros", label: "Otros medios", color: "#008300" },
] as const;
type Medio = (typeof SERIES)[number]["key"];

const ESTADO = {
  faltante: { label: "Faltante", color: "#d03b3b", icono: "▼" },
  sobrante: { label: "Sobrante", color: "#c98500", icono: "▲" },
  cuadra: { label: "Cuadra", color: "#0ca30c", icono: "●" },
};

const TZ = "America/Asuncion";
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Monto corto para ejes: 1,2 M · 850 k · 900. */
function corto(v: number) {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toLocaleString("es-PY", { maximumFractionDigits: 1 })} M`;
  if (a >= 1_000) return `${Math.round(v / 1_000).toLocaleString("es-PY")} k`;
  return Math.round(v).toLocaleString("es-PY");
}

/** Tope "lindo" para el eje (1, 2, 2.5, 5 × 10^n). */
function tope(max: number) {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

function useAncho<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function Tarjeta({ titulo, sub, children, className = "" }: { titulo: string; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="block h-5 w-1 rounded-full bg-[var(--brand)]" />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">{titulo}</h2>
        {sub ? <span className="text-xs text-slate-400">{sub}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Leyenda({ items }: { items: { label: string; color: string; icono?: string }[] }) {
  return (
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
      {items.map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
          {s.icono ? (
            <span className="text-[10px] leading-none" style={{ color: s.color }}>{s.icono}</span>
          ) : (
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: s.color }} />
          )}
          {s.label}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ x, y, ancho, children }: { x: number; y: number; ancho: number; children: React.ReactNode }) {
  // Se da vuelta hacia la izquierda si no entra a la derecha.
  const izq = x > ancho - 200;
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-[170px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
      style={{ top: Math.max(0, y), left: izq ? undefined : x + 12, right: izq ? ancho - x + 12 : undefined }}
    >
      {children}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export function GraficosCierres({ data, cajas }: { data: CajasReporte; cajas: CajaReporteFila[] }) {
  const ids = useMemo(() => new Set(cajas.map((c) => c.id)), [cajas]);
  const diario = useMemo(() => data.diario.filter((d) => ids.has(d.caja_id)), [data.diario, ids]);

  // Por día (o por mes si el rango es largo), con todos los días del rango aunque estén vacíos.
  const { puntos, porMes } = useMemo(() => {
    const d0 = new Date(`${data.desde}T12:00:00Z`);
    const d1 = new Date(`${data.hasta}T12:00:00Z`);
    const dias = Math.round((d1.getTime() - d0.getTime()) / 86400000) + 1;
    const porMes = dias > 62;
    const claves: string[] = [];
    for (let d = new Date(d0); d <= d1; d.setUTCDate(d.getUTCDate() + 1)) {
      const k = porMes ? d.toISOString().slice(0, 7) : d.toISOString().slice(0, 10);
      if (claves[claves.length - 1] !== k) claves.push(k);
    }
    const mapa = new Map(claves.map((k) => [k, Object.fromEntries(SERIES.map((s) => [s.key, 0])) as Record<Medio, number>]));
    for (const r of diario) {
      const k = porMes ? r.fecha.slice(0, 7) : r.fecha;
      const e = mapa.get(k);
      if (e) e[r.medio as Medio] = (e[r.medio as Medio] ?? 0) + r.monto;
    }
    return { puntos: claves.map((k) => ({ k, v: mapa.get(k)! })), porMes };
  }, [data.desde, data.hasta, diario]);

  const totales = useMemo(() => {
    const t = Object.fromEntries(SERIES.map((s) => [s.key, 0])) as Record<Medio, number>;
    for (const r of diario) t[r.medio as Medio] = (t[r.medio as Medio] ?? 0) + r.monto;
    return t;
  }, [diario]);

  // Series visibles: siempre las 4 principales + crédito; "otros" solo si hubo.
  const series = SERIES.filter((s) => s.key !== "otros" || totales.otros > 0);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Tarjeta titulo={porMes ? "Ventas por mes" : "Ventas por día"} sub="por medio de pago" className="lg:col-span-2">
        <Leyenda items={series} />
        <VentasApiladas puntos={puntos} series={series} porMes={porMes} />
      </Tarjeta>
      <Tarjeta titulo="Mix de medios" sub="del período">
        <Mix totales={totales} series={series} />
      </Tarjeta>
      <Tarjeta titulo="Diferencias por turno" sub="contado − esperado" className="lg:col-span-3">
        <Leyenda items={Object.values(ESTADO)} />
        <Diferencias cajas={cajas} />
      </Tarjeta>
    </div>
  );
}

// ── 1. Ventas por día (barras apiladas) ───────────────────────────────────────
function VentasApiladas({
  puntos,
  series,
  porMes,
}: {
  puntos: { k: string; v: Record<Medio, number> }[];
  series: readonly (typeof SERIES)[number][];
  porMes: boolean;
}) {
  const [ref, ancho] = useAncho<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 220;
  const pad = { t: 8, r: 8, b: 24, l: 48 };
  const iw = Math.max(0, ancho - pad.l - pad.r);
  const ih = H - pad.t - pad.b;
  const total = (v: Record<Medio, number>) => series.reduce((a, s) => a + v[s.key], 0);
  const max = tope(Math.max(0, ...puntos.map((p) => total(p.v))));
  const banda = puntos.length ? iw / puntos.length : 0;
  const bw = Math.max(2, Math.min(28, banda * 0.62));
  const yv = (v: number) => pad.t + ih - (v / max) * ih;
  const paso = Math.max(1, Math.ceil(puntos.length / Math.max(1, Math.floor(iw / 56))));
  const etiqueta = (k: string) => (porMes ? `${MESES[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}` : ddmm(k));
  const vacio = puntos.every((p) => total(p.v) === 0);

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      {ancho > 0 ? (
        <svg width={ancho} height={H} role="img" aria-label="Ventas por día apiladas por medio de pago">
          {/* Grilla recesiva + eje Y */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={pad.l} x2={pad.l + iw} y1={yv(max * f)} y2={yv(max * f)} stroke={f === 0 ? "#cbd5e1" : "#eef2f6"} strokeWidth={1} />
              <text x={pad.l - 8} y={yv(max * f)} dy="0.32em" textAnchor="end" className="fill-slate-400 text-[10px] tabular-nums">{corto(max * f)}</text>
            </g>
          ))}
          {puntos.map((p, i) => {
            const cx = pad.l + banda * i + banda / 2;
            const x = cx - bw / 2;
            let acum = 0;
            const t = total(p.v);
            const r = Math.min(4, bw / 2);
            const top = yv(t);
            const clip = `clip-v-${i}`;
            return (
              <g key={p.k} opacity={hover == null || hover === i ? 1 : 0.45}>
                {t > 0 ? (
                  <>
                    {/* Extremo superior redondeado (4px), base recta sobre el eje */}
                    <clipPath id={clip}>
                      <path d={`M${x},${yv(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${yv(0)} Z`} />
                    </clipPath>
                    <g clipPath={`url(#${clip})`}>
                      {series.map((s) => {
                        const v = p.v[s.key];
                        if (!v) return null;
                        const y1 = yv(acum + v);
                        const h = yv(acum) - y1;
                        acum += v;
                        // 2px de separación (color del fondo) entre segmentos.
                        return <rect key={s.key} x={x} y={y1} width={bw} height={Math.max(0, h)} fill={s.color} stroke="#ffffff" strokeWidth={acum === v ? 0 : 1} />;
                      })}
                    </g>
                  </>
                ) : null}
                {i % paso === 0 ? (
                  <text x={cx} y={H - 6} textAnchor="middle" className="fill-slate-400 text-[10px] tabular-nums">{etiqueta(p.k)}</text>
                ) : null}
                {/* Zona de hover más grande que la barra */}
                <rect x={pad.l + banda * i} y={pad.t} width={banda} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
              </g>
            );
          })}
          {vacio ? (
            <text x={pad.l + iw / 2} y={pad.t + ih / 2} textAnchor="middle" className="fill-slate-400 text-xs">Sin ventas en el período</text>
          ) : null}
        </svg>
      ) : (
        <div style={{ height: H }} />
      )}
      {hover != null && puntos[hover] && total(puntos[hover].v) > 0 ? (
        <Tooltip x={pad.l + banda * hover + banda / 2} y={yv(total(puntos[hover].v)) - 10} ancho={ancho}>
          <p className="mb-1 font-semibold text-slate-800">{porMes ? etiqueta(puntos[hover].k) : new Date(`${puntos[hover].k}T12:00:00Z`).toLocaleDateString("es-PY", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" })}</p>
          {series.filter((s) => puntos[hover].v[s.key] > 0).map((s) => (
            <p key={s.key} className="flex items-center justify-between gap-4 text-slate-600">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: s.color }} />{s.label}</span>
              <span className="tabular-nums text-slate-800">{formatGs(puntos[hover].v[s.key])}</span>
            </p>
          ))}
          <p className="mt-1 flex justify-between gap-4 border-t border-slate-100 pt-1 font-semibold text-slate-800">
            <span>Total</span><span className="tabular-nums">{formatGs(total(puntos[hover].v))}</span>
          </p>
        </Tooltip>
      ) : null}
    </div>
  );
}

// ── 2. Mix de medios (barra 100% + lista) ─────────────────────────────────────
function Mix({ totales, series }: { totales: Record<Medio, number>; series: readonly (typeof SERIES)[number][] }) {
  const total = series.reduce((a, s) => a + totales[s.key], 0);
  if (total <= 0) return <p className="py-10 text-center text-sm text-slate-400">Sin ventas en el período</p>;
  const con = series.filter((s) => totales[s.key] > 0);
  return (
    <div>
      <div className="mb-4 flex h-3.5 w-full gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label="Participación de cada medio de pago">
        {con.map((s) => (
          <div key={s.key} title={`${s.label}: ${Math.round((totales[s.key] / total) * 100)}%`} style={{ width: `${(totales[s.key] / total) * 100}%`, backgroundColor: s.color }} />
        ))}
      </div>
      <ul className="divide-y divide-slate-100">
        {series.map((s) => {
          const v = totales[s.key];
          const pct = (v / total) * 100;
          return (
            <li key={s.key} className={`flex items-center gap-2 py-2 text-sm ${v ? "" : "opacity-50"}`}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: s.color }} />
              <span className="flex-1 text-slate-700">{s.label}</span>
              <span className="w-10 text-right text-xs tabular-nums text-slate-400">{pct >= 1 || v === 0 ? Math.round(pct) : "<1"}%</span>
              <span className="w-28 text-right font-medium tabular-nums text-slate-800">{formatGs(v)}</span>
            </li>
          );
        })}
        <li className="flex items-center justify-between pt-2.5 text-sm font-semibold text-slate-900">
          <span>Total vendido</span>
          <span className="tabular-nums">{formatGs(total)}</span>
        </li>
      </ul>
    </div>
  );
}

// ── 3. Diferencias por turno (barras alrededor de cero) ───────────────────────
function Diferencias({ cajas }: { cajas: CajaReporteFila[] }) {
  const [ref, ancho] = useAncho<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const turnos = useMemo(
    () => cajas.filter((c) => c.estado === "cerrada" && c.diferencia != null).sort((a, b) => (a.fecha_apertura < b.fecha_apertura ? -1 : 1)),
    [cajas],
  );
  const H = 180;
  const pad = { t: 10, r: 8, b: 24, l: 48 };
  const iw = Math.max(0, ancho - pad.l - pad.r);
  const ih = H - pad.t - pad.b;
  const max = tope(Math.max(1, ...turnos.map((t) => Math.abs(t.diferencia ?? 0))));
  const yv = (v: number) => pad.t + ih / 2 - (v / max) * (ih / 2);
  const banda = turnos.length ? iw / turnos.length : 0;
  const bw = Math.max(3, Math.min(24, banda * 0.6));
  const paso = Math.max(1, Math.ceil(turnos.length / Math.max(1, Math.floor(iw / 64))));
  const estado = (d: number) => (d === 0 ? ESTADO.cuadra : d < 0 ? ESTADO.faltante : ESTADO.sobrante);
  const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-PY", { timeZone: TZ, day: "2-digit", month: "2-digit" });

  if (!turnos.length) return <p className="py-8 text-center text-sm text-slate-400">No hay turnos cerrados en el período.</p>;

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      {ancho > 0 ? (
        <svg width={ancho} height={H} role="img" aria-label="Diferencia de cada turno: faltante hacia abajo, sobrante hacia arriba">
          {[-1, -0.5, 0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={pad.l} x2={pad.l + iw} y1={yv(max * f)} y2={yv(max * f)} stroke={f === 0 ? "#94a3b8" : "#eef2f6"} strokeWidth={1} />
              <text x={pad.l - 8} y={yv(max * f)} dy="0.32em" textAnchor="end" className="fill-slate-400 text-[10px] tabular-nums">{f === 0 ? "0" : `${f > 0 ? "+" : "−"}${corto(Math.abs(max * f))}`}</text>
            </g>
          ))}
          {turnos.map((t, i) => {
            const d = t.diferencia ?? 0;
            const cx = pad.l + banda * i + banda / 2;
            const x = cx - bw / 2;
            const e = estado(d);
            const y0 = yv(0);
            const y1 = yv(d);
            const r = Math.min(4, bw / 2);
            // Extremo de datos redondeado, base recta anclada en cero.
            const path =
              d > 0
                ? `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + bw - r} Q${x + bw},${y1} ${x + bw},${y1 + r} V${y0} Z`
                : `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + bw - r} Q${x + bw},${y1} ${x + bw},${y1 - r} V${y0} Z`;
            return (
              <g key={t.id} opacity={hover == null || hover === i ? 1 : 0.45}>
                {d === 0 ? (
                  <circle cx={cx} cy={y0} r={4} fill={e.color} stroke="#ffffff" strokeWidth={2} />
                ) : Math.abs(y1 - y0) < r * 2 ? (
                  <rect x={x} y={Math.min(y0, y1)} width={bw} height={Math.max(2, Math.abs(y1 - y0))} rx={1} fill={e.color} />
                ) : (
                  <path d={path} fill={e.color} />
                )}
                {i % paso === 0 ? (
                  <text x={cx} y={H - 6} textAnchor="middle" className="fill-slate-400 text-[10px] tabular-nums">C{t.numero_caja} · {fecha(t.fecha_apertura)}</text>
                ) : null}
                <rect x={pad.l + banda * i} y={pad.t} width={banda} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
              </g>
            );
          })}
        </svg>
      ) : (
        <div style={{ height: H }} />
      )}
      {hover != null && turnos[hover] ? (() => {
        const t = turnos[hover];
        const d = t.diferencia ?? 0;
        const e = estado(d);
        return (
          <Tooltip x={pad.l + banda * hover + banda / 2} y={Math.min(yv(d), yv(0)) - 10} ancho={ancho}>
            <p className="font-semibold text-slate-800">Caja {t.numero_caja} · {new Date(t.fecha_apertura).toLocaleString("es-PY", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
            {t.abierta_por_nombre ? <p className="text-slate-500">{t.abierta_por_nombre}</p> : null}
            <p className="mt-1 flex justify-between gap-4 text-slate-600"><span>Esperado</span><span className="tabular-nums text-slate-800">{formatGs(t.efectivo_esperado)}</span></p>
            <p className="flex justify-between gap-4 text-slate-600"><span>Contado</span><span className="tabular-nums text-slate-800">{t.monto_cierre_contado == null ? "—" : formatGs(t.monto_cierre_contado)}</span></p>
            <p className="mt-1 flex justify-between gap-4 border-t border-slate-100 pt-1 font-semibold text-slate-800">
              <span className="inline-flex items-center gap-1"><span style={{ color: e.color }}>{e.icono}</span>{e.label}</span>
              <span className="tabular-nums">{d > 0 ? "+" : ""}{formatGs(d)}</span>
            </p>
          </Tooltip>
        );
      })() : null}
    </div>
  );
}
