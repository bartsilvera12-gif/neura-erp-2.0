"use client";

/**
 * Panel de control de la caja por TURNO. Portado de neura-erp-oymcomercial,
 * re-plomado al 2.0: una sola caja por empresa (sin sucursales ni multi-PV).
 * Abrir → ver resumen + movimientos → arquear → cerrar. Notifica al padre si
 * hay caja abierta (onStateChange) para habilitar/bloquear la venta.
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, ChevronDown, ChevronUp, Clock, Lock } from "lucide-react";
import MontoInput from "@/components/ui/MontoInput";
import { clienteConfig } from "@/cliente.config";
import {
  abrirCaja,
  cerrarCaja,
  getResumenCaja,
  registrarMovimiento,
  type CajaResumen,
  type CajaTurno,
  type MedioPagoCaja,
  type TipoMovimientoCaja,
} from "@/modules/caja/turno";

const TEAL = clienteConfig.color;

function formatGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}
function formatFechaHora(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2";

type ModalKind = null | "abrir" | "cerrar" | "mov";

export default function CajaControlPanel({
  onStateChange,
  defaultCollapsed = false,
  refreshTick = 0,
}: {
  onStateChange?: (abierta: boolean) => void;
  defaultCollapsed?: boolean;
  refreshTick?: number;
}) {
  const [loading, setLoading] = useState(true);
  const [caja, setCaja] = useState<CajaTurno | null>(null);
  const [resumen, setResumen] = useState<CajaResumen | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [verMovs, setVerMovs] = useState(false);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { caja: c, resumen: r } = await getResumenCaja();
    setCaja(c);
    setResumen(r);
    onStateChange?.(!!c);
    setLoading(false);
  }, [onStateChange]);

  useEffect(() => { void refresh(); }, [refresh, refreshTick]);

  if (loading && !caja) {
    return <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400 shadow-sm">Cargando estado de caja…</div>;
  }

  return (
    <>
      {caja ? (
        <div className="overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50/70 to-white shadow-sm ring-1 ring-emerald-500/5">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              {/* Indicador de turno abierto, con pulso suave. */}
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">Caja abierta</span>
                  <span className="text-sm font-semibold text-slate-800">Turno N° {caja.numero_caja}</span>
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500">
                  <Clock className="h-3 w-3 shrink-0 text-slate-400" />
                  <span>{formatFechaHora(caja.fecha_apertura)}</span>
                  <span className="text-slate-300">·</span>
                  <span>Monto inicial <strong className="font-semibold text-slate-700">{formatGs(caja.monto_apertura)}</strong></span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setModal("mov")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                <ArrowLeftRight className="h-4 w-4 text-slate-400" /> <span className="hidden sm:inline">Movimiento</span>
              </button>
              <button
                type="button"
                onClick={() => setModal("cerrar")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-600 shadow-sm transition-colors hover:border-rose-300 hover:bg-rose-50"
              >
                <Lock className="h-4 w-4" /> <span className="hidden sm:inline">Cerrar caja</span>
              </button>
              <button
                type="button"
                onClick={() => setCollapsed((v) => !v)}
                title={collapsed ? "Ver resumen del turno" : "Minimizar"}
                aria-label={collapsed ? "Ver resumen" : "Minimizar"}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-white hover:text-slate-700"
              >
                {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {!collapsed && (
          <div className="border-t border-emerald-100/70 px-4 py-4 sm:px-5">
            {resumen && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Total vendido" value={formatGs(resumen.total_vendido)} sub={`${resumen.cantidad_ventas} venta(s)`} />
              <Stat label="Efectivo" value={formatGs(resumen.total_efectivo)} />
              <Stat label="Transferencia" value={formatGs(resumen.total_transferencia)} />
              <Stat label="Tarjeta" value={formatGs(resumen.total_tarjeta)} />
              <Stat label="POS" value={formatGs(resumen.total_pos)} />
              <Stat label="Debería haber en caja" value={formatGs(resumen.efectivo_esperado)} sub="apertura + efectivo ± mov." accent />
              <Stat label="Ingresos efvo." value={formatGs(resumen.ingresos_efectivo)} />
              <Stat label="Egresos efvo." value={formatGs(resumen.egresos_efectivo)} />
              <Stat label="Retiros efvo." value={formatGs(resumen.retiros_efectivo)} />
            </div>
          )}

            {resumen && resumen.movimientos.length > 0 && (
            <div className="mt-4">
              <button type="button" onClick={() => setVerMovs((v) => !v)} className="text-xs font-semibold text-emerald-800 underline underline-offset-2 hover:text-emerald-900">
                {verMovs ? "Ocultar" : "Ver"} movimientos ({resumen.movimientos.length})
              </button>
              {verMovs && (
                <div className="mt-2 overflow-hidden rounded-lg border border-emerald-200/60 bg-white/70">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-emerald-50/60 text-emerald-800">
                        <tr>
                          <th className="px-3 py-1.5 text-left font-semibold uppercase tracking-wide">Hora</th>
                          <th className="px-3 py-1.5 text-left font-semibold uppercase tracking-wide">Tipo</th>
                          <th className="px-3 py-1.5 text-left font-semibold uppercase tracking-wide">Concepto</th>
                          <th className="hidden px-3 py-1.5 text-left font-semibold uppercase tracking-wide sm:table-cell">Medio</th>
                          <th className="px-3 py-1.5 text-right font-semibold uppercase tracking-wide">Monto</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-emerald-100">
                        {resumen.movimientos.slice().reverse().map((m) => {
                          const tipoBadge = m.tipo === "ingreso" ? "bg-emerald-100 text-emerald-800" : m.tipo === "egreso" ? "bg-rose-100 text-rose-800" : m.tipo === "retiro" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700";
                          return (
                            <tr key={m.id} className="hover:bg-emerald-50/30">
                              <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-500">{new Date(m.created_at).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })}</td>
                              <td className="px-3 py-2"><span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tipoBadge}`}>{m.tipo}</span></td>
                              <td className="px-3 py-2 text-slate-700"><div className="font-medium">{m.concepto}</div>{m.observacion && <div className="text-[11px] text-slate-500">{m.observacion}</div>}</td>
                              <td className="hidden px-3 py-2 capitalize text-slate-600 sm:table-cell">{m.medio_pago}</td>
                              <td className={`px-3 py-2 text-right font-semibold tabular-nums ${m.tipo === "ingreso" ? "text-emerald-700" : m.tipo === "egreso" || m.tipo === "retiro" ? "text-rose-700" : "text-slate-700"}`}>
                                {m.tipo === "egreso" || m.tipo === "retiro" ? "−" : m.tipo === "ingreso" ? "+" : ""}{formatGs(m.monto)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            )}
          </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                <span className="text-xs font-semibold uppercase tracking-wider text-amber-700">Caja cerrada</span>
              </div>
              <p className="mt-1 text-sm text-slate-600">Para vender primero tenés que <strong>abrir caja</strong>.</p>
            </div>
            <button type="button" onClick={() => setModal("abrir")} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700">Abrir caja</button>
          </div>
        </div>
      )}

      {modal === "abrir" && <AbrirCajaModal onClose={() => setModal(null)} onDone={() => { setModal(null); void refresh(); }} />}
      {modal === "cerrar" && caja && resumen && <CerrarCajaModal caja={caja} resumen={resumen} onClose={() => setModal(null)} onDone={() => { setModal(null); void refresh(); }} />}
      {modal === "mov" && caja && <MovimientoModal onClose={() => setModal(null)} onDone={() => { setModal(null); void refresh(); }} />}
    </>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-2.5 ${accent ? "border-emerald-300 bg-emerald-100/60" : "border-slate-200 bg-white"}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}

function ModalShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  // Cerrar con Esc.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Overlay con scroll propio + centrado: si el modal es más alto que la pantalla,
  // se puede scrollear y NO se corta ni arriba ni abajo.
  return (
    <div className="fixed inset-0 z-[120] overflow-y-auto bg-slate-900/60 backdrop-blur-sm" onClick={onClose}>
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="flex w-full max-w-md flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-slate-200 p-4">
            <h3 className="text-base font-semibold text-slate-800">{title}</h3>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" title="Cerrar (Esc)">✕</button>
          </div>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

function ErrorBanner({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">⚠ {msg}</div>;
}

// ── Abrir ──────────────────────────────────────────────────────────────────
function AbrirCajaModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [monto, setMonto] = useState("");
  const [obs, setObs] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError(null);
    setSaving(true);
    const r = await abrirCaja(parseFloat(monto) || 0, obs.trim() || null);
    setSaving(false);
    if (!r.success) { setError(r.error); return; }
    onDone();
  }

  return (
    <ModalShell title="Abrir caja" onClose={onClose}>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">Monto de apertura (Gs.)</label>
      <MontoInput value={monto} onChange={(n) => setMonto(String(n))} placeholder="Ej: 300.000" className={inputClass} decimals={false} autoFocus />
      <label className="mb-1.5 mt-3 block text-sm font-medium text-slate-700">Observación (opcional)</label>
      <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} className={inputClass} placeholder="Ej: turno tarde" />
      <ErrorBanner msg={error} />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50">Cancelar</button>
        <button type="button" onClick={submit} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{saving ? "Abriendo…" : "Abrir caja"}</button>
      </div>
    </ModalShell>
  );
}

// ── Cerrar ─────────────────────────────────────────────────────────────────
function CerrarCajaModal({ caja, resumen, onClose, onDone }: { caja: CajaTurno; resumen: CajaResumen; onClose: () => void; onDone: () => void }) {
  const [monto, setMonto] = useState("");
  const [obs, setObs] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const apertura = caja.monto_apertura;
  const transf = resumen.total_transferencia;
  const tarjeta = resumen.total_tarjeta;
  const pos = resumen.total_pos;
  const electronico = transf + tarjeta + pos; // no entra al cajón físico
  const efectivoEsperado = resumen.efectivo_esperado;
  const manualNet = resumen.ingresos_efectivo - resumen.egresos_efectivo - resumen.retiros_efectivo + resumen.ajustes_efectivo;
  const cierreTotalEsperado = efectivoEsperado + electronico;

  const contado = parseFloat(monto) || 0;
  const difEfectivo = contado - efectivoEsperado;
  const totalDeclarado = contado + electronico;
  const difTotal = totalDeclarado - cierreTotalEsperado;

  async function submit() {
    setError(null);
    setSaving(true);
    const r = await cerrarCaja(contado, obs.trim() || null);
    setSaving(false);
    if (!r.success) { setError(r.error); return; }
    onDone();
  }

  return (
    <ModalShell title={`Cerrar caja · turno N° ${caja.numero_caja}`} onClose={onClose}>
      <SectionLabel>Resumen de ventas del turno</SectionLabel>
      <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
        <Row label="Cantidad de ventas" value={String(resumen.cantidad_ventas)} />
        <Row label="Ventas en efectivo" value={formatGs(resumen.total_efectivo)} />
        <Row label="Ventas por transferencia" value={formatGs(transf)} />
        <Row label="Ventas con tarjeta" value={formatGs(tarjeta)} />
        <Row label="Ventas con POS" value={formatGs(pos)} />
        <div className="flex justify-between border-t border-slate-200 pt-1.5 font-bold text-slate-900"><span>Total vendido</span><span className="tabular-nums">{formatGs(resumen.total_vendido)}</span></div>
      </div>

      <SectionLabel className="mt-4">Cierre total del turno</SectionLabel>
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-3.5">
        <div className="space-y-1.5 text-sm">
          <Row label="Monto de apertura" value={formatGs(apertura)} />
          <Row label="Total vendido" value={`+ ${formatGs(resumen.total_vendido)}`} />
          {manualNet !== 0 && <Row label="Movimientos manuales de efectivo" value={`${manualNet > 0 ? "+" : "−"} ${formatGs(Math.abs(manualNet))}`} />}
        </div>
        <div className="mt-2.5 flex items-baseline justify-between border-t border-sky-200 pt-2.5">
          <span className="text-sm font-semibold text-sky-900">Cierre total esperado</span>
          <span className="text-xl font-extrabold tabular-nums text-sky-900">{formatGs(cierreTotalEsperado)}</span>
        </div>
      </div>

      <SectionLabel className="mt-4">Cierre</SectionLabel>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">Efectivo físico contado en caja (Gs.)</label>
      <MontoInput value={monto} onChange={(n) => setMonto(String(n))} placeholder="Ej: 160.000" className={inputClass} decimals={false} autoFocus />
      <p className="mt-1 text-[11px] leading-snug text-slate-400">Ingresá solo el dinero físico en caja. Transferencias y tarjetas se toman de las ventas registradas.</p>

      {monto !== "" && (
        <div className="mt-3 space-y-2">
          <DiffRow label="Diferencia de efectivo físico" hint={`contado − esperado (${formatGs(efectivoEsperado)})`} value={difEfectivo} />
          <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <span>Total declarado (efectivo + transf. + tarjetas + POS)</span>
            <span className="font-medium tabular-nums text-slate-700">{formatGs(totalDeclarado)}</span>
          </div>
          <DiffRow label="Diferencia total del turno" hint={`declarado − cierre total (${formatGs(cierreTotalEsperado)})`} value={difTotal} />
        </div>
      )}

      <label className="mb-1.5 mt-3 block text-sm font-medium text-slate-700">Observación (opcional)</label>
      <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} className={inputClass} />
      <ErrorBanner msg={error} />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50">Cancelar</button>
        <button type="button" onClick={submit} disabled={saving || monto === ""} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50">{saving ? "Cerrando…" : "Confirmar cierre"}</button>
      </div>
    </ModalShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-slate-600"><span>{label}</span><span className="tabular-nums">{value}</span></div>;
}
function SectionLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${className}`}>{children}</p>;
}
function DiffRow({ label, hint, value }: { label: string; hint: string; value: number }) {
  const tone = value === 0 ? "bg-emerald-50 text-emerald-700" : value > 0 ? "bg-sky-50 text-sky-700" : "bg-red-50 text-red-700";
  const signo = value > 0 ? "+ " : value < 0 ? "− " : "";
  const estado = value > 0 ? "(sobra)" : value < 0 ? "(falta)" : "(cuadra)";
  return (
    <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold ${tone}`}>
      <span>{label} <span className="font-normal opacity-70">{estado}</span><span className="mt-0.5 block text-[10px] font-normal opacity-60">{hint}</span></span>
      <span className="tabular-nums">{signo}{formatGs(Math.abs(value))}</span>
    </div>
  );
}

// ── Movimiento ─────────────────────────────────────────────────────────────
const TIPOS: { v: TipoMovimientoCaja; label: string }[] = [
  { v: "ingreso", label: "Ingreso" }, { v: "egreso", label: "Egreso" }, { v: "retiro", label: "Retiro" }, { v: "ajuste", label: "Ajuste" },
];
const MEDIOS: { v: MedioPagoCaja; label: string }[] = [
  { v: "efectivo", label: "Efectivo" }, { v: "tarjeta", label: "Tarjeta" }, { v: "transferencia", label: "Transferencia" }, { v: "otro", label: "Otro" },
];

function MovimientoModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [tipo, setTipo] = useState<TipoMovimientoCaja>("ingreso");
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [medio, setMedio] = useState<MedioPagoCaja>("efectivo");
  const [obs, setObs] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError(null);
    if (concepto.trim() === "") { setError("El concepto es obligatorio."); return; }
    if (!(parseFloat(monto) > 0)) { setError("El monto debe ser mayor a 0."); return; }
    setSaving(true);
    const r = await registrarMovimiento({ tipo, concepto: concepto.trim(), monto: parseFloat(monto) || 0, medio_pago: medio, observacion: obs.trim() || null });
    setSaving(false);
    if (!r.success) { setError(r.error); return; }
    onDone();
  }

  const segBtn = (sel: boolean) =>
    `rounded-md border py-1.5 text-xs font-medium transition-colors ${sel ? "text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`;

  return (
    <ModalShell title="Movimiento de caja" onClose={onClose}>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">Tipo</label>
      <div className="grid grid-cols-4 gap-1">
        {TIPOS.map((t) => (
          <button key={t.v} type="button" onClick={() => setTipo(t.v)} className={segBtn(tipo === t.v)} style={tipo === t.v ? { backgroundColor: TEAL, borderColor: TEAL } : undefined}>{t.label}</button>
        ))}
      </div>
      <label className="mb-1.5 mt-3 block text-sm font-medium text-slate-700">Concepto</label>
      <input type="text" value={concepto} onChange={(e) => setConcepto(e.target.value)} className={inputClass} placeholder="Ej: pago proveedor / retiro socio" />
      <label className="mb-1.5 mt-3 block text-sm font-medium text-slate-700">Monto (Gs.)</label>
      <MontoInput value={monto} onChange={(n) => setMonto(String(n))} placeholder="Ej: 50.000" className={inputClass} decimals={false} />
      <label className="mb-1.5 mt-3 block text-sm font-medium text-slate-700">Medio de pago</label>
      <div className="grid grid-cols-4 gap-1">
        {MEDIOS.map((m) => (
          <button key={m.v} type="button" onClick={() => setMedio(m.v)} className={segBtn(medio === m.v)} style={medio === m.v ? { backgroundColor: TEAL, borderColor: TEAL } : undefined}>{m.label}</button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-slate-400">Solo los movimientos en efectivo afectan el efectivo esperado.</p>
      <label className="mb-1.5 mt-3 block text-sm font-medium text-slate-700">Observación (opcional)</label>
      <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} className={inputClass} />
      <ErrorBanner msg={error} />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50">Cancelar</button>
        <button type="button" onClick={submit} disabled={saving} className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50" style={{ backgroundColor: TEAL }}>{saving ? "Guardando…" : "Registrar"}</button>
      </div>
    </ModalShell>
  );
}
