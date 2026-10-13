"use client";

/**
 * Panel lateral "Detalle de cobranza" (portado del sistema actual, mejorado):
 *   · nombre (link a la ficha), categoría, tramo, teléfono con Copiar
 *   · deuda total, cuotas vencidas, monto mensual, alta, meses adeudados, mensaje del mes
 *   · servicios con TODAS sus cuotas abiertas (vencidas y por vencer). "Registrar pago"
 *     (transferencia → aprobación) solo en la cuota más vieja del cliente; las demás dicen
 *     "Pagá primero …". "Cobro en caja" abre el cobro de siempre (efectivo, entra a la caja).
 *   · transferencias esperando aprobación, último pago, promesas (agregar / cancelar)
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, Phone, Wallet, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { hoyPY } from "@/lib/fecha/paraguay";
import { Drawer } from "@/components/Drawer";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { RegistrarTransferencia, type CuotaFija } from "@/modules/cobranzas/RegistrarTransferencia";
import { RegistrarCobro } from "@/modules/clientes/RegistrarCobro";
import {
  fechaCorta, gs, mesCorto, planDe, TRAMO_CLASS, TRAMO_LABEL,
  type CuotaDetalle, type DetalleCobranza, type PromesaPago, type TramoKey,
} from "@/modules/cobranzas/tipos";

export function TramoBadge({ tramo }: { tramo: TramoKey }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${TRAMO_CLASS[tramo]}`}>
      {TRAMO_LABEL[tramo]}
    </span>
  );
}

const ESTADO_PROMESA: Record<PromesaPago["estado"], string> = {
  pendiente: "border-[#4FAEB2]/40 bg-[#4FAEB2]/10 text-[#3F8E91]",
  cumplida: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelada: "border-slate-200 bg-slate-50 text-slate-500",
};

export function DetalleCobranzaPanel({ clienteId, onClose, onCambio, avisar }: {
  clienteId: string;
  onClose: () => void;
  /** Algo cambió (promesa, cobro): la lista se recarga. */
  onCambio: () => void;
  avisar: (msg: string) => void;
}) {
  const [d, setD] = useState<DetalleCobranza | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [pagando, setPagando] = useState<CuotaFija | null>(null);
  const [promesaOpen, setPromesaOpen] = useState(false);
  const [enCaja, setEnCaja] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setD(await apiFetch<DetalleCobranza>(`/api/cobranzas/clientes/${clienteId}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, [clienteId]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function copiar(tel: string) {
    try {
      await navigator.clipboard.writeText(tel);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = tel;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* sin portapapeles */ }
      ta.remove();
    }
    setCopiado(true);
    avisar("Teléfono copiado");
    window.setTimeout(() => setCopiado(false), 1500);
  }

  async function cancelarPromesa(p: PromesaPago) {
    try {
      await apiFetch(`/api/cobranzas/promesas/${p.id}/cancelar`, { method: "POST", body: JSON.stringify({}) });
      avisar("Promesa cancelada.");
      await cargar();
      onCambio();
    } catch (e) {
      avisar((e as Error).message);
    }
  }

  // El cobro en caja es el panel de siempre (RegistrarCobro): se muestra en lugar de este.
  if (enCaja && d) {
    return (
      <RegistrarCobro clienteId={d.cliente.cliente_id} clienteNombre={d.cliente.cliente_label} cxcInicial={d.mas_vieja?.id ?? null}
        onClose={() => { setEnCaja(false); void cargar(); }}
        onHecho={() => { onCambio(); }} />
    );
  }

  const masVieja = d?.mas_vieja ?? null;
  const fijaDe = (c: CuotaDetalle): CuotaFija => ({
    cxc_id: c.id, numero: c.numero, vencimiento: c.vencimiento, saldo: Number(c.saldo), en_aprobacion: Number(c.en_aprobacion),
    cliente_label: d?.cliente.cliente_label ?? "",
  });

  return (
    <>
      <Drawer titulo="Detalle de cobranza" onClose={onClose}>
        {cargando && !d ? (
          <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
        ) : error || !d ? (
          <p className="text-sm text-rose-600">{error ?? "No se pudo cargar el detalle."}</p>
        ) : (
          <div className="space-y-5">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white px-4 py-3.5">
                <div className="min-w-0">
                  <Link href={`/clientes/${d.cliente.cliente_id}`} title="Abrir la ficha del cliente"
                    className="group inline-flex max-w-full items-center gap-1.5 text-base font-semibold text-slate-900 hover:text-[#3F8E91]">
                    <span className="truncate">{d.cliente.cliente_label}</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400 transition-colors group-hover:text-[#3F8E91]" />
                  </Link>
                  <div className="mt-0.5 truncate text-xs text-slate-500">
                    {[d.cliente.categoria, d.servicios.map(planDe).join(" · ")].filter(Boolean).join(" · ") || "Sin servicios con deuda"}
                  </div>
                </div>
                <TramoBadge tramo={d.tramo} />
              </div>

              {d.cliente.telefono ? (
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-2 text-sm text-slate-700">
                    <Phone className="h-4 w-4 shrink-0 text-[#3F8E91]" />
                    <a href={`tel:${d.cliente.telefono}`} className="truncate font-medium tabular-nums hover:underline">{d.cliente.telefono}</a>
                  </div>
                  <button type="button" onClick={() => void copiar(d.cliente.telefono!)} aria-label="Copiar teléfono"
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${copiado ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-600 hover:border-[#3F8E91]/40 hover:text-[#3F8E91]"}`}>
                    {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiado ? "Copiado" : "Copiar"}
                  </button>
                </div>
              ) : null}

              <div className="flex items-end justify-between gap-3 px-4 py-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Deuda total</div>
                  <div className="text-2xl font-bold tabular-nums text-rose-700">{gs(d.total_deuda)}</div>
                </div>
                <div className="pb-1 text-right text-xs text-slate-500">{d.cuotas_vencidas} cuota(s) vencida(s)</div>
              </div>

              <div className="grid grid-cols-2 gap-px border-t border-slate-100 bg-slate-100 text-xs">
                <div className="bg-white px-4 py-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">Monto mensual</div>
                  <div className="mt-0.5 font-semibold tabular-nums text-slate-800">{gs(d.monto_mensual)}</div>
                </div>
                <div className="bg-white px-4 py-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">Alta</div>
                  <div className="mt-0.5 font-semibold text-slate-800">{fechaCorta(d.cliente.alta)}</div>
                </div>
              </div>

              {d.meses_adeudados.length ? (
                <div className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-600">
                  <span className="text-slate-400">Meses adeudados: </span>
                  {d.meses_adeudados.map(mesCorto).join(", ")}
                </div>
              ) : null}

              <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-600">
                <span className="text-slate-400">Mensaje este mes:</span>
                {d.cliente.mensaje_mes_fecha ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Enviado · {fechaCorta(d.cliente.mensaje_mes_fecha)}
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Sin mensaje este mes</span>
                )}
              </div>
            </div>

            {d.en_aprobacion.length ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-xs text-amber-800">
                <p className="font-semibold">Esperando aprobación en Conciliación ({d.en_aprobacion.length})</p>
                <ul className="mt-1 space-y-0.5">
                  {d.en_aprobacion.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2">
                      <span className="truncate">{p.numero} · {p.banco_origen} · Op {p.numero_operacion} · {fechaCorta(p.fecha)}</span>
                      <span className="shrink-0 font-semibold tabular-nums">{gs(p.monto)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Servicios asociados ({d.servicios.length})</p>
                {d.total_deuda > 0 ? (
                  <button type="button" onClick={() => setEnCaja(true)} title="Cobro en efectivo u otro medio por la caja (como hasta ahora)"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-[#4FAEB2]/60 hover:text-[#3F8E91]">
                    <Wallet className="h-3.5 w-3.5" /> Cobro en caja
                  </button>
                ) : null}
              </div>
              <div className="space-y-3">
                {d.servicios.map((s) => {
                  const vencidas = s.cuotas.filter((c) => c.vencida);
                  const porVencer = s.cuotas.filter((c) => !c.vencida);
                  return (
                    <div key={s.suscripcion_id ?? "general"} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-sm font-semibold text-slate-900">{planDe(s)}</span>
                          {s.monto_mensual != null ? <span className="ml-2 text-xs text-slate-500">{gs(s.monto_mensual)}/mes</span> : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <TramoBadge tramo={s.tramo} />
                          <span className="text-sm font-semibold tabular-nums text-rose-700">{gs(s.total_adeudado)}</span>
                        </div>
                      </div>
                      <ListaCuotas titulo={`Vencidas (${vencidas.length})`} cuotas={vencidas} puede={d.puede_registrar} masVieja={masVieja} onPagar={(c) => setPagando(fijaDe(c))} />
                      {porVencer.length ? (
                        <ListaCuotas titulo={`Por vencer (${porVencer.length})`} cuotas={porVencer} puede={d.puede_registrar} masVieja={masVieja} onPagar={(c) => setPagando(fijaDe(c))} />
                      ) : null}
                    </div>
                  );
                })}
                {d.servicios.length === 0 ? <p className="text-xs text-slate-500">El cliente no tiene deuda.</p> : null}
              </div>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Último pago</p>
              {!d.ultimo_pago ? (
                <p className="text-xs text-slate-500">Sin pagos registrados.</p>
              ) : (
                <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-xs">
                  <span className="min-w-0 truncate text-slate-600">
                    {d.ultimo_pago.numero_recibo} · {fechaCorta(d.ultimo_pago.fecha)} · {d.ultimo_pago.metodos ?? "—"}
                    {d.ultimo_pago.aplicado_a ? <span className="text-slate-400"> · {d.ultimo_pago.aplicado_a}</span> : null}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-emerald-700">{gs(d.ultimo_pago.total)}</span>
                </div>
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Promesas de pago</p>
                <button type="button" onClick={() => setPromesaOpen(true)} className="rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/10 px-2.5 py-1 text-[11px] font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/20">
                  + Agregar promesa
                </button>
              </div>
              {d.promesas.length === 0 ? (
                <p className="text-xs text-slate-500">Sin promesas registradas.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {d.promesas.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                      <span className="min-w-0 text-slate-700">
                        <b className={`tabular-nums ${p.estado === "pendiente" && p.fecha_promesa === d.hoy ? "text-[#3F8E91]" : ""}`}>{fechaCorta(p.fecha_promesa)}</b>
                        <span className={`ml-2 inline-flex rounded-full border px-1.5 py-px text-[10px] font-semibold ${ESTADO_PROMESA[p.estado]}`}>{p.estado}</span>
                        {p.cerrada_motivo && p.estado !== "pendiente" ? <span className="ml-2 text-[10px] text-slate-400">{p.cerrada_motivo}</span> : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-[10px] text-slate-400">{p.creado_por ?? ""}</span>
                        {p.estado === "pendiente" ? (
                          <button type="button" onClick={() => void cancelarPromesa(p)} title="Cancelar la promesa" className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-rose-50 hover:text-rose-600">
                            Cancelar
                          </button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {!d.puede_registrar ? <p className="text-[11px] text-slate-400">Registrar pagos por transferencia está disponible para administradores, supervisores y cajeros.</p> : null}
          </div>
        )}
      </Drawer>

      {pagando ? (
        <RegistrarTransferencia fija={pagando} onClose={() => setPagando(null)}
          onHecho={(msg) => { setPagando(null); avisar(msg); void cargar(); onCambio(); }} />
      ) : null}
      {promesaOpen ? (
        <ModalPromesa clienteId={clienteId} onClose={() => setPromesaOpen(false)}
          onHecho={() => { setPromesaOpen(false); avisar("Promesa de pago registrada."); void cargar(); onCambio(); }} />
      ) : null}
    </>
  );
}

function ListaCuotas({ titulo, cuotas, puede, masVieja, onPagar }: {
  titulo: string; cuotas: CuotaDetalle[]; puede: boolean; masVieja: { id: string; numero: string } | null; onPagar: (c: CuotaDetalle) => void;
}) {
  return (
    <div className="mt-2">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">{titulo}</p>
      {cuotas.length === 0 ? (
        <p className="text-xs text-slate-500">Ninguna.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {cuotas.map((c) => {
            const libre = Math.round(Number(c.saldo) - Number(c.en_aprobacion));
            return (
              <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                <span className={`min-w-0 truncate ${c.vencida ? "text-rose-600" : "text-slate-600"}`}>
                  {c.numero} · vence {fechaCorta(c.vencimiento)}
                  {Number(c.en_aprobacion) > 0 ? <span className="ml-1 text-[10px] text-amber-700">({gs(c.en_aprobacion)} en aprobación)</span> : null}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-semibold tabular-nums text-slate-800">{gs(c.saldo)}</span>
                  {puede ? (
                    c.id === masVieja?.id ? (
                      libre > 0 ? (
                        <button type="button" onClick={() => onPagar(c)} className="rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/10 px-2 py-1 text-[10px] font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/20">
                          Registrar pago
                        </button>
                      ) : (
                        <span className="text-[10px] text-amber-700">En aprobación</span>
                      )
                    ) : (
                      <span className="text-[10px] text-slate-400" title={`Primero se cobra la cuota más vieja${masVieja ? ` (${masVieja.numero})` : ""}`}>
                        Pagá primero {masVieja?.numero ?? "la cuota anterior"}
                      </span>
                    )
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ModalPromesa({ clienteId, onClose, onHecho }: { clienteId: string; onClose: () => void; onHecho: () => void }) {
  const hoy = hoyPY();
  const [fecha, setFecha] = useState(hoy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/cobranzas/promesas", { method: "POST", body: JSON.stringify({ cliente_id: clienteId, fecha_promesa: fecha }) });
      onHecho();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <CapaModal onClose={busy ? undefined : onClose} z="z-[120]">
      <div onClick={(e) => e.stopPropagation()} className={`flex w-full max-w-sm ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl`} style={{ animation: "rb-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Agregar promesa de pago</h3>
            <p className="mt-1 text-xs text-slate-500">Fecha en que el cliente se comprometió a pagar.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fecha de promesa</span>
            <input type="date" value={fecha} min={hoy} onChange={(e) => setFecha(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20" />
          </label>
          {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
          <p className="mt-2 text-[11px] text-slate-400">Se marca cumplida sola cuando el cliente paga.</p>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
          <button type="button" disabled={busy || !fecha || fecha < hoy} onClick={() => void guardar()} className="rounded-xl bg-[#3F8E91] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#357a7d] disabled:opacity-50">
            {busy ? "Guardando…" : "Guardar promesa"}
          </button>
        </div>
      </div>
    </CapaModal>
  );
}
