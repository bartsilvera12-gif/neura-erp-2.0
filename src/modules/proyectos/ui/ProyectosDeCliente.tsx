"use client";

/**
 * Pestaña "Proyectos" de la ficha del cliente: sus proyectos (consulta liviana, activos y
 * archivados, por último movimiento) y "+ Nuevo proyecto" con el cliente ya elegido.
 * El detalle se abre en el mismo modal del tablero.
 */
import { useCallback, useEffect, useState } from "react";
import { FolderKanban, Loader2, Lock, Plus } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchCache } from "@/lib/api/cache-cliente";
import {
  HORARIO_DEFECTO, PRIORIDAD_LABEL, estiloPrioridad, fechaCorta, monto,
  type Estado, type HorarioLaboral, type Tarjeta,
} from "@/modules/proyectos/tipos";
import { EstadoChip, ModalProyecto, SlaBadge, useAvisos } from "./comun";
import { ProyectoDetalle } from "./ProyectoDetalle";
import { ProyectoForm } from "./ProyectoForm";

const LIMITE = 50;

export function ProyectosDeCliente({ clienteId, clienteNombre, onConteo }: {
  clienteId: string;
  clienteNombre: string;
  onConteo?: (n: number) => void;
}) {
  const [filas, setFilas] = useState<Tarjeta[] | null>(null);
  const [estados, setEstados] = useState<Estado[]>([]);
  const [horario, setHorario] = useState<HorarioLaboral>(HORARIO_DEFECTO);
  const [error, setError] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const { nodo, avisar } = useAvisos();

  const cargar = useCallback(async () => {
    try {
      const sp = new URLSearchParams({ cliente: clienteId, archivados: "todos", limite: String(LIMITE), horario: "1" });
      const r = await apiFetch<{ items: Tarjeta[]; horario?: HorarioLaboral }>(`/api/proyectos?${sp}`);
      setFilas(r.items);
      if (r.horario) setHorario(r.horario);
      onConteo?.(r.items.length);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [clienteId, onConteo]);

  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => {
    apiFetchCache<Estado[]>("/api/proyectos/estados").then(setEstados).catch(() => {});
  }, []);

  const porId = new Map(estados.map((e) => [e.id, e]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {filas ? `${filas.length}${filas.length >= LIMITE ? "+" : ""} proyecto${filas.length === 1 ? "" : "s"}` : "Proyectos del cliente"}
        </p>
        <button type="button" onClick={() => setNuevo(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--brand-600)]">
          <Plus className="h-4 w-4" /> Nuevo proyecto
        </button>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      {filas === null ? (
        error ? null : <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando proyectos…</div>
      ) : filas.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          <FolderKanban className="h-6 w-6 text-slate-300" /> Este cliente todavía no tiene proyectos.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Proyecto</th>
                <th className="px-3 py-2.5">Estado</th>
                <th className="px-3 py-2.5">Prioridad</th>
                <th className="px-3 py-2.5">Técnico</th>
                <th className="px-3 py-2.5">Prometido / Entregado</th>
                <th className="px-3 py-2.5 text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((p) => {
                const e = porId.get(p.estado_id);
                const prio = estiloPrioridad(p.prioridad);
                return (
                  <tr key={p.id} onClick={() => setAbierto(p.id)} className="cursor-pointer border-t border-slate-100 transition-colors hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${prio.punto}`} />
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900">{p.titulo}</p>
                          <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-slate-400">
                            {p.numero}
                            {p.bloqueado ? <span className="inline-flex items-center gap-0.5 font-sans text-rose-600"><Lock className="h-2.5 w-2.5" /> Bloqueado</span> : null}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col items-start gap-1">
                        {e ? <EstadoChip nombre={e.nombre} color={e.color} /> : "—"}
                        <SlaBadge desde={p.estado_desde} estado={e} horario={horario} />
                      </div>
                    </td>
                    <td className="px-3 py-3"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${prio.badge}`}>{PRIORIDAD_LABEL[p.prioridad] ?? p.prioridad}</span></td>
                    <td className="px-3 py-3 text-[12px] text-slate-600">{p.tecnico_nombre ?? <span className="italic text-slate-300">Sin asignar</span>}</td>
                    <td className="px-3 py-3 text-[12px] tabular-nums text-slate-600">
                      {p.fecha_entrega ? <span className="text-emerald-700">Entregado {fechaCorta(p.fecha_entrega)}</span> : p.fecha_prometida ? fechaCorta(p.fecha_prometida) : <span className="font-semibold text-amber-600">A definir</span>}
                    </td>
                    <td className="px-3 py-3 text-right text-[12px] font-semibold tabular-nums text-slate-800">{p.monto_vendido > 0 ? monto(p.monto_vendido, p.moneda) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {nuevo ? (
        <ModalProyecto onClose={() => setNuevo(false)} ancho="max-w-3xl" etiqueta="Nuevo proyecto">
          <div className="flex shrink-0 flex-wrap items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-br from-white via-white to-[var(--brand)]/5 px-6 pb-5 pt-6">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--brand)] shadow-[0_0_0_3px_var(--brand-100)]" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--brand)]">Nuevo</p>
              </div>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Crear proyecto</h2>
              <p className="mt-1 truncate text-sm text-slate-500">Para {clienteNombre}</p>
            </div>
          </div>
          <ProyectoForm
            variant="modal"
            clienteInicial={{ id: clienteId, nombre: clienteNombre }}
            onCancel={() => setNuevo(false)}
            onCreado={(t, avisos) => {
              setNuevo(false);
              setFilas((prev) => [t, ...(prev ?? [])]);
              onConteo?.((filas?.length ?? 0) + 1);
              avisar(avisos.length ? { texto: avisos.join(" "), tipo: "error" } : { texto: `Proyecto ${t.numero} creado.`, link: { href: `/proyectos?p=${t.id}`, texto: "Ver en el tablero →" } });
            }}
          />
        </ModalProyecto>
      ) : null}

      {abierto ? (
        <ModalProyecto onClose={() => { setAbierto(null); void cargar(); }} etiqueta="Detalle del proyecto">
          <ProyectoDetalle
            id={abierto}
            variant="modal"
            preview={filas?.find((f) => f.id === abierto) ?? null}
            onClose={() => { setAbierto(null); void cargar(); }}
            onEliminado={() => { setAbierto(null); void cargar(); }}
          />
        </ModalProyecto>
      ) : null}

      {nodo}
    </div>
  );
}
