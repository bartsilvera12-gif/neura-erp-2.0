"use client";

/**
 * Registrar un cobro por TRANSFERENCIA (maker-checker): NO baja la deuda, queda pendiente
 * de aprobación en Conciliación bancaria y se avisa a los administradores.
 *   · desde Seguimiento (`fija`): la cuota más vieja del cliente, comprobante obligatorio
 *   · desde Conciliación: se busca la factura; después se pueden tildar otras facturas del
 *     mismo cliente → UNA transferencia aplicada a varias (todo o nada)
 * Banco del catálogo; si el banco no emite N° de operación (ej. Familiar) se genera una
 * referencia visible y editable. Titular en MAYÚSCULAS. idempotency_key por factura: un
 * doble click o un reintento no duplica.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Loader2, Paperclip, RefreshCw, Search, X } from "lucide-react";
import { apiFetch, apiForm } from "@/lib/api/client-fetch";
import { apiFetchCache } from "@/lib/api/cache-cliente";
import { hoyPY } from "@/lib/fecha/paraguay";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { Select } from "@/components/Select";
import MontoInput from "@/components/ui/MontoInput";
import {
  esOperacionPlaceholder, fechaCorta, generarReferencia, gs, planDe,
  type Banco, type CuotaDetalle, type DetalleCobranza,
} from "@/modules/cobranzas/tipos";

const INPUT = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";
const LABEL = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500";
const MAX_BYTES = 8 * 1024 * 1024;
const TIPOS = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

type Cuota = CuotaDetalle & { plan: string };
type Resultado = { cobros: { id: string; numero: string; repetido: boolean }[]; numero_operacion: string; referencia_generada: boolean };
type FilaBusqueda = { id: string; numero: string; saldo: number; vencimiento: string; cliente_id: string; cliente_nombre: string };

export type CuotaFija = { cxc_id: string; numero: string; vencimiento: string; saldo: number; en_aprobacion: number; cliente_label: string };

const disponible = (c: { saldo: number; en_aprobacion: number }) => Math.max(0, Math.round(Number(c.saldo) - Number(c.en_aprobacion)));

export function RegistrarTransferencia({ fija, onClose, onHecho }: {
  fija?: CuotaFija;
  onClose: () => void;
  onHecho: (mensaje: string) => void;
}) {
  const hoy = hoyPY();
  const [bancos, setBancos] = useState<Banco[]>([]);
  // Conciliación: factura buscada → cuotas abiertas de ese cliente.
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<FilaBusqueda[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [cliente, setCliente] = useState<{ id: string; nombre: string } | null>(null);
  const [cuotas, setCuotas] = useState<Cuota[]>([]);
  const [cargandoCuotas, setCargandoCuotas] = useState(false);
  const [elegidas, setElegidas] = useState<Record<string, number>>(fija ? { [fija.cxc_id]: disponible(fija) } : {});

  const [fecha, setFecha] = useState(hoy);
  const [bancoId, setBancoId] = useState("");
  const [titular, setTitular] = useState("");
  const [operacion, setOperacion] = useState("");
  const [opAuto, setOpAuto] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Una clave por factura, fija mientras el modal esté abierto: reintentar no duplica.
  const claves = useRef<Record<string, string>>({});
  const claveDe = (cxc: string) => (claves.current[cxc] ??= crypto.randomUUID());

  useEffect(() => {
    apiFetchCache<{ bancos: Banco[] }>("/api/cobranzas/bancos").then((r) => setBancos(r.bancos)).catch(() => setBancos([]));
  }, []);

  // Búsqueda de facturas con saldo (solo en Conciliación).
  useEffect(() => {
    if (fija || cliente) return;
    let vivo = true;
    setBuscando(true);
    const t = setTimeout(() => {
      const sp = new URLSearchParams({ por_pagina: "20" });
      if (busqueda.trim()) sp.set("q", busqueda.trim());
      apiFetch<{ rows: FilaBusqueda[] }>(`/api/cuentas-cobrar?${sp}`)
        .then((r) => { if (vivo) setResultados(r.rows); })
        .catch(() => { if (vivo) setResultados([]); })
        .finally(() => { if (vivo) setBuscando(false); });
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [busqueda, fija, cliente]);

  async function elegirFactura(f: FilaBusqueda) {
    setCliente({ id: f.cliente_id, nombre: f.cliente_nombre });
    setCargandoCuotas(true);
    setError(null);
    try {
      const d = await apiFetch<DetalleCobranza>(`/api/cobranzas/clientes/${f.cliente_id}`);
      const todas = d.servicios.flatMap((s) => s.cuotas.map((c) => ({ ...c, plan: planDe(s) })))
        .sort((a, b) => a.vencimiento.localeCompare(b.vencimiento) || a.numero.localeCompare(b.numero));
      setCuotas(todas);
      const esa = todas.find((c) => c.id === f.id);
      setElegidas(esa && disponible(esa) > 0 ? { [esa.id]: disponible(esa) } : {});
      if (esa && disponible(esa) <= 0) setError(`${esa.numero} ya tiene todo su saldo esperando aprobación.`);
    } catch (e) {
      setError((e as Error).message);
      setCuotas([]);
    } finally {
      setCargandoCuotas(false);
    }
  }

  const banco = bancos.find((b) => b.id === bancoId) ?? null;
  function cambiarBanco(id: string) {
    setBancoId(id);
    const b = bancos.find((x) => x.id === id);
    if (b?.sin_referencia) {
      if (esOperacionPlaceholder(operacion) || opAuto) { setOperacion(generarReferencia(b.prefijo)); setOpAuto(true); }
    } else if (opAuto) {
      setOperacion("");
      setOpAuto(false);
    }
  }

  const lineas = useMemo(() => {
    if (fija) return [{ id: fija.cxc_id, numero: fija.numero, vencimiento: fija.vencimiento, max: disponible(fija), monto: elegidas[fija.cxc_id] ?? 0 }];
    return cuotas.filter((c) => c.id in elegidas).map((c) => ({ id: c.id, numero: c.numero, vencimiento: c.vencimiento, max: disponible(c), monto: elegidas[c.id] ?? 0 }));
  }, [fija, cuotas, elegidas]);
  const total = lineas.reduce((a, l) => a + (Number(l.monto) || 0), 0);
  const montoMal = lineas.find((l) => !(l.monto > 0) || l.monto > l.max);

  function alternar(c: Cuota) {
    setElegidas((m) => {
      const n = { ...m };
      if (c.id in n) delete n[c.id];
      else n[c.id] = disponible(c);
      return n;
    });
  }

  function elegirArchivo(f: File | null) {
    setError(null);
    if (!f) { setArchivo(null); return; }
    if (!TIPOS.includes(f.type)) { setError("El comprobante tiene que ser JPG, PNG, WebP o PDF."); return; }
    if (f.size > MAX_BYTES) { setError("El comprobante supera los 8 MB."); return; }
    setArchivo(f);
  }

  const faltan: string[] = [];
  if (!lineas.length) faltan.push("la factura");
  if (!banco) faltan.push("el banco");
  if (!titular.trim()) faltan.push("el titular");
  if (!operacion.trim() && !banco?.sin_referencia) faltan.push("el N° de operación");
  if (fija && !archivo) faltan.push("el comprobante");
  const invalido = faltan.length > 0 || !!montoMal || !fecha || fecha > hoy;

  async function guardar() {
    if (invalido || !banco) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("items", JSON.stringify(lineas.map((l) => ({ cxc_id: l.id, monto: Math.round(l.monto), idempotency_key: claveDe(l.id) }))));
      fd.set("fecha", fecha);
      fd.set("banco_id", banco.id);
      fd.set("banco_origen", banco.nombre);
      fd.set("titular", titular.trim());
      fd.set("numero_operacion", operacion.trim());
      if (fija) fd.set("requiere_comprobante", "1");
      if (archivo) fd.set("file", archivo, archivo.name);
      const r = await apiForm<Resultado>("/api/cobranzas/conciliacion", fd);
      const base = fija ? "Cobro enviado a aprobación en Conciliación bancaria." : `Transferencia registrada${r.cobros.length > 1 ? ` (${r.cobros.length} facturas)` : ""}. Queda pendiente de aprobación.`;
      onHecho(r.referencia_generada ? `${base} Referencia: ${r.numero_operacion}` : base);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const opcionesBanco: [string, string][] = [["", "— Seleccioná el banco —"], ...bancos.map((b): [string, string] => [b.id, b.nombre])];

  return (
    <CapaModal onClose={busy ? undefined : onClose} z="z-[120]">
      <div onClick={(e) => e.stopPropagation()} className={`flex w-full max-w-lg ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl`} style={{ animation: "rb-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900">{fija ? "Registrar cobro" : "Registrar transferencia"}</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Cobro por transferencia. Queda <b>pendiente de aprobación</b> en Conciliación bancaria.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Cerrar" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-50">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

          {fija ? (
            <>
              <p className="text-xs text-slate-500">{fija.cliente_label} · {fija.numero} · vence {fechaCorta(fija.vencimiento)}</p>
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-600">
                Saldo pendiente: <b className="text-slate-900">{gs(fija.saldo)}</b>
                {Number(fija.en_aprobacion) > 0 ? <span className="text-amber-700"> · {gs(fija.en_aprobacion)} ya esperando aprobación</span> : null}
              </div>
              <label className="block">
                <span className={LABEL}>Monto a cobrar</span>
                <MontoInput value={elegidas[fija.cxc_id] ?? 0} decimals={false} onChange={(v) => setElegidas({ [fija.cxc_id]: v })} className={`${INPUT} text-right tabular-nums`} />
                {montoMal ? <span className="mt-1 block text-[11px] text-rose-600">Tiene que ser mayor a cero y no superar {gs(disponible(fija))}.</span> : null}
              </label>
            </>
          ) : !cliente ? (
            <div>
              <span className={LABEL}>Factura *</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input autoFocus value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar factura o cliente con saldo…" className={`${INPUT} pl-9`} />
              </div>
              <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-slate-200">
                {buscando && !resultados.length ? (
                  <p className="px-3 py-4 text-center text-xs text-slate-400">Buscando…</p>
                ) : resultados.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-slate-400">No hay facturas con saldo{busqueda.trim() ? " para esa búsqueda" : ""}.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {resultados.map((f) => (
                      <li key={f.id}>
                        <button type="button" onClick={() => void elegirFactura(f)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-[#4FAEB2]/[0.06]">
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-slate-800">{f.cliente_nombre}</span>
                            <span className="font-mono text-[11px] text-slate-500">{f.numero} · vence {fechaCorta(f.vencimiento)}</span>
                          </span>
                          <span className="shrink-0 font-semibold tabular-nums text-slate-800">{gs(f.saldo)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className={`${LABEL} mb-0`}>Facturas de {cliente.nombre}</span>
                <button type="button" onClick={() => { setCliente(null); setCuotas([]); setElegidas({}); }} className="text-[11px] font-semibold text-[#3F8E91] hover:underline">
                  Cambiar
                </button>
              </div>
              {cargandoCuotas ? (
                <p className="flex items-center gap-2 py-3 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando facturas…</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {cuotas.map((c) => {
                    const sel = c.id in elegidas;
                    const max = disponible(c);
                    return (
                      <li key={c.id} className={`flex items-center gap-2 px-3 py-2 text-xs ${sel ? "bg-[#4FAEB2]/[0.05]" : ""}`}>
                        <input type="checkbox" checked={sel} disabled={!sel && max <= 0} onChange={() => alternar(c)} className="h-4 w-4 shrink-0 cursor-pointer accent-[#4FAEB2]" aria-label={`Incluir ${c.numero}`} />
                        <span className="min-w-0 flex-1">
                          <span className={`block font-mono ${c.vencida ? "text-rose-600" : "text-slate-700"}`}>{c.numero} · vence {fechaCorta(c.vencimiento)}</span>
                          <span className="text-[10px] text-slate-400">
                            {c.plan} · saldo {gs(c.saldo)}{Number(c.en_aprobacion) > 0 ? ` · ${gs(c.en_aprobacion)} en aprobación` : ""}
                          </span>
                        </span>
                        {sel ? (
                          <MontoInput value={elegidas[c.id] ?? 0} decimals={false} onChange={(v) => setElegidas((m) => ({ ...m, [c.id]: v }))}
                            className={`w-28 rounded-lg border px-2 py-1 text-right text-xs tabular-nums outline-none focus:ring-2 focus:ring-[#4FAEB2]/20 ${(elegidas[c.id] ?? 0) > max || !((elegidas[c.id] ?? 0) > 0) ? "border-rose-300" : "border-slate-200"}`} />
                        ) : (
                          <span className="w-28 text-right tabular-nums text-slate-400">{gs(max)}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {lineas.length > 1 ? <p className="mt-1 text-[11px] text-[#3F8E91]">Una sola transferencia aplicada a {lineas.length} facturas: se registran juntas o ninguna.</p> : null}
              {montoMal ? <p className="mt-1 text-[11px] text-rose-600">El monto de {montoMal.numero} tiene que ser mayor a cero y no superar {gs(montoMal.max)}.</p> : null}
              {lineas.length ? <p className="mt-1 text-right text-xs text-slate-600">Total de la transferencia: <b className="tabular-nums text-slate-900">{gs(total)}</b></p> : null}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={LABEL}>Fecha de la transferencia</span>
              <input type="date" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} className={INPUT} />
            </label>
            <div>
              <span className={LABEL}>Banco de origen</span>
              <Select value={bancoId} onChange={cambiarBanco} options={opcionesBanco} block />
            </div>
          </div>
          <label className="block">
            <span className={LABEL}>Titular (quién envía)</span>
            <input value={titular} onChange={(e) => setTitular(e.target.value.toUpperCase())} placeholder="Titular de la cuenta que envía" className={`${INPUT} uppercase placeholder:normal-case`} />
          </label>
          <div>
            <span className={LABEL}>N° de comprobante / operación</span>
            <div className="flex gap-2">
              <input value={operacion} onChange={(e) => { setOperacion(e.target.value); setOpAuto(false); }} placeholder="Nº de operación de la transferencia" className={`${INPUT} font-mono`} />
              {banco?.sin_referencia ? (
                <button type="button" onClick={() => { setOperacion(generarReferencia(banco.prefijo)); setOpAuto(true); }} title="Generar una referencia nueva"
                  className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-[#4FAEB2]/40 bg-[#4FAEB2]/10 px-3 text-xs font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/20">
                  <RefreshCw className="h-3.5 w-3.5" /> Generar
                </button>
              ) : null}
            </div>
            {opAuto ? <p className="mt-1 text-[11px] text-[#3F8E91]">Referencia generada: {banco?.nombre} no emite comprobante. Podés editarla si tenés una.</p> : null}
          </div>
          <div>
            <span className={LABEL}>
              Comprobante <span className="normal-case text-slate-400">({fija ? "obligatorio" : "opcional"} — JPG, PNG, WebP o PDF, máx. 8 MB)</span>
            </span>
            {!archivo ? (
              <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-3 text-sm font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/5">
                <Paperclip className="h-4 w-4" /> Adjuntar imagen o PDF
              </button>
            ) : (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
                <span className="flex min-w-0 items-center gap-2 text-slate-700"><FileText className="h-4 w-4 shrink-0 text-slate-400" /><span className="truncate">{archivo.name}</span></span>
                <button type="button" onClick={() => { setArchivo(null); if (fileRef.current) fileRef.current.value = ""; }} className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">Quitar</button>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => elegirArchivo(e.target.files?.[0] ?? null)} />
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
          <p className="min-w-0 truncate text-[11px] text-slate-400">{faltan.length ? `Falta ${faltan.join(", ")}.` : ""}</p>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
            <button type="button" onClick={() => void guardar()} disabled={busy || invalido}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#3F8E91] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#357a7d] disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {busy ? "Enviando…" : fija ? "Enviar a aprobación" : "Registrar (queda pendiente)"}
            </button>
          </div>
        </div>
      </div>
    </CapaModal>
  );
}
