"use client";

/**
 * Pestaña "Historial": historial de cambios del cliente (lo registra la base sola). Cada
 * evento con su etiqueta de color, quién y cuándo; en las ediciones, campo por campo
 * "antes → después"; en bajas y eliminaciones, el motivo. Las suscripciones dejan su rastro
 * (alta, cuota emitida, cambio de plan, pausa, reactivación, cancelación) en una línea legible.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetchSWR } from "@/lib/api/cache-cliente";
import type { EventoHistorial } from "@/modules/clientes/ficha/tipos";
import { monto } from "@/modules/clientes/suscripciones/ui";

const ACCION: Record<string, { label: string; color: string }> = {
  creado: { label: "Cliente creado", color: "bg-emerald-100 text-emerald-700" },
  actualizado: { label: "Datos actualizados", color: "bg-sky-100 text-sky-700" },
  desactivado: { label: "Desactivado", color: "bg-slate-200 text-slate-700" },
  reactivado: { label: "Reactivado", color: "bg-emerald-100 text-emerald-700" },
  baja: { label: "Dado de baja", color: "bg-amber-100 text-amber-700" },
  eliminado: { label: "Eliminado", color: "bg-rose-100 text-rose-700" },
  suscripcion: { label: "Suscripción", color: "bg-violet-100 text-violet-700" },
  tipificacion: { label: "Tipificación", color: "bg-teal-100 text-teal-700" },
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

/** "Tipificación: Error · Ticket #0001" (o "· Capacitación agendada"). */
function textoTipificacion(d: NonNullable<EventoHistorial["detalle"]>): string {
  const partes = [`Tipificación: ${d.tipo_gestion ?? "—"}`];
  if (d.resultado) partes.push(d.resultado);
  if (d.ticket != null && Number(d.ticket) > 0) partes.push(`Ticket #${String(Math.trunc(Number(d.ticket))).padStart(4, "0")}`);
  if (d.capacitacion) partes.push("Capacitación agendada");
  return partes.join(" · ");
}

const ZONA = "America/Asuncion";
/** "22 de octubre de 2026" (día en hora de Paraguay). */
const diaLargo = (iso: string) => new Date(iso).toLocaleDateString("es-PY", { timeZone: ZONA, day: "numeric", month: "long", year: "numeric" });
/** "14:18". */
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-PY", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hour12: false });
/** Eventos agrupados por día, en el orden que vienen (más nuevo primero). */
function porDia(lista: EventoHistorial[]): [string, EventoHistorial[]][] {
  const m = new Map<string, EventoHistorial[]>();
  for (const h of lista) { const d = diaLargo(h.created_at); m.set(d, [...(m.get(d) ?? []), h]); }
  return [...m.entries()];
}

const valor = (v: string | null | undefined) => (v == null || v === "" ? "—" : v === "true" ? "Sí" : v === "false" ? "No" : v);

/** Códigos que guarda la base → lo que entiende la persona. */
const CODIGOS: Record<string, string> = {
  CREDITO: "Crédito", CONTADO: "Contado", GS: "Guaraníes", USD: "Dólares",
  empresa: "Empresa", persona: "Persona física", MANUAL: "Manual", VENTA: "Desde una venta",
};
/** El valor de un cambio, legible: montos con separador de miles y códigos traducidos. */
function valorCampo(campo: string, v: string | null | undefined): string {
  const base = valor(v);
  if (base === "—" || v == null) return base;
  if (/crédito|valor anual/i.test(campo) && /^-?\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    return /crédito/i.test(campo) ? `Gs. ${n.toLocaleString("es-PY", { maximumFractionDigits: 0 })}` : n.toLocaleString("es-PY", { maximumFractionDigits: 2 });
  }
  return CODIGOS[v] ?? base;
}

export function TabHistorial({ clienteId, recarga }: { clienteId: string; recarga: number }) {
  const [historial, setHistorial] = useState<EventoHistorial[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cache en memoria mientras la ficha está abierta: volver a la pestaña la pinta al instante
  // (sin pedir si se vio hace < 30 s); después de un cambio (`recarga`) se pide fresca.
  const cargar = useCallback(async (fresco: boolean) => {
    setCargando(true);
    setError(null);
    try {
      await apiFetchSWR<EventoHistorial[]>(`/api/clientes/${clienteId}/historial`, (h) => { setHistorial(h); setCargando(false); }, { fresco, maxEdadMs: 30_000 });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, [clienteId]);
  const recargaVista = useRef(recarga);
  useEffect(() => {
    const fresco = recargaVista.current !== recarga;
    recargaVista.current = recarga;
    void cargar(fresco);
  }, [cargar, recarga]);

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-700">Historial de cambios</h3>
        <button type="button" onClick={() => void cargar(true)} disabled={cargando}
          className="min-h-11 shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors sm:min-h-0 hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2] disabled:opacity-50">
          {cargando ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {cargando && historial.length === 0 ? (
        <p className="text-sm text-slate-400">Cargando historial…</p>
      ) : historial.length === 0 ? (
        <p className="text-sm text-slate-400 italic">No hay cambios registrados aún para este cliente.</p>
      ) : (
        // Línea de tiempo agrupada por día: a la izquierda el punto de color del evento, a la derecha
        // el título, la hora y los datos en renglones con su rótulo (Por, Origen, Motivo, cambios).
        <div className="space-y-5">
          {porDia(historial).map(([dia, eventos]) => (
            <section key={dia}>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{dia}</h4>
              <ol className="relative space-y-3 border-l border-slate-200 pl-5">
                {eventos.map((h) => {
                  const esSusc = h.accion === "suscripcion" && !!h.detalle;
                  const meta = (esSusc ? EVENTO_SUSC[h.detalle!.evento ?? ""] : null) ?? ACCION[h.accion] ?? { label: h.accion, color: "bg-slate-100 text-slate-600" };
                  const cambios = Array.isArray(h.detalle?.cambios) ? h.detalle!.cambios! : [];
                  const motivo = typeof h.detalle?.motivo === "string" && h.detalle.motivo ? h.detalle.motivo : null;
                  const origen = h.accion === "creado" && h.detalle?.origen && h.detalle.origen !== "MANUAL"
                    ? (h.detalle.origen === "VENTA" ? "Desde una venta" : h.detalle.origen) : null;
                  return (
                    <li key={h.id} className="relative min-w-0 rounded-xl border border-slate-200 bg-white px-3.5 py-3 shadow-sm [overflow-wrap:anywhere] sm:px-4">
                      <span aria-hidden className={`absolute -left-[27px] top-4 h-3 w-3 rounded-full ring-4 ring-white ${meta.color}`} />
                      <div className="flex items-start justify-between gap-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.color}`}>{meta.label}</span>
                        <span className="shrink-0 text-xs tabular-nums text-slate-400">{hora(h.created_at)}</span>
                      </div>
                      {esSusc ? <p className="mt-2 text-sm text-slate-800">{textoSuscripcion(h.detalle!)}</p> : null}
                      {h.accion === "tipificacion" && h.detalle ? (
                        <>
                          <p className="mt-2 text-sm text-slate-800">{textoTipificacion(h.detalle)}</p>
                          {h.detalle.observacion ? <p className="mt-1 whitespace-pre-line text-xs text-slate-500">{h.detalle.observacion}</p> : null}
                        </>
                      ) : null}
                      {h.usuario_nombre || origen ? (
                        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
                          {h.usuario_nombre ? <><dt className="font-medium text-slate-500">Por:</dt><dd className="text-slate-700">{h.usuario_nombre}</dd></> : null}
                          {origen ? <><dt className="font-medium text-slate-500">Origen:</dt><dd className="text-slate-700">{origen}</dd></> : null}
                        </dl>
                      ) : null}
                      {cambios.length > 0 ? (
                        <div className="mt-2.5 overflow-hidden rounded-lg border border-slate-100">
                          <div className="grid grid-cols-3 gap-2 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                            <span>Campo</span><span>Antes</span><span>Después</span>
                          </div>
                          {cambios.map((c, i) => (
                            <div key={i} className="grid grid-cols-3 gap-2 border-t border-slate-100 px-2.5 py-1.5 text-xs">
                              <span className="font-medium text-slate-700">{c.campo}</span>
                              <span className="text-rose-600 line-through">{valorCampo(c.campo, c.antes)}</span>
                              <span className="text-emerald-700">{valorCampo(c.campo, c.despues)}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {motivo ? (
                        <p className="mt-2.5 rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-600"><span className="font-semibold text-slate-700">Motivo:</span> {motivo}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
