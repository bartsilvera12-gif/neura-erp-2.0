"use client";

/**
 * Gráficos del Dashboard de Soporte, livianos (sin librería): barras verticales con
 * etiqueta arriba y una dona con conic-gradient. Mismos colores que el actual.
 */
import { PALETA_TIPOS } from "@/modules/soporte/ui";

export function GraficoBarras({
  datos,
  alto = 240,
  etiquetaCada = 1,
  titulo,
}: {
  datos: { clave: string; etiqueta: string; valor: number; color?: string }[];
  alto?: number;
  /** Mostrar la etiqueta del eje cada N barras (horas del día: cada 2). */
  etiquetaCada?: number;
  titulo?: (d: { etiqueta: string; valor: number }) => string;
}) {
  const max = Math.max(1, ...datos.map((d) => d.valor));
  return (
    <div className="flex h-full flex-col">
      <div className="relative flex flex-1 items-end gap-1.5 border-b border-slate-200 px-1" style={{ minHeight: alto }}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <span key={f} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-slate-100" style={{ bottom: `${f * 88}%` }} aria-hidden />
        ))}
        {datos.map((d) => {
          const color = d.color ?? "#4FAEB2";
          const h = (d.valor / max) * 88;
          return (
            <div key={d.clave} className="group relative flex h-full flex-1 flex-col items-center justify-end" title={titulo ? titulo(d) : `${d.etiqueta}: ${d.valor}`}>
              <span className="mb-1 text-[11px] font-bold tabular-nums text-slate-700">{d.valor > 0 ? d.valor : ""}</span>
              <span
                className="w-full max-w-[46px] rounded-t-lg transition-[height] duration-500 group-hover:opacity-90"
                style={{ height: `${h}%`, minHeight: d.valor > 0 ? 3 : 0, background: `linear-gradient(180deg, ${color}, ${color}8C)` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5 px-1 pt-1.5">
        {datos.map((d, i) => (
          <span key={d.clave} className="flex-1 truncate text-center text-[10.5px] text-slate-500" title={d.etiqueta}>
            {i % etiquetaCada === 0 ? d.etiqueta : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Dona({ datos, total }: { datos: { nombre: string; cantidad: number }[]; total: number }) {
  let acumulado = 0;
  const partes = datos.map((d, i) => {
    const desde = (acumulado / Math.max(1, total)) * 360;
    acumulado += d.cantidad;
    const hasta = (acumulado / Math.max(1, total)) * 360;
    return `${PALETA_TIPOS[i % PALETA_TIPOS.length]} ${desde}deg ${hasta}deg`;
  });
  return (
    <div className="relative h-52 w-52 shrink-0 rounded-full" style={{ background: total ? `conic-gradient(${partes.join(", ")})` : "#f1f5f9" }}>
      <div className="absolute inset-[18%] grid place-items-center rounded-full bg-white">
        <div className="text-center">
          <p className="text-3xl font-bold tabular-nums text-slate-900">{total}</p>
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">tickets</p>
        </div>
      </div>
    </div>
  );
}
