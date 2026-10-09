"use client";

/** Piezas visuales de Suscripciones: montos por moneda, meses y etiquetas de estado. */
import { hoyPY } from "@/lib/fecha/paraguay";
import type { EstadoMes, EstadoSuscripcion, Moneda } from "@/modules/clientes/suscripciones/tipos";

export const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** "Gs. 1.234.567" o "US$ 12,50" según la moneda. */
export function monto(v: number | string | null | undefined, moneda: Moneda | string | null | undefined = "GS"): string {
  const n = Number(v) || 0;
  if (moneda === "USD") return `US$ ${n.toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `Gs. ${Math.round(n).toLocaleString("es-PY")}`;
}

/** Mes actual en Paraguay, "YYYY-MM". */
export const mesActual = () => hoyPY().slice(0, 7);

/** "2026-10" / "2026-10-01" → "Octubre 2026". */
export function nombreMes(periodo: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(periodo ?? "");
  if (!m) return "";
  return `${MESES[Number(m[2]) - 1]} ${m[1]}`;
}

/** Suma n meses a "YYYY-MM". */
export function sumarMes(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" → "dd/mm/yyyy" (sin pasar por zona horaria: es una fecha, no un instante). */
export function fechaDia(d: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

const ESTADO_SUSC: Record<EstadoSuscripcion, { t: string; cls: string; dot: string }> = {
  activa: { t: "Activa", cls: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  pausada: { t: "Pausada", cls: "border-amber-200 bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  cancelada: { t: "Cancelada", cls: "border-slate-200 bg-slate-50 text-slate-500", dot: "bg-slate-400" },
};

export function BadgeSuscripcion({ estado }: { estado: EstadoSuscripcion }) {
  const c = ESTADO_SUSC[estado] ?? ESTADO_SUSC.cancelada;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${c.cls}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.t}
    </span>
  );
}

const ESTADO_MES: Record<EstadoMes, { t: string; cls: string; dot: string }> = {
  emitida: { t: "Emitida", cls: "border-sky-200 bg-sky-50 text-sky-700", dot: "bg-sky-500" },
  pagada: { t: "Pagada", cls: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  vencida: { t: "Vencida", cls: "border-rose-200 bg-rose-50 text-rose-700", dot: "bg-rose-500" },
  proyectada: { t: "Proyectada", cls: "border-slate-200 bg-slate-50 text-slate-600", dot: "bg-slate-400" },
};

export function BadgeMes({ estado }: { estado: EstadoMes }) {
  const c = ESTADO_MES[estado] ?? ESTADO_MES.proyectada;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${c.cls}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.t}
    </span>
  );
}

export const IVA_LABEL: Record<string, string> = { "10%": "IVA 10%", "5%": "IVA 5%", exenta: "Exenta" };
