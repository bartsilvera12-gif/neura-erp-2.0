"use client";

/**
 * "Estado de facturación" de una suscripción (copia del sistema actual): un renglón por
 * mes con su estado (Emitida / Pagada / Vencida / Proyectada), el monto y la acción:
 * "Emitir cuota" en los meses sin emitir (los futuros piden confirmación) o "Ver venta".
 */
import { useState } from "react";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { CalendarClock, Loader2, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { VentaDetalle } from "@/modules/caja/VentaDetalle";
import { TEAL } from "@/modules/clientes/ui";
import type { SuscripcionCliente } from "@/modules/clientes/suscripciones/tipos";
import { AVISO_SIN_RUC } from "@/modules/empresa/tipos";
import { BadgeMes, BadgeSuscripcion, fechaDia, mesActual, monto, nombreMes } from "@/modules/clientes/suscripciones/ui";

export function ModalFacturacion({ clienteNombre, ruc, avisoRuc, suscripcion: s, puedeEmitir, onClose, onCambio }: {
  clienteNombre: string;
  /** RUC para facturar (rucParaFactura). null = sin RUC → la cuota (factura) no se emite (receta 66). */
  ruc?: string | null;
  /** Aviso si no hay RUC válido (avisoRucCliente): distingue "sin RUC" de "RUC con DV mal". */
  avisoRuc?: string | null;
  suscripcion: SuscripcionCliente;
  puedeEmitir: boolean;
  onClose: () => void;
  /** recargar (después de emitir o anular): el padre vuelve a pedir la facturación */
  onCambio: () => Promise<void> | void;
}) {
  const [emitiendo, setEmitiendo] = useState<string | null>(null);
  const [confirmarFuturo, setConfirmarFuturo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [viendo, setViendo] = useState<string | null>(null);
  const actual = mesActual();


  async function emitir(periodo: string) {
    setEmitiendo(periodo);
    setConfirmarFuturo(null);
    setError(null);
    setAviso(null);
    try {
      const r = await apiFetch<{ numero_control: string; total: number }>(`/api/suscripciones/${s.suscripcion_id}/emitir`, {
        method: "POST",
        body: JSON.stringify({ periodo: periodo.slice(0, 7) }),
      });
      setAviso(`Cuota de ${nombreMes(periodo)} emitida: ${r.numero_control} · ${monto(r.total, s.moneda)}`);
      await onCambio();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEmitiendo(null);
    }
  }

  const activa = s.estado === "activa";
  const sinRuc = ruc === null;
  return (
    <>
    {/* Mientras está abierta la venta encima, Esc/click afuera cierran sólo esa. */}
    <CapaModal onClose={viendo ? undefined : onClose} fondo="bg-slate-900/40 backdrop-blur-[2px]">
      <div className={`relative flex ${ALTO_MAX_MODAL} w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl`}
        style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }} onClick={(e) => e.stopPropagation()}>
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-1" style={{ background: `linear-gradient(to right, ${TEAL}, ${TEAL}cc, ${TEAL}66)` }} />

        <div className="shrink-0 border-b border-slate-100 px-4 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Estado de facturación</p>
              </div>
              <h3 className="mt-1 truncate text-lg font-bold tracking-tight text-slate-900">{clienteNombre}</h3>
            </div>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-5 w-5" /></button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex max-w-full flex-wrap items-center gap-x-2 rounded-xl border sm:rounded-full px-3 py-0.5 text-xs font-semibold" style={{ borderColor: `${TEAL}4d`, backgroundColor: `${TEAL}1a`, color: TEAL }}>
              {s.plan} · Suscripción mensual · <span className="tabular-nums">{monto(s.precio, s.moneda)}</span>
            </span>
            <BadgeSuscripcion estado={s.estado} />
            <span className="text-[11px] text-slate-500">Factura el día {s.dia_facturacion} · vence el {s.dia_vencimiento}</span>
          </div>
          {s.pendiente_desde && s.plan_pendiente ? (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
              <CalendarClock className="h-3.5 w-3.5" />
              Desde {nombreMes(s.pendiente_desde)} pasa a {s.plan_pendiente}
              {s.precio_pendiente != null ? ` · ${monto(s.precio_pendiente, s.moneda)}` : ""}
            </p>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/50 px-3 py-3 sm:px-6 sm:py-4">
          {error ? <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">{error}</p> : null}
          {aviso ? <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">{aviso}</p> : null}
          {!activa ? (
            <p className="mb-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-600">
              La suscripción está {s.estado}: no se emiten cuotas{s.estado === "pausada" ? " hasta que la reactives" : ""}.
            </p>
          ) : null}
          {sinRuc && activa && puedeEmitir ? (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
              {avisoRuc || AVISO_SIN_RUC} Las cuotas se emiten como factura: hasta tener un RUC válido no se pueden emitir.
            </p>
          ) : null}
          {s.meses.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-500">Sin meses para mostrar.</p>
          ) : (
            <ul className="space-y-2">
              {s.meses.map((m) => {
                const ym = m.periodo.slice(0, 7);
                const futuro = ym > actual;
                const esActual = ym === actual;
                return (
                  <li key={m.periodo}
                    className={`rounded-xl border bg-white px-3.5 py-3 shadow-sm transition-colors sm:px-4 ${esActual ? "border-[var(--brand)]/40" : "border-slate-200"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold tracking-tight text-slate-800">
                          {m.nombre}
                          {esActual ? <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: TEAL }}>este mes</span> : null}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <BadgeMes estado={m.estado} />
                          {m.numero ? <span className="font-mono text-[11px] text-slate-500">{m.numero}</span> : null}
                          <span className="text-[11px] text-slate-400">vence {fechaDia(m.vencimiento)}</span>
                          {m.venta_id && m.estado !== "pagada" && m.saldo != null && Number(m.saldo) < Number(m.monto) ? (
                            <span className="text-[11px] text-slate-500">· saldo {monto(m.saldo, s.moneda)}</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 max-sm:w-full max-sm:justify-between max-sm:[&>button]:min-h-11">
                        <span className="text-sm font-semibold tabular-nums text-slate-700">{monto(m.monto, s.moneda)}</span>
                        {m.venta_id ? (
                          <button type="button" onClick={() => setViendo(m.venta_id)}
                            className="rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold transition-colors hover:brightness-95"
                            style={{ borderColor: `${TEAL}66`, color: TEAL }}>
                            Ver venta
                          </button>
                        ) : puedeEmitir && activa ? (
                          <button type="button" disabled={!!emitiendo || sinRuc} title={sinRuc ? avisoRuc || AVISO_SIN_RUC : undefined}
                            onClick={() => (futuro ? setConfirmarFuturo(m.periodo) : void emitir(m.periodo))}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${futuro ? "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50" : "text-white hover:brightness-95"}`}
                            style={futuro ? undefined : { backgroundColor: TEAL }}>
                            {emitiendo === m.periodo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                            {emitiendo === m.periodo ? "Emitiendo…" : "Emitir cuota"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {confirmarFuturo === m.periodo ? (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                        <p className="text-xs text-amber-800">
                          {m.nombre} todavía no llegó. ¿Emitir ya la cuota? Queda en la cuenta a cobrar con vencimiento {fechaDia(m.vencimiento)}.
                        </p>
                        <div className="flex gap-2 max-sm:w-full max-sm:[&>button]:min-h-11 max-sm:[&>button]:flex-1">
                          <button type="button" onClick={() => void emitir(m.periodo)} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700">Sí, emitir</button>
                          <button type="button" onClick={() => setConfirmarFuturo(null)} className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-100">No</button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-100 bg-white px-4 py-3 sm:px-6">
          <button type="button" onClick={onClose}
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]">
            Cerrar
          </button>
        </div>
      </div>
    </CapaModal>
    {viendo ? (
      <VentaDetalle ventaId={viendo} onClose={() => setViendo(null)} onAnulada={() => { setViendo(null); void onCambio(); }} />
    ) : null}
    </>
  );
}
