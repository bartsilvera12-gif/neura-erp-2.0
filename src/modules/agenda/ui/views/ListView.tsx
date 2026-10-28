"use client";

import { useMemo } from "react";
import type { AgendaCitaEnriquecida } from "@/modules/agenda/dominio";
import { aPared, estadoStyle, fechaLarga, hhmmIso, tipoLabel, ymd } from "../calendar-utils";

export default function ListView({
  citas,
  onSelect,
}: {
  citas: AgendaCitaEnriquecida[];
  onSelect: (c: AgendaCitaEnriquecida) => void;
}) {
  const grupos = useMemo(() => {
    const map = new Map<string, AgendaCitaEnriquecida[]>();
    for (const c of [...citas].sort((a, b) => Date.parse(a.inicio_at) - Date.parse(b.inicio_at))) {
      const k = ymd(aPared(c.inicio_at));
      const arr = map.get(k) ?? [];
      arr.push(c);
      map.set(k, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [citas]);

  if (grupos.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white py-12 text-center text-sm text-slate-400">
        No hay citas en el rango seleccionado.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {grupos.map(([k, items]) => {
        const fecha = new Date(`${k}T00:00:00Z`);
        return (
          <div key={k}>
            <h3 className="mb-2 text-sm font-semibold first-letter:uppercase text-slate-600">
              {fechaLarga(fecha, { weekday: "long", day: "2-digit", month: "long" })}
            </h3>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {items.map((c, i) => {
                const st = estadoStyle(c.estado);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onSelect(c)}
                    className={`flex min-h-14 w-full items-center gap-3 px-3 py-3 text-left hover:bg-slate-50 active:bg-slate-50 sm:px-4 ${i > 0 ? "border-t border-slate-100" : ""}`}
                  >
                    <span className={`h-8 w-1 shrink-0 rounded-full ${st.dot}`} />
                    <div className="w-24 shrink-0 text-sm font-medium tabular-nums text-slate-700 max-sm:flex max-sm:w-11 max-sm:flex-col max-sm:text-[13px] max-sm:leading-tight">
                      <span>{hhmmIso(c.inicio_at)}</span>
                      <span className="max-sm:hidden">–</span>
                      <span className="max-sm:text-xs max-sm:font-normal max-sm:text-slate-400">{hhmmIso(c.fin_at)}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-800">{c.titulo}</div>
                      <div className="truncate text-xs text-slate-500">
                        {c.cliente?.nombre ?? c.contacto_nombre ?? "Sin cliente"}
                        {c.responsable?.nombre ? ` · ${c.responsable.nombre}` : ""}
                        {c.tipo ? ` · ${tipoLabel(c.tipo)}` : ""}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium max-sm:px-2 max-sm:text-[11px] ${st.chip}`}>{st.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
