"use client";

/**
 * Registrar un cobro (panel lateral). Arriba lo que debe y lo vencido; el monto se
 * propone con toda la deuda (o solo lo vencido, con un toque). Uno o varios medios de
 * pago. Se aplica solo a lo más viejo primero, o a las ventas que elijas. Se ve en vivo
 * cómo queda cada venta. Lo que se cobra de más (o sin deuda) queda A FAVOR del cliente
 * (anticipo); si ya tiene saldo a favor, se puede pagar la deuda con ese saldo.
 * Al terminar: el recibo para descargar.
 */
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, Loader2, PiggyBank, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { clienteConfig } from "@/cliente.config";
import { Drawer } from "@/components/Drawer";
import { Select } from "@/components/Select";
import MontoInput from "@/components/ui/MontoInput";
import { METODOS_COBRO, type EstadoCuenta, type MetodoCobro } from "@/modules/clientes/cobros";
import { SelectorCaja } from "@/modules/caja/SelectorCaja";

const BRAND = clienteConfig.color;
const INPUT = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
const ET = "mb-1 block text-xs font-medium text-slate-600";
const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const dia = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

type Pago = { key: number; metodo: MetodoCobro; monto: number; referencia: string };

export function RegistrarCobro({ clienteId, clienteNombre, onClose, onHecho, cxcInicial }: {
  clienteId: string; clienteNombre: string; onClose: () => void; onHecho: () => void;
  /** Cobrar una venta puntual (Gestión del Cliente → "Cobrar"): arranca con esa cuenta elegida y su saldo. */
  cxcInicial?: string | null;
}) {
  const [ec, setEc] = useState<EstadoCuenta | null>(null);
  const [total, setTotal] = useState(0);
  const [pagos, setPagos] = useState<Pago[]>([{ key: 1, metodo: "efectivo", monto: 0, referencia: "" }]);
  const [modo, setModo] = useState<"auto" | "elegir">("auto");
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [observacion, setObservacion] = useState("");
  // Caja a la que entra lo cobrado (la base valida que siga abierta y sea de su sucursal).
  const [cajaId, setCajaId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<{ id: string; numero: string; total: number; aFavor: number } | null>(null);

  useEffect(() => {
    apiFetch<EstadoCuenta>(`/api/clientes/${clienteId}/estado-cuenta`).then((r) => {
      setEc(r);
      const inicial = cxcInicial ? r.cuentas.find((c) => c.id === cxcInicial && Number(c.saldo) > 0) : undefined;
      if (inicial) {
        setModo("elegir");
        setElegidas(new Set([inicial.id]));
        setTotal(Number(inicial.saldo) || 0);
      } else {
        setTotal(Number(r.deuda) || 0);
      }
    }).catch((e) => setError((e as Error).message));
  }, [clienteId, cxcInicial]);

  const abiertas = useMemo(
    () => (ec?.cuentas ?? []).filter((c) => (c.estado === "pendiente" || c.estado === "parcial") && Number(c.saldo) > 0)
      .sort((a, b) => a.vencimiento.localeCompare(b.vencimiento) || a.numero.localeCompare(b.numero)),
    [ec],
  );

  // Con un solo medio, su monto acompaña al total.
  useEffect(() => {
    setPagos((ps) => (ps.length === 1 ? [{ ...ps[0], monto: total }] : ps));
  }, [total]);

  const sumaPagos = pagos.reduce((a, p) => a + (p.monto || 0), 0);
  const diferencia = total - sumaPagos;

  // Cómo queda cada venta (en vivo): las elegidas o lo más viejo primero.
  const aplicacion = useMemo(() => {
    let resto = total;
    const orden = modo === "elegir" ? abiertas.filter((c) => elegidas.has(c.id)) : abiertas;
    const m = new Map<string, number>();
    for (const c of orden) {
      if (resto <= 0) break;
      const a = Math.min(Number(c.saldo), resto);
      m.set(c.id, a);
      resto -= a;
    }
    return { m, sobrante: resto };
  }, [total, modo, abiertas, elegidas]);

  const deuda = Number(ec?.deuda ?? 0);
  const vencido = Number(ec?.vencido ?? 0);
  const saldoFavor = Number(ec?.saldo_favor ?? 0);
  const aFavor = Math.max(total - deuda, 0);
  const faltan = [
    !(total > 0) && "el monto",
    diferencia !== 0 && (diferencia > 0 ? `asignar ${gs(diferencia)} a un medio de pago` : `bajar ${gs(-diferencia)} de los medios de pago`),
    modo === "elegir" && aplicacion.sobrante > 0 && "elegir ventas que cubran el monto",
  ].filter(Boolean) as string[];

  async function registrar() {
    if (faltan.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ id: string; numero_recibo: string; total: number; a_favor?: number }>("/api/cobros", {
        method: "POST",
        body: JSON.stringify({
          cliente_id: clienteId,
          caja_id: cajaId,
          pagos: pagos.filter((p) => p.monto > 0).map((p) => ({ metodo: p.metodo, monto: p.monto, referencia: p.referencia.trim() || null })),
          aplicaciones: modo === "elegir" ? [...aplicacion.m.entries()].map(([cxc_id, monto]) => ({ cxc_id, monto })) : null,
          observacion: observacion.trim() || null,
        }),
      });
      setHecho({ id: r.id, numero: r.numero_recibo, total: r.total, aFavor: Number(r.a_favor ?? 0) });
      onHecho();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function usarSaldo() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ id: string; numero_recibo: string; total: number }>(`/api/clientes/${clienteId}/usar-saldo`, { method: "POST" });
      setHecho({ id: r.id, numero: r.numero_recibo, total: r.total, aFavor: 0 });
      onHecho();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (hecho) {
    return (
      <Drawer titulo="Cobro registrado" subtitulo={clienteNombre} onClose={onClose}>
        <div className="py-10 text-center">
          <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
          <p className="mt-4 text-lg font-semibold text-slate-900">Recibo {hecho.numero}</p>
          <p className="mt-1 text-sm text-slate-500">Por {gs(hecho.total)}. Ya se descontó de la deuda.</p>
          {hecho.aFavor > 0 ? <p className="mt-2 inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">{gs(hecho.aFavor)} quedaron a favor del cliente</p> : null}
          <div className="mt-6 flex justify-center gap-2 max-sm:flex-col max-sm:[&>button]:min-h-11 max-sm:[&>button]:justify-center">
            <button onClick={() => descargarArchivo(`/api/cobros/${hecho.id}/pdf`, `recibo-${hecho.numero}.pdf`).catch(() => {})}
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: BRAND }}>
              <Download className="h-4 w-4" /> Descargar recibo
            </button>
            <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Listo</button>
          </div>
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      titulo="Registrar cobro"
      subtitulo={clienteNombre}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 max-sm:flex-1">Cancelar</button>
          <button onClick={registrar} disabled={!!faltan.length || busy || !ec} className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-40 max-sm:flex-[2] max-sm:px-3" style={{ backgroundColor: BRAND }}>
            {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
            {busy ? "Registrando…" : deuda <= 0 ? `Registrar anticipo ${gs(total)}` : `Cobrar ${gs(total)}`}
          </button>
        </>
      }
    >
      {!ec ? (
        error ? <p className="text-sm text-rose-600">{error}</p> : <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : (
        <div className="space-y-6">
          {deuda <= 0 ? (
            <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <strong className="font-semibold">Este cliente no debe nada.</strong> Lo que cobres queda <strong className="font-semibold">a favor</strong> del cliente (anticipo): cuando compre a crédito, lo usás para pagar desde «Registrar cobro».
            </p>
          ) : null}
          {saldoFavor > 0 && deuda > 0 ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <PiggyBank className="h-5 w-5 text-emerald-600" />
              <p className="min-w-0 flex-1 text-sm text-emerald-800">Tiene <strong className="font-semibold">{gs(saldoFavor)} a favor</strong>. Podés usarlo para pagar {saldoFavor >= deuda ? "toda la deuda" : "parte de la deuda"}.</p>
              <button onClick={usarSaldo} disabled={busy} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 max-sm:min-h-11 max-sm:w-full">
                Pagar {gs(Math.min(saldoFavor, deuda))} con el saldo
              </button>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0 rounded-xl bg-slate-50 px-3 py-3 sm:px-4">
              <p className="text-[11px] text-slate-500">Debe en total</p>
              <p className="text-base font-bold tabular-nums text-slate-900 [overflow-wrap:anywhere] sm:text-lg">{gs(deuda)}</p>
            </div>
            <div className={`min-w-0 rounded-xl px-3 py-3 sm:px-4 ${vencido > 0 ? "bg-rose-50" : "bg-slate-50"}`}>
              <p className={`text-[11px] ${vencido > 0 ? "text-rose-600" : "text-slate-500"}`}>Vencido</p>
              <p className={`text-base font-bold tabular-nums [overflow-wrap:anywhere] sm:text-lg ${vencido > 0 ? "text-rose-600" : "text-slate-900"}`}>{gs(vencido)}</p>
            </div>
          </div>

          <div>
            <span className={ET}>¿Cuánto te paga?</span>
            <MontoInput value={total || ""} onChange={setTotal} decimals={false} className={`${INPUT} text-right text-lg font-bold tabular-nums`} />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {deuda > 0 ? <Chip on={total === deuda} onClick={() => setTotal(deuda)}>Todo · {gs(deuda)}</Chip> : null}
              {vencido > 0 && vencido < deuda ? <Chip on={total === vencido} onClick={() => setTotal(vencido)}>Solo lo vencido · {gs(vencido)}</Chip> : null}
            </div>
            {total > 0 && total < deuda ? <p className="mt-1 text-[11px] text-slate-500">Le va a quedar debiendo {gs(deuda - total)}.</p> : null}
            {aFavor > 0 ? <p className="mt-1 text-[11px] font-semibold text-emerald-700">{deuda > 0 ? `Paga ${gs(aFavor)} de más: ` : ""}{gs(aFavor)} quedan a favor del cliente.</p> : null}
          </div>

          <div>
            <span className={ET}>Cómo te paga</span>
            <ul className="space-y-2">
              {pagos.map((p) => (
                <li key={p.key} className="flex flex-wrap items-center gap-2 max-sm:rounded-xl max-sm:border max-sm:border-slate-200 max-sm:p-2 sm:flex-nowrap">
                  <div className={`min-w-0 flex-1 sm:w-36 sm:flex-none ${pagos.length > 1 ? "max-sm:basis-[calc(100%-3.25rem)]" : "max-sm:basis-full"}`}>
                    <Select etiqueta="Medio de pago" value={p.metodo} onChange={(v) => setPagos((ps) => ps.map((x) => (x.key === p.key ? { ...x, metodo: v as MetodoCobro } : x)))} block options={METODOS_COBRO.map((m): [string, string] => [m.v, m.l])} />
                  </div>
                  <MontoInput value={p.monto || ""} onChange={(v) => setPagos((ps) => ps.map((x) => (x.key === p.key ? { ...x, monto: v } : x)))} decimals={false} placeholder="0" className={`${INPUT} min-w-0 flex-1 text-right tabular-nums max-sm:order-3 max-sm:basis-[calc(50%-0.25rem)]`} />
                  {p.metodo !== "efectivo" ? (
                    <input value={p.referencia} onChange={(e) => setPagos((ps) => ps.map((x) => (x.key === p.key ? { ...x, referencia: e.target.value } : x)))} maxLength={120} placeholder="Nº / banco" className={`${INPUT} min-w-0 max-sm:order-4 max-sm:flex-1 max-sm:basis-[calc(50%-0.25rem)] sm:w-32`} />
                  ) : null}
                  {pagos.length > 1 ? (
                    <button onClick={() => setPagos((ps) => ps.filter((x) => x.key !== p.key))} aria-label="Quitar medio" className="inline-flex shrink-0 items-center justify-center rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 max-sm:order-2 max-sm:h-11 max-sm:w-11"><Trash2 className="h-4 w-4" /></button>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <button onClick={() => setPagos((ps) => [...ps, { key: Date.now(), metodo: "transferencia", monto: Math.max(diferencia, 0), referencia: "" }])}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)] hover:underline max-sm:min-h-11">
                <Plus className="h-3.5 w-3.5" /> Agregar otro medio (pago combinado)
              </button>
              {diferencia !== 0 && pagos.length > 1 ? (
                <span className="text-xs font-semibold text-amber-600">{diferencia > 0 ? `Falta asignar ${gs(diferencia)}` : `Sobran ${gs(-diferencia)}`}</span>
              ) : null}
            </div>
            <div className="mt-3">
              <SelectorCaja value={cajaId} onChange={setCajaId} etiqueta="Entra a la caja" />
            </div>
          </div>

          {abiertas.length ? (
          <div>
            <span className={ET}>A qué ventas se aplica</span>
            <div className="flex rounded-xl bg-slate-100 p-1">
              {([["auto", "Lo más viejo primero"], ["elegir", "Elegir ventas"]] as const).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setModo(v)}
                  className={`min-h-10 flex-1 rounded-lg px-2 py-1.5 text-sm font-semibold leading-tight transition sm:min-h-0 ${modo === v ? "bg-white shadow-sm" : "text-slate-500"}`}
                  style={modo === v ? { color: BRAND } : undefined}>{l}</button>
              ))}
            </div>
            <ul className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
              {abiertas.map((c) => {
                const aplicado = aplicacion.m.get(c.id) ?? 0;
                const queda = Number(c.saldo) - aplicado;
                return (
                  <li key={c.id} className="flex items-center gap-3 px-3 py-2.5 max-sm:min-h-12">
                    {modo === "elegir" ? (
                      <input type="checkbox" checked={elegidas.has(c.id)} onChange={() => setElegidas((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} className="h-5 w-5 shrink-0 accent-[var(--brand)] sm:h-4 sm:w-4" />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800">
                        <span className="font-mono text-xs">{c.numero}</span>
                        <span className="ml-2 inline-block text-xs text-slate-500">del {dia(c.fecha_emision)} · vence {dia(c.vencimiento)}</span>
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Debe {gs(c.saldo)}
                        {c.dias_atraso > 0 ? <span className="font-semibold text-rose-600"> · vencida hace {c.dias_atraso} días</span> : null}
                      </p>
                    </div>
                    {aplicado > 0 ? (
                      <span className="shrink-0 text-right text-xs">
                        <span className="block font-semibold text-emerald-700">− {gs(aplicado)}</span>
                        <span className={queda > 0 ? "text-slate-500" : "font-semibold text-emerald-700"}>{queda > 0 ? `queda ${gs(queda)}` : "queda pagada"}</span>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
          ) : null}

          <label className="block">
            <span className={ET}>Observación <span className="font-normal text-slate-400">(opcional)</span></span>
            <input value={observacion} onChange={(e) => setObservacion(e.target.value)} maxLength={1000} placeholder="Ej: pagó la hija" className={INPUT} />
          </label>

          {faltan.length ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Falta: {faltan.join(", ")}.</p> : null}
          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
        </div>
      )}
    </Drawer>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-full border px-3 py-1 text-xs font-semibold transition max-sm:min-h-9 ${on ? "border-[var(--brand)] bg-[var(--brand-50)] text-[var(--brand)]" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
      {children}
    </button>
  );
}
