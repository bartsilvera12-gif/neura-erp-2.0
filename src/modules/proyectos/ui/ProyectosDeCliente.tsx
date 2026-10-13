"use client";

/**
 * Pestaña "Proyectos" de la ficha del cliente, igual que el sistema actual: "Proyectos del
 * cliente" con Actualizar y la lista de sus proyectos no archivados (título, responsable,
 * fecha y el estado con su color). El detalle se abre en el mismo modal del tablero.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetchCache, apiFetchSWR } from "@/lib/api/cache-cliente";
import type { Estado, Tarjeta } from "@/modules/proyectos/tipos";
import { ModalProyecto } from "./comun";
import { ProyectoDetalle } from "./ProyectoDetalle";

const LIMITE = 50;

/** Fecha date-safe: corta YYYY-MM-DD sin convertir zona. */
function formatFecha(iso: string | null | undefined) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : "";
}

export function ProyectosDeCliente({ clienteId }: { clienteId: string }) {
  const [proyectos, setProyectos] = useState<Tarjeta[]>([]);
  const [cargando, setCargando] = useState(false);
  const [estados, setEstados] = useState<Estado[]>([]);
  const [abierto, setAbierto] = useState<string | null>(null);

  // Cache en memoria: volver a la pestaña (dentro de 30 s) la pinta al instante sin pedir;
  // "Actualizar" y cerrar un proyecto piden fresco (fresco = true por defecto).
  const cargar = useCallback(async (fresco = true) => {
    setCargando(true);
    try {
      const sp = new URLSearchParams({ cliente: clienteId, limite: String(LIMITE) });
      await apiFetchSWR<{ items: Tarjeta[] }>(`/api/proyectos?${sp}`, (r) => setProyectos(r.items ?? []), { fresco, maxEdadMs: 30_000 });
    } catch {
      setProyectos([]);
    }
    setCargando(false);
  }, [clienteId]);

  useEffect(() => { void cargar(false); }, [cargar]);
  useEffect(() => {
    apiFetchCache<Estado[]>("/api/proyectos/estados").then(setEstados).catch(() => {});
  }, []);

  const porId = new Map(estados.map((e) => [e.id, e]));

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Proyectos del cliente</h3>
          <p className="text-[11px] text-slate-500">En curso y finalizados asociados a este cliente.</p>
        </div>
        <button
          type="button"
          onClick={() => void cargar()}
          disabled={cargando}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2] disabled:opacity-50"
        >
          {cargando ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      {cargando && proyectos.length === 0 ? (
        <p className="text-sm text-slate-400">Cargando proyectos…</p>
      ) : proyectos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-10 text-center">
          <p className="text-3xl">📁</p>
          <p className="mt-2 text-sm font-medium text-slate-600">Este cliente no tiene proyectos aún</p>
          <p className="mt-1 text-xs text-slate-500">
            Al crear un proyecto en{" "}
            <Link href="/proyectos" className="font-semibold text-[#4FAEB2] hover:underline">
              Proyectos
            </Link>{" "}
            y elegir este cliente, aparecerá acá.
          </p>
        </div>
      ) : (
        <ol className="space-y-2">
          {proyectos.map((p) => {
            const e = porId.get(p.estado_id);
            const estado = e?.nombre ?? "—";
            const color = e?.color ?? "#94a3b8";
            const resp = p.tecnico_nombre ?? p.comercial_nombre ?? null;
            const fecha = p.fecha_ingreso ?? null;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setAbierto(p.id)}
                  className="block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:bg-slate-50/60"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">{p.titulo || "(sin título)"}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {p.numero ? `${p.numero} · ` : ""}
                        {resp ? `Resp: ${resp}` : "Sin responsable"}
                        {fecha ? ` · ${formatFecha(fecha)}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `${color}1a`, color }}>
                      {estado}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {abierto ? (
        <ModalProyecto onClose={() => { setAbierto(null); void cargar(); }} etiqueta="Detalle del proyecto">
          <ProyectoDetalle
            id={abierto}
            variant="modal"
            preview={proyectos.find((f) => f.id === abierto) ?? null}
            onClose={() => { setAbierto(null); void cargar(); }}
            onEliminado={() => { setAbierto(null); void cargar(); }}
          />
        </ModalProyecto>
      ) : null}
    </div>
  );
}
