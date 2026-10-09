"use client";

/**
 * Pestaña "Actividad": historial de cambios del cliente (lo registra la base sola). Cada
 * evento con su etiqueta de color, quién y cuándo; en las ediciones, campo por campo
 * "antes → después"; en bajas y eliminaciones, el motivo.
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client-fetch";
import type { EventoHistorial } from "@/modules/clientes/ficha/tipos";
import { fechaHora } from "@/modules/clientes/ui";

const ACCION: Record<string, { label: string; color: string }> = {
  creado: { label: "Cliente creado", color: "bg-emerald-100 text-emerald-700" },
  actualizado: { label: "Datos actualizados", color: "bg-sky-100 text-sky-700" },
  desactivado: { label: "Desactivado", color: "bg-slate-200 text-slate-700" },
  reactivado: { label: "Reactivado", color: "bg-emerald-100 text-emerald-700" },
  baja: { label: "Dado de baja", color: "bg-amber-100 text-amber-700" },
  eliminado: { label: "Eliminado", color: "bg-rose-100 text-rose-700" },
};

const valor = (v: string | null | undefined) => (v == null || v === "" ? "—" : v === "true" ? "Sí" : v === "false" ? "No" : v);

export function TabActividad({ clienteId, recarga }: { clienteId: string; recarga: number }) {
  const [historial, setHistorial] = useState<EventoHistorial[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setHistorial(await apiFetch<EventoHistorial[]>(`/api/clientes/${clienteId}/historial`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, [clienteId]);
  useEffect(() => { void cargar(); }, [cargar, recarga]);

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Historial de cambios</h3>
        <button type="button" onClick={() => void cargar()} disabled={cargando}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:opacity-50">
          {cargando ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      {error ? <p className="mb-3 text-sm text-rose-600">{error}</p> : null}
      {cargando && historial.length === 0 ? (
        <p className="text-sm text-slate-400">Cargando historial…</p>
      ) : historial.length === 0 ? (
        <p className="text-sm italic text-slate-400">No hay cambios registrados aún para este cliente.</p>
      ) : (
        <ol className="space-y-3">
          {historial.map((h) => {
            const meta = ACCION[h.accion] ?? { label: h.accion, color: "bg-slate-100 text-slate-600" };
            const cambios = Array.isArray(h.detalle?.cambios) ? h.detalle!.cambios! : [];
            const motivo = typeof h.detalle?.motivo === "string" && h.detalle.motivo ? h.detalle.motivo : null;
            return (
              <li key={h.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.color}`}>{meta.label}</span>
                  <span className="text-xs text-slate-400">{fechaHora(h.created_at)}</span>
                </div>
                {h.usuario_nombre ? <p className="mt-1 text-xs text-slate-500">por {h.usuario_nombre}</p> : null}
                {h.accion === "creado" && h.detalle?.origen && h.detalle.origen !== "MANUAL" ? (
                  <p className="mt-1 text-xs text-slate-500">Origen: {h.detalle.origen === "VENTA" ? "desde una venta" : h.detalle.origen}</p>
                ) : null}
                {cambios.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {cambios.map((c, i) => (
                      <li key={i} className="text-xs text-slate-600">
                        <span className="font-medium text-slate-700">{c.campo}:</span>{" "}
                        <span className="text-rose-600 line-through">{valor(c.antes)}</span>{" "}
                        <span aria-hidden>→</span>{" "}
                        <span className="text-emerald-700">{valor(c.despues)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {motivo ? (
                  <p className="mt-2 text-xs text-slate-500"><span className="font-medium text-slate-600">Motivo:</span> {motivo}</p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
