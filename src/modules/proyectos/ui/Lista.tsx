"use client";

/**
 * Vista Lista de Proyectos (tabla, como el actual): los mismos filtros del tablero, paginada
 * en el servidor con cursor ("Cargar más"). El cliente va como subtítulo del proyecto; el
 * selector de estado se tiñe con el color de su estado. Los cambios hechos desde el
 * detalle o el tablero llegan como parches (no se recarga la tabla).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { Select } from "@/components/Select";
import { apiFetch } from "@/lib/api/client-fetch";
import {
  PRIORIDAD_LABEL, estiloPrioridad, fechaHoraPY, filtrosQuery,
  type Estado, type Filtros, type HorarioLaboral, type Tarjeta,
} from "@/modules/proyectos/tipos";
import { Avatar, SlaBadge } from "./comun";
import { puedeMoverTarjeta } from "./Kanban";

const POR_PAGINA = 30;

function Responsable({ nombre }: { nombre: string | null }) {
  const v = (nombre ?? "").trim();
  if (!v) return <span className="text-[11px] italic text-slate-300">Sin asignar</span>;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar nombre={v} tam={26} />
      <span className="min-w-0 break-words text-[12px] leading-tight text-slate-700" title={v}>{v}</span>
    </div>
  );
}

export function ProyectosLista({
  filtros, estados, opcionesEstado, horario, yo, esAdmin, parches, quitados, version, onAbrir, onMover,
}: {
  filtros: Filtros;
  estados: Map<string, Estado>;
  opcionesEstado: [string, string][];
  horario: HorarioLaboral;
  yo: string | undefined;
  esAdmin: boolean;
  parches: Record<string, Partial<Tarjeta>>;
  quitados: Set<string>;
  version: number;
  onAbrir: (id: string) => void;
  onMover: (t: Tarjeta, estadoId: string) => void;
}) {
  const [filas, setFilas] = useState<Tarjeta[]>([]);
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const pedir = useCallback(async (despues?: Tarjeta) => {
    const mio = despues ? seq.current : ++seq.current;
    setCargando(true);
    setError(null);
    try {
      const sp = filtrosQuery(filtros);
      if (filtros.desde) sp.set("desde", filtros.desde);
      if (filtros.hasta) sp.set("hasta", filtros.hasta);
      sp.set("limite", String(POR_PAGINA));
      if (despues) {
        sp.set("cursor_at", despues.ultimo_movimiento_at);
        sp.set("cursor_id", despues.id);
      }
      const r = await apiFetch<{ items: Tarjeta[] }>(`/api/proyectos?${sp}`);
      if (mio !== seq.current) return;
      setFilas((prev) => {
        if (!despues) return r.items;
        const ya = new Set(prev.map((x) => x.id));
        return [...prev, ...r.items.filter((x) => !ya.has(x.id))];
      });
      setHayMas(r.items.length >= POR_PAGINA);
    } catch (e) {
      if (mio === seq.current) setError((e as Error).message);
    } finally {
      if (mio === seq.current) setCargando(false);
    }
  }, [filtros]);

  useEffect(() => { void pedir(); }, [pedir, version]);

  const visibles = filas.filter((f) => !quitados.has(f.id)).map((f) => (parches[f.id] ? { ...f, ...parches[f.id] } : f));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      <div className={`min-h-0 flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-opacity ${cargando && filas.length ? "opacity-60" : ""}`}>
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <colgroup>
            <col className="w-[30%]" />
            <col className="w-[9%]" />
            <col className="w-[17%]" />
            <col className="w-[15%]" />
            <col className="w-[15%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
            <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              <th className="px-4 py-3 font-semibold">Proyecto</th>
              <th className="px-3 py-3 font-semibold">Prioridad</th>
              <th className="px-3 py-3 font-semibold">Estado</th>
              <th className="px-3 py-3 font-semibold">Comercial</th>
              <th className="px-3 py-3 font-semibold">Técnico</th>
              <th className="px-3 py-3 font-semibold">Actividad / SLA</th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-400">{cargando ? "Cargando…" : "Sin proyectos"}</td>
              </tr>
            ) : (
              visibles.map((p) => {
                const prio = estiloPrioridad(p.prioridad);
                const estado = estados.get(p.estado_id);
                const color = estado?.color ?? "#94a3b8";
                const mover = puedeMoverTarjeta(p, yo, esAdmin);
                return (
                  <tr key={p.id} onClick={() => onAbrir(p.id)} className="group cursor-pointer border-t border-slate-100 align-top transition-colors hover:bg-slate-50/70">
                    <td className="px-4 py-3.5">
                      <div className="flex items-start gap-2">
                        <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${prio.punto}`} />
                        <div className="min-w-0">
                          <div className="break-words text-[13.5px] font-semibold leading-snug text-slate-900 group-hover:text-[var(--brand-600)]" title={p.titulo}>{p.titulo}</div>
                          {p.cliente_id ? (
                            <div className="mt-0.5 break-words text-[11.5px] leading-tight text-slate-500">{p.cliente_nombre || "—"}</div>
                          ) : (
                            <span className="mt-0.5 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Sin cliente asignado</span>
                          )}
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className="font-mono text-[10px] text-slate-400">{p.numero}</span>
                            {p.bloqueado ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700"><Lock className="h-2.5 w-2.5" /> Bloqueado</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${prio.badge}`}>{PRIORIDAD_LABEL[p.prioridad] ?? p.prioridad}</span>
                    </td>
                    <td className="px-3 py-3.5" onClick={(e) => e.stopPropagation()}>
                      {mover ? (
                        <div className="rounded-xl" style={{ boxShadow: `0 0 0 3px ${color}1f` }}>
                          <Select value={p.estado_id} onChange={(v) => onMover(p, v)} options={opcionesEstado} block className="[&>button]:py-1.5 [&>button]:text-xs" />
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ borderColor: `${color}55`, background: `${color}14`, color }}>
                          <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                          {estado?.nombre ?? "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3.5"><Responsable nombre={p.comercial_nombre} /></td>
                    <td className="px-3 py-3.5"><Responsable nombre={p.tecnico_nombre} /></td>
                    <td className="px-3 py-3.5">
                      <div className="text-[11px] tabular-nums text-slate-500">{fechaHoraPY(p.ultimo_movimiento_at)}</div>
                      <div className="mt-1"><SlaBadge desde={p.estado_desde} estado={estado} horario={horario} /></div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {hayMas ? (
        <div className="flex justify-center">
          <button type="button" disabled={cargando} onClick={() => void pedir(filas[filas.length - 1])}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:border-[var(--brand)]/60 hover:text-[var(--brand)] disabled:opacity-60">
            {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Cargar más
          </button>
        </div>
      ) : null}
    </div>
  );
}
