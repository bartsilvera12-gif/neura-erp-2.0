/**
 * Utilidades del calendario de Agenda (portado de dashboard/agenda/calendar-utils.ts).
 *
 * Diferencia con el actual: allá se usaba la hora del NAVEGADOR (`getHours`…). Acá todo va
 * en hora de Paraguay sin depender del navegador: se trabaja con fechas "de pared" — un
 * Date corrido −3 h cuyos campos UTC (`getUTCHours`…) son la hora de Asunción. Paraguay
 * está en UTC−3 fijo desde 2024. `aPared` / `deParedIso` convierten entre los dos mundos.
 */
import type { AgendaCitaEnriquecida } from "@/modules/agenda/dominio";

export type AgendaView = "dia" | "semana" | "mes" | "lista";

const OFFSET_MS = 3 * 3600_000;

/** Instante real (ISO, ms o Date) → fecha de pared de Paraguay. */
export function aPared(v: string | number | Date): Date {
  const ms = typeof v === "string" ? Date.parse(v) : v instanceof Date ? v.getTime() : v;
  return new Date(ms - OFFSET_MS);
}
/** Fecha de pared de Paraguay → ISO real. */
export function deParedIso(d: Date): string {
  return new Date(d.getTime() + OFFSET_MS).toISOString();
}
/** Ahora, como fecha de pared de Paraguay. */
export function ahoraPared(): Date {
  return aPared(Date.now());
}

/**
 * Alto de cada hora en la grilla. Con 64 una media hora mide 32 px (entran dos líneas)
 * y la duración se distingue de un vistazo.
 */
export const HOUR_PX = 64;

/** Alto a partir del cual el bloque puede apilar título y horario en dos líneas. */
export const ALTO_DOS_LINEAS_PX = 40;
export const DAY_START_SCROLL_HOUR = 7; // hora a la que se auto-scrollea la grilla

/* ----------------------------- fechas ----------------------------- */
export function pad(n: number): string {
  return String(n).padStart(2, "0");
}
export function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
export function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}
/** Semana arranca el lunes (uso de negocio en Paraguay). */
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = (x.getUTCDay() + 6) % 7; // 0 = lunes
  return addDays(x, -day);
}
export function sameDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}
export function isToday(d: Date): boolean {
  return sameDay(d, ahoraPared());
}
/** Día de la semana 0 = lunes … 6 = domingo. */
export function diaSemana(d: Date): number {
  return (d.getUTCDay() + 6) % 7;
}

/** Rango [start, end) de fechas (de pared) a pedir al backend según la vista. */
export function rangeForView(view: AgendaView, anchor: Date): { start: Date; end: Date } {
  if (view === "dia") {
    const s = startOfDay(anchor);
    return { start: s, end: addDays(s, 1) };
  }
  if (view === "semana") {
    const s = startOfWeek(anchor);
    return { start: s, end: addDays(s, 7) };
  }
  if (view === "mes") {
    const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    const gridStart = startOfWeek(first);
    return { start: gridStart, end: addDays(gridStart, 42) };
  }
  // lista: ventana amplia desde el inicio de la semana del ancla
  const s = startOfWeek(anchor);
  return { start: s, end: addDays(s, 30) };
}

/** Matriz 6x7 de la vista mes. */
export function monthMatrix(anchor: Date): Date[][] {
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const gridStart = startOfWeek(first);
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: Date[] = [];
    for (let d = 0; d < 7; d++) row.push(addDays(gridStart, w * 7 + d));
    weeks.push(row);
  }
  return weeks;
}

export const WEEKDAYS_ES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
export const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** Fecha de pared con formato es-PY ("lunes, 12 de octubre…"). */
export function fechaLarga(d: Date, opts: Intl.DateTimeFormatOptions): string {
  return d.toLocaleDateString("es-PY", { ...opts, timeZone: "UTC" });
}

export function tituloPeriodo(view: AgendaView, anchor: Date): string {
  if (view === "dia") {
    return fechaLarga(anchor, { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  }
  if (view === "semana") {
    const s = startOfWeek(anchor);
    const e = addDays(s, 6);
    const sameMonth = s.getUTCMonth() === e.getUTCMonth();
    if (sameMonth) return `${s.getUTCDate()} – ${e.getUTCDate()} ${MONTHS_ES[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
    return `${s.getUTCDate()} ${MONTHS_ES[s.getUTCMonth()]} – ${e.getUTCDate()} ${MONTHS_ES[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
  }
  return `${MONTHS_ES[anchor.getUTCMonth()]} ${anchor.getUTCFullYear()}`;
}

/* ----------------------------- horas ----------------------------- */
/** "09:30" de una fecha de pared. */
export function hhmm(d: Date): string {
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
/** "09:30" de un instante real (ISO), en hora de Paraguay. */
export function hhmmIso(iso: string): string {
  return hhmm(aPared(iso));
}

/* ----------------------------- colores ----------------------------- */
/** Estilos por estado con class strings LITERALES (seguros para el purge de Tailwind). */
export const ESTADO_STYLE: Record<string, { block: string; dot: string; chip: string; label: string }> = {
  pendiente: {
    block: "bg-amber-50 border-amber-400 text-amber-900 hover:bg-amber-100",
    dot: "bg-amber-400",
    chip: "border-amber-200 bg-amber-50 text-amber-700",
    label: "Pendiente",
  },
  confirmada: {
    block: "bg-sky-50 border-sky-400 text-sky-900 hover:bg-sky-100",
    dot: "bg-sky-500",
    chip: "border-sky-200 bg-sky-50 text-sky-700",
    label: "Confirmada",
  },
  completada: {
    block: "bg-emerald-50 border-emerald-400 text-emerald-900 hover:bg-emerald-100",
    dot: "bg-emerald-500",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-700",
    label: "Completada",
  },
  no_asistio: {
    block: "bg-orange-50 border-orange-400 text-orange-900 hover:bg-orange-100",
    dot: "bg-orange-500",
    chip: "border-orange-200 bg-orange-50 text-orange-700",
    label: "No asistió",
  },
  cancelada: {
    block: "bg-rose-50 border-rose-400 text-rose-900 line-through hover:bg-rose-100",
    dot: "bg-rose-500",
    chip: "border-rose-200 bg-rose-50 text-rose-700",
    label: "Cancelada",
  },
  reprogramada: {
    block: "bg-violet-50 border-violet-400 text-violet-900 hover:bg-violet-100",
    dot: "bg-violet-500",
    chip: "border-violet-200 bg-violet-50 text-violet-700",
    label: "Reprogramada",
  },
};
export function estadoStyle(estado: string) {
  return (
    ESTADO_STYLE[estado] ?? {
      block: "bg-slate-50 border-slate-400 text-slate-800 hover:bg-slate-100",
      dot: "bg-slate-400",
      chip: "border-slate-200 bg-slate-50 text-slate-600",
      label: estado,
    }
  );
}

/** Etiqueta del tipo de cita ("reunion" → "Reunión"). */
const TIPO_LABEL: Record<string, string> = {
  reunion: "Reunión",
  llamada: "Llamada",
  visita: "Visita",
  seguimiento: "Seguimiento",
  capacitacion: "Capacitación",
  otro: "Otro",
};
export function tipoLabel(tipo: string | null | undefined): string {
  if (!tipo) return "";
  return TIPO_LABEL[tipo] ?? tipo;
}

/* ------------------- layout de solapes (time grid) ------------------- */
export type PositionedEvent = {
  cita: AgendaCitaEnriquecida;
  topPx: number;
  heightPx: number;
  leftPct: number;
  widthPct: number;
};

/**
 * Empaqueta eventos solapados en columnas (algoritmo greedy estándar).
 * `startHour`/`endHour` definen la ventana horaria visible: los topPx se calculan
 * relativos a `startHour` y los eventos se recortan a la ventana. Eventos totalmente
 * fuera de la ventana no se posicionan. `dayStart` es una fecha de pared.
 */
export function layoutDayEvents(
  citas: AgendaCitaEnriquecida[],
  dayStart: Date,
  startHour = 0,
  endHour = 24,
): PositionedEvent[] {
  const winStart = startHour * 60;
  const winEnd = endHour * 60;
  const items = citas
    .map((c) => {
      const ini = aPared(c.inicio_at);
      const fin = aPared(c.fin_at);
      const rawStart = (ini.getTime() - dayStart.getTime()) / 60000;
      const rawEnd = (fin.getTime() - dayStart.getTime()) / 60000;
      const startMin = Math.max(winStart, rawStart);
      const endMin = Math.min(winEnd, Math.max(rawEnd, rawStart + 15));
      return { cita: c, startMin, endMin };
    })
    .filter((x) => x.endMin > x.startMin && x.startMin < winEnd && x.endMin > winStart)
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const out: PositionedEvent[] = [];
  let cluster: typeof items = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    // asignar columnas dentro del cluster
    const cols: number[] = []; // fin de cada columna
    const colOf = new Map<(typeof cluster)[number], number>();
    for (const ev of cluster) {
      let placed = false;
      for (let i = 0; i < cols.length; i++) {
        if (ev.startMin >= cols[i]) {
          cols[i] = ev.endMin;
          colOf.set(ev, i);
          placed = true;
          break;
        }
      }
      if (!placed) {
        cols.push(ev.endMin);
        colOf.set(ev, cols.length - 1);
      }
    }
    const total = cols.length;
    for (const ev of cluster) {
      const col = colOf.get(ev) ?? 0;
      out.push({
        cita: ev.cita,
        topPx: ((ev.startMin - winStart) / 60) * HOUR_PX,
        // Piso de 22 px: alcanza para una línea completa en las citas de 15 minutos.
        heightPx: Math.max(((ev.endMin - ev.startMin) / 60) * HOUR_PX, 22),
        leftPct: (col / total) * 100,
        widthPct: (1 / total) * 100,
      });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const ev of items) {
    if (cluster.length === 0 || ev.startMin < clusterEnd) {
      cluster.push(ev);
      clusterEnd = Math.max(clusterEnd, ev.endMin);
    } else {
      flush();
      cluster.push(ev);
      clusterEnd = ev.endMin;
    }
  }
  flush();
  return out;
}
