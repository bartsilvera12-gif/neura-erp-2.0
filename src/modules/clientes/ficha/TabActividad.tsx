"use client";

/**
 * Pestaña "Actividad": historial de cambios del cliente (lo registra la base sola). Cada
 * evento con su etiqueta de color, quién y cuándo; en las ediciones, campo por campo
 * "antes → después"; en bajas y eliminaciones, el motivo. Las suscripciones dejan su rastro
 * (alta, cuota emitida, cambio de plan, pausa, reactivación, cancelación) en una línea legible.
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client-fetch";
import type { EventoHistorial } from "@/modules/clientes/ficha/tipos";
import { fechaHora } from "@/modules/clientes/ui";
import { monto } from "@/modules/clientes/suscripciones/ui";

const ACCION: Record<string, { label: string; color: string }> = {
  creado: { label: "Cliente creado", color: "bg-emerald-100 text-emerald-700" },
  actualizado: { label: "Datos actualizados", color: "bg-sky-100 text-sky-700" },
  desactivado: { label: "Desactivado", color: "bg-slate-200 text-slate-700" },
  reactivado: { label: "Reactivado", color: "bg-emerald-100 text-emerald-700" },
  baja: { label: "Dado de baja", color: "bg-amber-100 text-amber-700" },
  eliminado: { label: "Eliminado", color: "bg-rose-100 text-rose-700" },
  suscripcion: { label: "Suscripción", color: "bg-violet-100 text-violet-700" },
};

const EVENTO_SUSC: Record<string, { label: string; color: string }> = {
  alta: { label: "Nueva suscripción", color: "bg-violet-100 text-violet-700" },
  cuota: { label: "Cuota emitida", color: "bg-sky-100 text-sky-700" },
  cambio_plan: { label: "Cambio de plan", color: "bg-violet-100 text-violet-700" },
  pausada: { label: "Suscripción pausada", color: "bg-amber-100 text-amber-700" },
  activa: { label: "Suscripción reactivada", color: "bg-emerald-100 text-emerald-700" },
  cancelada: { label: "Suscripción cancelada", color: "bg-rose-100 text-rose-700" },
  cambio_vencimiento: { label: "Cambio de vencimiento", color: "bg-sky-100 text-sky-700" },
};

const MODO_PLAN: Record<string, string> = {
  proximo_mes: "desde el mes que viene",
  inmediato: "desde este mes",
  actualizar_cuota_pendiente: "desde este mes, con la cuota rehecha",
};

/** Línea legible de un evento de suscripción. */
function textoSuscripcion(d: NonNullable<EventoHistorial["detalle"]>): string {
  const plata = (v: number | null | undefined) => (v == null ? "" : monto(v, d.moneda ?? "GS"));
  switch (d.evento) {
    case "alta":
      return ["Suscripción: alta", d.plan, plata(d.precio)].filter(Boolean).join(" ");
    case "cuota":
      return [`Cuota emitida ${d.periodo ?? ""}`.trim(), d.numero, plata(d.monto)].filter(Boolean).join(" · ");
    case "cambio_plan":
      return `Cambio de plan: ${d.plan_anterior ?? "—"} → ${d.plan_nuevo ?? "—"}${d.precio != null ? ` · ${plata(d.precio)}` : ""}${d.modo && MODO_PLAN[d.modo] ? ` (${MODO_PLAN[d.modo]})` : ""}`;
    case "pausada":
      return `Suscripción ${d.plan ?? ""} pausada`.replace(/\s+/g, " ");
    case "activa":
      return `Suscripción ${d.plan ?? ""} reactivada`.replace(/\s+/g, " ");
    case "cancelada":
      return `Suscripción ${d.plan ?? ""} cancelada`.replace(/\s+/g, " ");
    case "cambio_vencimiento":
      return `Vencimiento ${d.plan ?? ""}: día ${d.antes ?? "—"} → día ${d.despues ?? "—"}${d.cuota_movida ? " (también la cuota de este mes)" : ""}`.replace(/\s+/g, " ");
    default:
      return `Suscripción ${d.plan ?? ""}`.trim();
  }
}

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
            const esSusc = h.accion === "suscripcion" && !!h.detalle;
            const meta = (esSusc ? EVENTO_SUSC[h.detalle!.evento ?? ""] : null) ?? ACCION[h.accion] ?? { label: h.accion, color: "bg-slate-100 text-slate-600" };
            const cambios = Array.isArray(h.detalle?.cambios) ? h.detalle!.cambios! : [];
            const motivo = typeof h.detalle?.motivo === "string" && h.detalle.motivo ? h.detalle.motivo : null;
            return (
              <li key={h.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.color}`}>{meta.label}</span>
                  <span className="text-xs text-slate-400">{fechaHora(h.created_at)}</span>
                </div>
                {esSusc ? <p className="mt-1.5 text-sm text-slate-700">{textoSuscripcion(h.detalle!)}</p> : null}
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
