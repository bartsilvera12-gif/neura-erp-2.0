"use client";

/**
 * Línea de tiempo de los historiales (ficha de cliente, presupuestos): eventos agrupados por día,
 * cada uno en una tarjeta con su punto de color, etiqueta y hora.
 *
 *   <LineaTiempo eventos={lista} clave={(e) => e.id} fecha={(e) => e.created_at} render={(e) => (
 *     <EventoTarjeta etiqueta="Creado" color="bg-emerald-100 text-emerald-700" fecha={e.created_at}>
 *       <EventoDatos filas={[["Por", e.usuario]]} />
 *     </EventoTarjeta>
 *   )} />
 */
import { Fragment, type ReactNode } from "react";

const ZONA = "America/Asuncion";
/** "22 de octubre de 2026" (día en hora de Paraguay). */
const diaLargo = (iso: string) => new Date(iso).toLocaleDateString("es-PY", { timeZone: ZONA, day: "numeric", month: "long", year: "numeric" });
/** "14:18". */
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-PY", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Eventos agrupados por día, en el orden que vienen (más nuevo primero). */
export function LineaTiempo<T>({ eventos, clave, fecha, render }: {
  eventos: T[];
  clave: (e: T) => string;
  fecha: (e: T) => string;
  render: (e: T) => ReactNode;
}) {
  const dias = new Map<string, T[]>();
  for (const e of eventos) { const d = diaLargo(fecha(e)); dias.set(d, [...(dias.get(d) ?? []), e]); }
  return (
    <div className="space-y-5">
      {[...dias.entries()].map(([dia, lista]) => (
        <section key={dia}>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{dia}</h4>
          <ol className="relative space-y-3 border-l border-slate-200 pl-5">
            {lista.map((e) => <Fragment key={clave(e)}>{render(e)}</Fragment>)}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** La tarjeta de un evento: punto de color, etiqueta y hora; debajo, lo que venga. */
export function EventoTarjeta({ etiqueta, color, fecha, children }: { etiqueta: string; color: string; fecha: string; children?: ReactNode }) {
  return (
    <li className="relative min-w-0 rounded-xl border border-slate-200 bg-white px-3.5 py-3 shadow-sm [overflow-wrap:anywhere] sm:px-4">
      <span aria-hidden className={`absolute -left-[27px] top-4 h-3 w-3 rounded-full ring-4 ring-white ${color}`} />
      <div className="flex items-start justify-between gap-3">
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${color}`}>{etiqueta}</span>
        <span className="shrink-0 text-xs tabular-nums text-slate-400">{hora(fecha)}</span>
      </div>
      {children}
    </li>
  );
}

/** Los datos con su rótulo ("Por: Admin Demo"). Las filas sin valor no se muestran. */
export function EventoDatos({ filas }: { filas: [string, ReactNode][] }) {
  const visibles = filas.filter(([, v]) => v != null && v !== "" && v !== false);
  if (!visibles.length) return null;
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
      {visibles.map(([l, v]) => (
        <Fragment key={l}><dt className="font-medium text-slate-500">{l}:</dt><dd className="text-slate-700">{v}</dd></Fragment>
      ))}
    </dl>
  );
}

/** El motivo de una baja, un rechazo, etc. */
export function EventoMotivo({ children }: { children: ReactNode }) {
  return <p className="mt-2.5 rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-600"><span className="font-semibold text-slate-700">Motivo:</span> {children}</p>;
}
