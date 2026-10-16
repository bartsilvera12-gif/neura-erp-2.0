"use client";

import type { AgendaCitaEnriquecida } from "@/modules/agenda/dominio";
import { useEsMovil } from "@/lib/ui/responsive";
import { WEEKDAYS_ES, aPared, estadoStyle, hhmmIso, isToday, monthMatrix, sameDay } from "../calendar-utils";

const MAX_CHIPS = 3;

export default function MonthView({
  anchor,
  citas,
  onSelect,
  onCreateAt,
  onVerDia,
}: {
  /** Fecha de pared de Paraguay. */
  anchor: Date;
  citas: AgendaCitaEnriquecida[];
  onSelect: (c: AgendaCitaEnriquecida) => void;
  onCreateAt: (d: Date) => void;
  onVerDia: (d: Date) => void;
}) {
  const weeks = monthMatrix(anchor);
  const mesActual = anchor.getUTCMonth();
  // Celular: la celda no tiene lugar para chips → puntos por cita y tocar el día lo abre.
  const esMovil = useEsMovil();

  function citasDe(day: Date): AgendaCitaEnriquecida[] {
    return citas
      .filter((c) => sameDay(aPared(c.inicio_at), day))
      .sort((a, b) => Date.parse(a.inicio_at) - Date.parse(b.inicio_at));
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/60">
        {WEEKDAYS_ES.map((w) => (
          <div key={w} className="px-0.5 py-2 text-center text-[11px] font-medium uppercase tracking-wide text-slate-400 sm:px-2">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {weeks.flat().map((day, idx) => {
          const inMonth = day.getUTCMonth() === mesActual;
          const today = isToday(day);
          const dayCitas = citasDe(day);
          return (
            <div
              key={idx}
              onClick={() => {
                if (esMovil) return onVerDia(day);
                const d = new Date(day);
                d.setUTCHours(9, 0, 0, 0);
                onCreateAt(d);
              }}
              role={esMovil ? "button" : undefined}
              aria-label={esMovil ? `${day.getUTCDate()}: ${dayCitas.length} cita${dayCitas.length === 1 ? "" : "s"}` : undefined}
              className={`min-h-[104px] min-w-0 cursor-pointer border-b border-l border-slate-100 p-1.5 transition-colors hover:bg-slate-50 max-sm:min-h-[3.5rem] max-sm:p-1 max-sm:active:bg-slate-100 ${
                inMonth ? "" : "bg-slate-50/40"
              }`}
            >
              {esMovil ? (
                <div className="flex flex-col items-center gap-1">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold ${
                      today ? "bg-slate-800 text-white" : inMonth ? "text-slate-700" : "text-slate-300"
                    }`}
                  >
                    {day.getUTCDate()}
                  </span>
                  {dayCitas.length ? (
                    <span className="flex items-center gap-0.5" aria-hidden>
                      {dayCitas.slice(0, 3).map((c) => <span key={c.id} className={`h-1.5 w-1.5 rounded-full ${estadoStyle(c.estado).dot}`} />)}
                      {dayCitas.length > 3 ? <span className="text-[9px] font-semibold leading-none text-slate-400">+</span> : null}
                    </span>
                  ) : null}
                </div>
              ) : (
              <>
              <div className="mb-1 flex justify-end">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                    today ? "bg-slate-800 text-white" : inMonth ? "text-slate-700" : "text-slate-300"
                  }`}
                >
                  {day.getUTCDate()}
                </span>
              </div>
              <div className="space-y-0.5">
                {dayCitas.slice(0, MAX_CHIPS).map((c) => {
                  const st = estadoStyle(c.estado);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(c);
                      }}
                      className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] hover:bg-white"
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${st.dot}`} />
                      <span className="shrink-0 tabular-nums text-slate-500">{hhmmIso(c.inicio_at)}</span>
                      <span className="truncate font-medium text-slate-700">{c.titulo}</span>
                    </button>
                  );
                })}
                {dayCitas.length > MAX_CHIPS && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onVerDia(day);
                    }}
                    className="w-full rounded px-1 text-left text-[11px] font-medium text-slate-400 hover:text-slate-600"
                  >
                    +{dayCitas.length - MAX_CHIPS} más
                  </button>
                )}
              </div>
              </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
