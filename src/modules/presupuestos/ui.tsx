"use client";

/** Piezas visuales compartidas de Presupuestos. */
import { ESTADOS, type EstadoPresupuesto } from "@/modules/presupuestos/tipos";

export function BadgeEstado({ estado, className = "" }: { estado: EstadoPresupuesto; className?: string }) {
  const e = ESTADOS[estado];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.clase} ${className}`}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: e.punto }} />
      {e.texto}
    </span>
  );
}

/** "vence hoy" / "quedan 3 días" / "venció hace 2 días" para una fecha de validez. */
export function textoVigencia(validoHasta: string, hoy: string): { texto: string; tono: string } {
  const dias = Math.round((Date.parse(`${validoHasta}T12:00:00`) - Date.parse(`${hoy}T12:00:00`)) / 86_400_000);
  if (dias < 0) return { texto: `venció hace ${-dias} día${dias === -1 ? "" : "s"}`, tono: "text-rose-600" };
  if (dias === 0) return { texto: "vence hoy", tono: "text-amber-600" };
  if (dias <= 3) return { texto: `quedan ${dias} día${dias === 1 ? "" : "s"}`, tono: "text-amber-600" };
  return { texto: `quedan ${dias} días`, tono: "text-slate-400" };
}

export const CLASE_INPUT =
  "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
export const CLASE_ETIQUETA = "mb-1 block text-xs font-medium text-slate-600";
