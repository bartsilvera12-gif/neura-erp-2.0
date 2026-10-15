"use client";

/**
 * Gráficos livianos del Resumen de Gastos empresariales (SVG/HTML propio, sin librerías):
 *   · BarrasH        barras horizontales con valor rotulado y, opcional, la marca del presupuesto.
 *   · ColumnasMes    evolución por mes: columnas apiladas (mercadería + operativos) con el
 *                    presupuesto del mes como trazo; tooltip por mes.
 *   · Dona           composición (fijo vs variable) con el total en el centro.
 * Colores validados para daltonismo (paleta categórica fija, nunca ciclada):
 *   operativos #16969b · mercadería #eb6834 · fijo #4a3aa7. El texto va siempre en tinta, nunca
 *   del color de la serie; cada gráfico de 2 series lleva leyenda.
 */
import { useMemo, useState } from "react";
import { corto, gs, mesCorto, nombreMes } from "@/modules/gastos/tipos";

export const C_OPERATIVOS = "#16969b";
export const C_MERCADERIA = "#eb6834";
export const C_FIJO = "#4a3aa7";
export const C_VARIABLE = "#16969b";

export function Leyenda({ items }: { items: { color: string; label: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.dashed ? (
            <span aria-hidden className="inline-block h-0 w-3.5 border-t-2 border-dashed" style={{ borderColor: i.color }} />
          ) : (
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: i.color }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

export type FilaBarra = {
  key: string;
  label: string;
  /** segmentos apilados (ej. mercadería + operativos); con uno solo es una barra simple */
  partes: { valor: number; color: string; label: string }[];
  presupuesto?: number | null;
  detalle?: string;
  onClick?: () => void;
};

/** Barras horizontales rotuladas. Escala común = el mayor entre valores y presupuestos. */
export function BarrasH({ filas, vacio = "Sin datos en el período", max: maxFilas = 8 }: { filas: FilaBarra[]; vacio?: string; max?: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const visibles = useMemo(() => {
    if (filas.length <= maxFilas) return filas;
    const resto = filas.slice(maxFilas - 1);
    const suma = resto.reduce((a, f) => a + f.partes.reduce((b, p) => b + p.valor, 0), 0);
    return [...filas.slice(0, maxFilas - 1), { key: "__otros", label: `Otros (${resto.length})`, partes: [{ valor: suma, color: "#94a3b8", label: "Otros" }] }];
  }, [filas, maxFilas]);
  const tope = Math.max(1, ...visibles.map((f) => Math.max(f.partes.reduce((a, p) => a + p.valor, 0), f.presupuesto ?? 0)));
  if (visibles.length === 0) return <p className="py-8 text-center text-sm text-slate-400">{vacio}</p>;
  return (
    <ul className="space-y-2.5">
      {visibles.map((f) => {
        const total = f.partes.reduce((a, p) => a + p.valor, 0);
        const pres = f.presupuesto ?? null;
        const excedido = pres != null && pres > 0 && total > pres;
        const on = hover === f.key;
        const Tag = f.onClick ? "button" : "div";
        return (
          <li key={f.key}>
            <Tag type={f.onClick ? "button" : undefined} onClick={f.onClick} onMouseEnter={() => setHover(f.key)} onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(f.key)} onBlur={() => setHover(null)}
              className={`group block w-full rounded-lg px-1 py-0.5 text-left ${f.onClick ? "cursor-pointer hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none" : ""}`}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate text-slate-700">{f.label}</span>
                <span className="shrink-0 tabular-nums font-semibold text-slate-800">
                  {corto(total)}
                  {pres != null && pres > 0 ? (
                    <span className={`ml-1.5 text-[11px] font-medium ${excedido ? "text-rose-600" : "text-slate-400"}`}>
                      {excedido ? "▲ " : ""}{Math.round((total / pres) * 100)} % de {corto(pres)}
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="relative mt-1 h-2.5 rounded-full bg-slate-100">
                <div className="absolute inset-y-0 left-0 flex overflow-hidden rounded-full" style={{ width: `${(total / tope) * 100}%`, gap: f.partes.length > 1 ? 2 : 0 }}>
                  {f.partes.filter((p) => p.valor > 0).map((p) => (
                    <div key={p.label} className="h-full transition-opacity" style={{ width: `${(p.valor / Math.max(total, 1)) * 100}%`, backgroundColor: p.color, opacity: hover && !on ? 0.55 : 1 }} />
                  ))}
                </div>
                {pres != null && pres > 0 ? (
                  <div aria-hidden title={`Presupuesto ${gs(pres)}`} className="absolute -top-1 h-[18px] w-0.5 rounded-full bg-slate-700" style={{ left: `calc(${(pres / tope) * 100}% - 1px)` }} />
                ) : null}
              </div>
              {on && (f.detalle || f.partes.length > 1) ? (
                <p className="mt-1 text-[11px] text-slate-500">
                  {f.partes.length > 1 ? f.partes.map((p) => `${p.label}: ${gs(p.valor)}`).join(" · ") : null}
                  {f.detalle ? <>{f.partes.length > 1 ? " · " : ""}{f.detalle}</> : null}
                </p>
              ) : null}
            </Tag>
          </li>
        );
      })}
    </ul>
  );
}

/** Columnas por mes (apiladas) con el presupuesto del mes como trazo punteado. */
export function ColumnasMes({ meses, onMes }: {
  meses: { mes: string; compras: number; operativos: number; presupuesto: number | null }[];
  onMes?: (mes: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 220, PADL = 44, PADB = 26, PADT = 10;
  const n = Math.max(meses.length, 1);
  const tope = Math.max(1, ...meses.map((m) => Math.max(m.compras + m.operativos, m.presupuesto ?? 0)));
  // Escala "redonda" para las líneas guía.
  const paso = (() => {
    const bruto = tope / 4;
    const p10 = 10 ** Math.floor(Math.log10(bruto));
    return [1, 2, 2.5, 5, 10].map((k) => k * p10).find((k) => k >= bruto) ?? bruto;
  })();
  const techo = paso * Math.ceil(tope / paso);
  const y = (v: number) => PADT + (H - PADT - PADB) * (1 - v / techo);
  const banda = (W - PADL) / n;
  const ancho = Math.min(46, banda * 0.56);
  const sinDatos = meses.every((m) => m.compras + m.operativos === 0);
  const h = hover != null ? meses[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Gasto total por mes">
        {Array.from({ length: Math.round(techo / paso) + 1 }, (_, i) => i * paso).map((v) => (
          <g key={v}>
            <line x1={PADL} x2={W} y1={y(v)} y2={y(v)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={PADL - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="#94a3b8">{corto(v)}</text>
          </g>
        ))}
        {meses.map((m, i) => {
          const cx = PADL + banda * i + banda / 2;
          const x = cx - ancho / 2;
          const yo = y(m.operativos);
          const yc = y(m.operativos + m.compras);
          const base = y(0);
          const on = hover === i;
          const dim = hover != null && !on ? 0.45 : 1;
          return (
            <g key={m.mes} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onMes?.(m.mes)}
              style={{ cursor: onMes ? "pointer" : "default" }}>
              {/* área de hover más grande que la columna */}
              <rect x={PADL + banda * i} y={PADT} width={banda} height={H - PADT - PADB} fill={on ? "#f1f5f9" : "transparent"} rx={6} />
              {m.operativos > 0 ? (
                <path d={barra(x, yo, ancho, base - yo, m.compras > 0 ? 0 : 4)} fill={C_OPERATIVOS} opacity={dim} />
              ) : null}
              {m.compras > 0 ? (
                <path d={barra(x, yc, ancho, Math.max(yo - yc - (m.operativos > 0 ? 2 : 0), 0.5), 4)} fill={C_MERCADERIA} opacity={dim} />
              ) : null}
              {m.presupuesto ? (
                <line x1={x - 5} x2={x + ancho + 5} y1={y(m.presupuesto)} y2={y(m.presupuesto)} stroke="#334155" strokeWidth={2} strokeDasharray="4 3" opacity={dim} />
              ) : null}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill={on ? "#0f172a" : "#64748b"} fontWeight={on ? 600 : 400}>{mesCorto(m.mes)}</text>
            </g>
          );
        })}
      </svg>
      {sinDatos ? <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">Sin gastos en estos meses</p> : null}
      {h ? (
        <div className="pointer-events-none absolute top-1 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur"
          style={{ left: `${Math.min(Math.max(((PADL + banda * (hover! + 0.5)) / W) * 100, 14), 78)}%`, transform: "translateX(-50%)" }}>
          <p className="font-semibold capitalize text-slate-800">{nombreMes(h.mes)}</p>
          <p className="mt-1 flex justify-between gap-4 text-slate-600"><span><Punto c={C_MERCADERIA} />Mercadería</span><b className="tabular-nums">{gs(h.compras)}</b></p>
          <p className="flex justify-between gap-4 text-slate-600"><span><Punto c={C_OPERATIVOS} />Operativos</span><b className="tabular-nums">{gs(h.operativos)}</b></p>
          <p className="mt-1 flex justify-between gap-4 border-t border-slate-100 pt-1 text-slate-800"><span>Total</span><b className="tabular-nums">{gs(h.compras + h.operativos)}</b></p>
          {h.presupuesto ? <p className="flex justify-between gap-4 text-slate-500"><span>Presupuesto</span><span className="tabular-nums">{gs(h.presupuesto)}</span></p> : null}
        </div>
      ) : null}
    </div>
  );
}

const Punto = ({ c }: { c: string }) => <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-[2px] align-middle" style={{ backgroundColor: c }} />;

/** Rectángulo con las esquinas de ARRIBA redondeadas (la base queda pegada al eje). */
function barra(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

/** Dona de composición con el total al centro. */
export function Dona({ partes, centro, sub }: { partes: { label: string; valor: number; color: string }[]; centro: string; sub: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = partes.reduce((a, p) => a + p.valor, 0);
  const R = 70, r = 50, C = 90;
  let ang = -Math.PI / 2;
  const arcos = partes.map((p) => {
    const a0 = ang;
    const frac = total > 0 ? p.valor / total : 0;
    const a1 = ang + frac * Math.PI * 2;
    ang = a1;
    return { ...p, a0, a1, frac };
  });
  const sector = (a0: number, a1: number) => {
    const gap = arcos.filter((x) => x.frac > 0).length > 1 ? 0.025 : 0;
    const s = a0 + gap, e = Math.max(a1 - gap, s + 0.001);
    const large = e - s > Math.PI ? 1 : 0;
    const p = (rad: number, a: number) => `${C + rad * Math.cos(a)},${C + rad * Math.sin(a)}`;
    if (e - s >= Math.PI * 2 - 0.01) {
      return `M${C - R},${C} A${R},${R} 0 1 1 ${C + R},${C} A${R},${R} 0 1 1 ${C - R},${C} M${C - r},${C} A${r},${r} 0 1 0 ${C + r},${C} A${r},${r} 0 1 0 ${C - r},${C} Z`;
    }
    return `M${p(R, s)} A${R},${R} 0 ${large} 1 ${p(R, e)} L${p(r, e)} A${r},${r} 0 ${large} 0 ${p(r, s)} Z`;
  };
  const h = hover != null ? arcos[hover] : null;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center lg:flex-col xl:flex-row">
      <svg viewBox="0 0 180 180" className="h-40 w-40 shrink-0" role="img" aria-label={partes.map((p) => `${p.label} ${gs(p.valor)}`).join(", ")}>
        {total === 0 ? <circle cx={C} cy={C} r={(R + r) / 2} fill="none" stroke="#e2e8f0" strokeWidth={R - r} /> : null}
        {arcos.map((a, i) => a.frac > 0 ? (
          <path key={a.label} d={sector(a.a0, a.a1)} fill={a.color} fillRule="evenodd" opacity={hover != null && hover !== i ? 0.4 : 1}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className="transition-opacity" />
        ) : null)}
        <text x={C} y={C - 2} textAnchor="middle" fontSize={15} fontWeight={700} fill="#0f172a">{h ? `${Math.round(h.frac * 100)} %` : centro}</text>
        <text x={C} y={C + 15} textAnchor="middle" fontSize={10} fill="#64748b">{h ? h.label : sub}</text>
      </svg>
      <ul className="w-full space-y-2 text-sm">
        {arcos.map((a, i) => (
          <li key={a.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            className={`flex items-center justify-between gap-3 rounded-lg px-2 py-1 ${hover === i ? "bg-slate-50" : ""}`}>
            <span className="flex items-center gap-2 text-slate-600"><Punto c={a.color} />{a.label}</span>
            <span className="whitespace-nowrap tabular-nums">
              <b className="text-slate-800">{corto(a.valor)}</b>
              <span className="ml-1.5 text-xs text-slate-400">{Math.round(a.frac * 100)} %</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
