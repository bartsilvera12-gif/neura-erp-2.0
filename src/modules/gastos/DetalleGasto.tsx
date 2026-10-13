"use client";

/**
 * Detalle de un gasto o servicio (modal): datos fiscales, líneas, totales por tasa de IVA,
 * la deuda con el proveedor (si fue a crédito, con sus órdenes de pago) o el egreso de caja,
 * y el comprobante adjunto (ver / adjuntar / quitar). Acciones según el estado:
 * borrador → abrir y confirmar / eliminar · confirmado → anular (con motivo).
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, Eye, Loader2, Paperclip, Pencil, Trash2, X } from "lucide-react";
import { apiFetch, apiForm } from "@/lib/api/client-fetch";
import { TZ_PY } from "@/lib/fecha/paraguay";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { ACCEPT_COMPROBANTE, validarComprobante } from "@/modules/compras/Comprobantes";
import { ESTADO_CXP } from "@/modules/compras/pagos";
import { ESTADO_GASTO, fechaCorta, gs, nombreMedioGasto, type DetalleGasto as Detalle } from "@/modules/gastos/tipos";

const fechaHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export function DetalleGasto({ id, onClose, onEditar, onEliminar, onAnular, onCambio }: {
  id: string;
  onClose: () => void;
  onEditar: (id: string) => void;
  onEliminar: (d: { id: string; numero: string | null }) => void;
  onAnular: (d: { id: string; numero: string | null }) => void;
  onCambio: () => void;
}) {
  const [d, setD] = useState<Detalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const cargar = useCallback(() => {
    apiFetch<Detalle>(`/api/gastos/${id}`).then(setD).catch((e) => setError((e as Error).message));
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  async function verComprobante() {
    const w = window.open("", "_blank");
    if (w) w.opener = null;
    try {
      const r = await apiFetch<{ url: string }>(`/api/gastos/${id}/comprobante`);
      if (w) w.location.href = r.url; else window.location.href = r.url;
    } catch (e) {
      w?.close();
      setError((e as Error).message);
    }
  }

  async function adjuntar(f: File) {
    const err = validarComprobante(f);
    if (err) { setError(err); return; }
    setSubiendo(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      await apiForm(`/api/gastos/${id}/comprobante`, fd);
      cargar();
      onCambio();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubiendo(false);
    }
  }

  async function quitarComprobante() {
    setSubiendo(true);
    setError(null);
    try {
      await apiFetch(`/api/gastos/${id}/comprobante`, { method: "DELETE" });
      cargar();
      onCambio();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubiendo(false);
    }
  }

  const g = d?.gasto;
  const est = g ? ESTADO_GASTO[g.estado] : null;

  return (
    <CapaModal onClose={onClose}>
      <div className={`flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${ALTO_MAX_MODAL}`} style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4FAEB2]">Gasto o servicio</p>
            <h2 className="mt-0.5 flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-800">
              <span className="font-mono">{g?.numero ?? "Borrador"}</span>
              {est ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${est.c}`}>{est.t}</span> : null}
            </h2>
            {g ? <p className="text-sm text-slate-500">{g.proveedor_nombre ?? "Sin proveedor"}{g.proveedor_ruc ? ` · RUC ${g.proveedor_ruc}` : ""}</p> : null}
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5 text-sm">
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</div> : null}
          {!d || !g ? (
            !error ? <p className="py-10 text-center text-slate-400">Cargando…</p> : null
          ) : (
            <>
              {g.estado === "anulado" ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  Anulado el {fechaHora(g.anulado_at)}{g.anulado_por ? ` por ${g.anulado_por}` : ""}. Motivo: {g.anulado_motivo ?? "—"}
                </div>
              ) : null}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                <Dato t="Comprobante" v={[g.tipo_comprobante, g.numero_comprobante].filter(Boolean).join(" ") || "—"} mono />
                <Dato t="Timbrado" v={g.timbrado ?? "—"} mono />
                <Dato t="Fecha" v={fechaCorta(g.fecha_comprobante)} />
                <Dato t="Condición" v={g.tipo_pago === "credito" ? `Crédito${g.plazo_dias ? ` ${g.plazo_dias} días` : ""}` : g.tipo_pago === "contado" ? "Contado" : "—"} />
                {g.tipo_pago === "credito" ? <Dato t="Vencimiento" v={fechaCorta(g.fecha_vencimiento)} /> : <Dato t="Medio de pago" v={nombreMedioGasto(g.medio_pago)} />}
                {g.tipo_pago === "contado" && g.referencia_pago ? <Dato t="Referencia" v={g.referencia_pago} /> : null}
                {g.descripcion ? <div className="col-span-2 sm:col-span-3"><Dato t="Descripción" v={g.descripcion} /></div> : null}
              </dl>

              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    <tr><th className="px-3 py-2">Categoría</th><th className="px-3 py-2">Descripción</th><th className="px-3 py-2">IVA</th><th className="px-3 py-2 text-right">Monto</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.items.length === 0 ? (
                      <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">Sin líneas</td></tr>
                    ) : d.items.map((it, i) => (
                      <tr key={it.id ?? i}>
                        <td className="px-3 py-2 text-xs text-slate-600">{it.categoria_nombre ?? <span className="italic text-slate-400">Sin categoría</span>}</td>
                        <td className="px-3 py-2 text-slate-800">{it.descripcion}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">{it.iva_tipo === "exenta" ? "Exenta" : `${it.iva_tipo} · ${gs(it.monto_iva)}`}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-slate-800">{gs(it.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex flex-wrap justify-end gap-x-5 gap-y-1 border-t border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  <span>Subtotal <b className="text-slate-700">{gs(g.subtotal)}</b></span>
                  {Number(g.iva_10) ? <span>IVA 10 % <b className="text-slate-700">{gs(g.iva_10)}</b></span> : null}
                  {Number(g.iva_5) ? <span>IVA 5 % <b className="text-slate-700">{gs(g.iva_5)}</b></span> : null}
                  {Number(g.exenta) ? <span>Exentas <b className="text-slate-700">{gs(g.exenta)}</b></span> : null}
                  <span className="text-sm text-slate-600">Total <b className="text-slate-900">{gs(g.total)}</b></span>
                </div>
              </div>

              {d.cxp ? (
                <div className="rounded-xl border border-slate-200 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Deuda con el proveedor</p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${(ESTADO_CXP[d.cxp.estado] ?? ESTADO_CXP.pendiente).c}`}>{(ESTADO_CXP[d.cxp.estado] ?? ESTADO_CXP.pendiente).t}</span>
                  </div>
                  <p className="mt-1 text-slate-700">
                    Saldo <b className="tabular-nums">{gs(d.cxp.saldo)}</b> de {gs(d.cxp.monto)} · vence {fechaCorta(d.cxp.vencimiento)}
                  </p>
                  {d.cxp.pagos.length ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Pagos: {d.cxp.pagos.map((p) => `${p.numero} (${gs(p.monto)}${p.anulado ? ", anulado" : ""})`).join(" · ")}
                    </p>
                  ) : null}
                  {g.estado === "confirmado" && Number(d.cxp.saldo) > 0 ? (
                    <Link href="/compras/pagos" className="mt-2 inline-block text-xs font-semibold text-[#3F8E91] hover:underline">Pagar en Compras › Pagos a proveedores →</Link>
                  ) : null}
                </div>
              ) : d.caja ? (
                <div className="rounded-xl border border-slate-200 px-4 py-3 text-slate-700">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Egreso de caja</p>
                  <p className="mt-1">{gs(d.caja.monto)} en efectivo de la caja N° {d.caja.numero_caja}{d.caja.anulado ? " (anulado)" : ""}.</p>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 px-4 py-3">
                <Paperclip className="h-4 w-4 text-slate-400" />
                {g.tiene_comprobante ? (
                  <>
                    <span className="min-w-0 flex-1 truncate text-slate-700">{g.comprobante_nombre ?? "Comprobante"}</span>
                    <button onClick={() => void verComprobante()} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"><Eye className="h-3.5 w-3.5" /> Ver</button>
                    {g.estado !== "anulado" ? (
                      <button onClick={() => void quitarComprobante()} disabled={subiendo} className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50">Quitar</button>
                    ) : null}
                  </>
                ) : (
                  <span className="flex-1 text-slate-400">Sin comprobante adjunto</span>
                )}
                {g.estado !== "anulado" ? (
                  <>
                    <input ref={fileRef} type="file" accept={ACCEPT_COMPROBANTE} className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void adjuntar(f); }} />
                    <button onClick={() => fileRef.current?.click()} disabled={subiendo}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#4FAEB2]/40 px-2.5 py-1 text-xs font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/5 disabled:opacity-50">
                      {subiendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />} {g.tiene_comprobante ? "Reemplazar" : "Adjuntar"}
                    </button>
                  </>
                ) : null}
              </div>

              {g.observacion ? <p className="whitespace-pre-line text-xs text-slate-500">Observación: {g.observacion}</p> : null}
              <p className="text-[11px] text-slate-400">
                Cargado por {g.usuario_nombre ?? "—"} el {fechaHora(g.created_at)}
                {g.confirmado_at ? ` · confirmado por ${g.confirmado_por ?? "—"} el ${fechaHora(g.confirmado_at)}` : ""}
              </p>
            </>
          )}
        </div>

        {g ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
            {g.estado === "borrador" ? (
              <>
                <button onClick={() => onEliminar({ id: g.id, numero: g.numero })} className="mr-auto inline-flex items-center gap-1 rounded-xl px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /> Eliminar</button>
                <button onClick={() => onEditar(g.id)} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"><Pencil className="h-4 w-4" /> Abrir y confirmar</button>
              </>
            ) : g.estado === "confirmado" ? (
              <button onClick={() => onAnular({ id: g.id, numero: g.numero })} className="mr-auto inline-flex items-center gap-1 rounded-xl px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"><Ban className="h-4 w-4" /> Anular</button>
            ) : null}
            <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cerrar</button>
          </div>
        ) : null}
      </div>
    </CapaModal>
  );
}

function Dato({ t, v, mono }: { t: string; v: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t}</dt>
      <dd className={`mt-0.5 break-words text-slate-800 ${mono ? "font-mono text-xs" : ""}`}>{v}</dd>
    </div>
  );
}

/** Confirmación con motivo (anular) o simple (eliminar borrador). */
export function ConfirmarAccionGasto({ modo, gasto, onClose, onHecho }: {
  modo: "anular" | "eliminar";
  gasto: { id: string; numero: string | null };
  onClose: () => void;
  onHecho: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anular = modo === "anular";

  async function enviar() {
    if (busy) return;
    if (anular && motivo.trim().length < 3) { setError("Escribí el motivo (mínimo 3 caracteres)."); return; }
    setBusy(true);
    setError(null);
    try {
      if (anular) await apiFetch(`/api/gastos/${gasto.id}/anular`, { method: "POST", body: JSON.stringify({ motivo: motivo.trim() }) });
      else await apiFetch(`/api/gastos/${gasto.id}`, { method: "DELETE" });
      onHecho();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <CapaModal onClose={busy ? undefined : onClose} z="z-[60]">
      <div className={`flex w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${ALTO_MAX_MODAL}`} style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="shrink-0 border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-800">{anular ? `Anular ${gasto.numero ?? "el gasto"}` : "Eliminar el borrador"}</h2>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4 text-sm text-slate-600">
          {anular ? (
            <>
              <p>El documento conserva su número y queda como anulado. Si fue a crédito se anula la deuda con el proveedor (no si ya tiene pagos); si salió efectivo de la caja, se anula ese egreso (solo con la caja abierta).</p>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Motivo *</label>
                <textarea autoFocus rows={3} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20" />
              </div>
            </>
          ) : (
            <p>¿Eliminar el borrador? Esta acción no se puede deshacer.</p>
          )}
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
          <button onClick={() => void enviar()} disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {anular ? "Anular" : "Eliminar"}
          </button>
        </div>
      </div>
    </CapaModal>
  );
}
