"use client";

/**
 * Cobrar la cuenta de una mesa (Caja › Pedidos de mesas). Paso 1: caja (la abierta de la
 * sucursal de la mesa), cliente (o "Cliente ocasional (X)", o sin cliente) y ticket / factura,
 * con la misma regla que la caja (receta 66/67: sin RUC no hay factura; el ocasional se factura
 * hasta el tope configurado). Paso 2: las formas de pago, con el CobroModal de la caja.
 * El total y las líneas los arma la base con lo que pidió la mesa.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Search, UserRound, X } from "lucide-react";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { Select } from "@/components/Select";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchCache } from "@/lib/api/cache-cliente";
import { browserClient } from "@/lib/supabase/browser";
import { CobroModal, type PagoEnviar } from "@/modules/caja/CobroModal";
import { etiquetaCaja, invalidarCajas, useEstadoCajas } from "@/modules/caja/turno";
import type { Cliente } from "@/modules/caja/lib";
import { AVISO_SIN_RUC, rucParaFactura } from "@/modules/empresa/tipos";
import { anchoTicket, type ConfigFacturacion } from "@/modules/facturacion/tipos";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT } from "@/modules/inventario/ui";
import { cant, gs, origenPedido, type CuentaMesa } from "@/modules/mesas/tipos";
import { clienteConfig } from "@/cliente.config";

/** Ticket imprimible en una pestaña nueva (con el Bearer), igual que la caja. */
async function imprimirTicket(ventaId: string, ancho: 58 | 80 = 80) {
  try {
    const { data } = await browserClient().auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch(`/api/ventas/${ventaId}/ticket?auto=1${ancho === 58 ? "&w=58" : ""}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const url = URL.createObjectURL(new Blob([await res.text()], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  } catch { /* best-effort: la venta ya quedó registrada */ }
}

export function CobrarCuenta({ cuenta, onClose, onCobrada }: {
  cuenta: CuentaMesa;
  onClose: () => void;
  onCobrada: (r: { numero: string; vuelto: number; mesa: string }) => void;
}) {
  const color = clienteConfig.color;
  const { datos: cajas } = useEstadoCajas();
  const abiertas = useMemo(() => (cajas?.abiertas ?? []).filter((c) => c.sucursal_id === cuenta.sucursal.id), [cajas, cuenta.sucursal.id]);
  const [cajaId, setCajaId] = useState<string>("");
  useEffect(() => {
    if (!abiertas.length) return;
    if (!abiertas.some((c) => c.id === cajaId)) setCajaId((abiertas.find((c) => c.mia) ?? abiertas[0]).id);
  }, [abiertas, cajaId]);

  const [cfg, setCfg] = useState<ConfigFacturacion | null>(null);
  useEffect(() => { apiFetchCache<ConfigFacturacion>("/api/configuracion/facturacion", { ttlMs: 60_000 }).then(setCfg).catch(() => {}); }, []);
  const nombreOcasional = cfg?.ocasional_nombre?.trim() || "X";
  const tope = cfg?.ocasional_tope ?? null;

  // Cliente
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [ocasional, setOcasional] = useState(false);
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [resultados, setResultados] = useState<Cliente[]>([]);
  const [buscando, setBuscando] = useState(false);
  const ultimo = useRef(0);
  useEffect(() => {
    const t = q.trim();
    if (!abierto) return;
    const n = ++ultimo.current;
    const id = setTimeout(() => {
      setBuscando(true);
      apiFetch<Cliente[]>(t ? `/api/clientes?q=${encodeURIComponent(t)}&limit=20` : "/api/clientes?limit=20")
        .then((r) => { if (n === ultimo.current) setResultados(r ?? []); })
        .catch(() => {})
        .finally(() => { if (n === ultimo.current) setBuscando(false); });
    }, t ? 250 : 0);
    return () => clearTimeout(id);
  }, [q, abierto]);

  const [doc, setDoc] = useState<"ticket" | "factura">("ticket");
  const superaTope = ocasional && tope != null && cuenta.total > tope;
  const puedeFacturar = ocasional ? !superaTope : !!rucParaFactura(cliente);
  useEffect(() => { if (!puedeFacturar && doc === "factura") setDoc("ticket"); }, [puedeFacturar, doc]);

  const [paso, setPaso] = useState<"datos" | "pago">("datos");
  const [cobrando, setCobrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const caja = abiertas.find((c) => c.id === cajaId) ?? null;

  async function cobrar(pagos: PagoEnviar[]) {
    if (cobrando || !caja) return;
    setCobrando(true);
    setError(null);
    try {
      const r = await apiFetch<{ venta_id: string; numero_control: string; vuelto?: number; mesa: string }>(`/api/mesas/cuentas/${cuenta.id}`, {
        method: "POST",
        body: JSON.stringify({
          accion: "cobrar",
          caja_id: caja.id,
          cliente_id: ocasional ? null : cliente?.id ?? null,
          cliente_ocasional: ocasional,
          tipo_documento: doc,
          pagos,
        }),
      });
      invalidarCajas();
      void imprimirTicket(r.venta_id, anchoTicket(cfg?.impresion_tipo_default));
      onCobrada({ numero: r.numero_control, vuelto: Number(r.vuelto) || 0, mesa: r.mesa });
    } catch (e) {
      setError((e as Error).message);
      setCobrando(false);
    }
  }

  if (paso === "pago") {
    return (
      <CobroModal total={cuenta.total} cantItems={cuenta.items.length} tipoVenta="CONTADO" plazoDias={0} cliente={ocasional ? null : cliente}
        cobrando={cobrando} error={error} onClose={() => { if (!cobrando) { setPaso("datos"); setError(null); } }} onConfirmar={(p) => void cobrar(p)} />
    );
  }

  return (
    <CapaModal onClose={onClose}>
      <div className={`flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${ALTO_MAX_MODAL}`}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Cobrar mesa</p>
            <h3 className="truncate text-base font-semibold text-slate-900">{origenPedido(cuenta)}</h3>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {cuenta.items.map((it) => (
              <li key={`${it.nombre}|${it.precio_unitario}`} className="flex items-baseline gap-3 px-3 py-2 text-sm">
                <span className="w-10 shrink-0 tabular-nums text-slate-500">{cant(it.cantidad)} ×</span>
                <span className="min-w-0 flex-1 text-slate-800">{it.nombre}</span>
                <span className="shrink-0 font-medium tabular-nums text-slate-900">{gs(it.total)}</span>
              </li>
            ))}
            <li className="flex items-baseline justify-between px-3 py-2.5">
              <span className="text-sm font-semibold text-slate-700">Total</span>
              <span className="text-lg font-bold tabular-nums text-slate-900">{gs(cuenta.total)}</span>
            </li>
          </ul>

          {/* Caja */}
          <div>
            <span className={ET}>Caja</span>
            {!cajas ? (
              <p className="text-sm text-slate-400">Buscando cajas abiertas…</p>
            ) : abiertas.length === 0 ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                No hay una caja abierta en {cuenta.sucursal.nombre}. <Link href="/caja/turnos" className="font-semibold underline">Abrí una caja</Link> para cobrar.
              </p>
            ) : abiertas.length === 1 ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{etiquetaCaja(abiertas[0])}</p>
            ) : (
              <Select block etiqueta="Caja" value={cajaId} onChange={setCajaId} options={abiertas.map((c) => [c.id, etiquetaCaja(c)] as [string, string])} />
            )}
          </div>

          {/* Cliente */}
          <div className="relative">
            <span className={ET}>Cliente <span className="font-normal text-slate-400">(opcional para ticket)</span></span>
            {cliente || ocasional ? (
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <UserRound className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                  {ocasional ? `Cliente ocasional (${nombreOcasional})` : cliente!.nombre}
                  {cliente && rucParaFactura(cliente) ? <span className="font-normal text-slate-400"> · {rucParaFactura(cliente)}</span> : null}
                </span>
                <button type="button" aria-label="Quitar cliente" onClick={() => { setCliente(null); setOcasional(false); }} className="rounded p-1 text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                  <input value={q} onChange={(e) => { setQ(e.target.value); setAbierto(true); }} onFocus={() => setAbierto(true)}
                    placeholder="Buscar por nombre, RUC o CI" className={`${INPUT} pl-9`} />
                </div>
                {abierto ? (
                  <div className="mt-1 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                    <button type="button" onClick={() => { setOcasional(true); setAbierto(false); }} className="block w-full border-b border-slate-100 px-3 py-2.5 text-left hover:bg-slate-50">
                      <span className="text-sm font-semibold text-slate-800">Cliente ocasional ({nombreOcasional})</span>
                      <span className="block text-[11px] text-slate-500">Consumidor final que no da sus datos: se puede facturar.</span>
                    </button>
                    {buscando && !resultados.length ? <p className="px-3 py-2 text-sm text-slate-400">Buscando…</p> : null}
                    {resultados.map((c) => (
                      <button key={c.id} type="button" onClick={() => { setCliente(c); setAbierto(false); setQ(""); }} className="block w-full px-3 py-2 text-left hover:bg-slate-50">
                        <span className="text-sm text-slate-800">{c.nombre}</span>
                        <span className="block text-[11px] text-slate-400">{rucParaFactura(c) ?? c.documento ?? "Sin RUC"}</span>
                      </button>
                    ))}
                    {!buscando && q.trim() && !resultados.length ? <p className="px-3 py-2 text-sm text-slate-400">Sin resultados</p> : null}
                  </div>
                ) : null}
              </>
            )}
          </div>

          {/* Documento */}
          <div>
            <span className={ET}>Documento</span>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1" role="radiogroup">
              {([["ticket", "Solo ticket"], ["factura", "Factura"]] as const).map(([v, l]) => {
                const dis = v === "factura" && !puedeFacturar;
                return (
                  <button key={v} type="button" role="radio" aria-checked={doc === v} disabled={dis} onClick={() => setDoc(v)}
                    title={dis ? (superaTope ? "La cuenta supera el tope para facturar a cliente ocasional" : cliente ? AVISO_SIN_RUC : "Para emitir factura elegí un cliente con RUC o Cliente ocasional (X)") : undefined}
                    className={`min-h-10 rounded-lg text-sm font-semibold transition disabled:opacity-40 ${doc === v ? "bg-white text-[var(--brand)] shadow-sm" : "text-slate-500"}`}>
                    {l}
                  </button>
                );
              })}
            </div>
            {!puedeFacturar ? (
              <p className="mt-1 text-[11px] text-slate-500">
                {superaTope ? "Supera el tope para facturar a cliente ocasional: solo ticket." : cliente ? AVISO_SIN_RUC : "Para emitir factura elegí un cliente con RUC o Cliente ocasional (X)."}
              </p>
            ) : null}
          </div>
          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p> : null}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3">
          <button type="button" onClick={onClose} className={`${BOTON_SECUNDARIO} flex-1`}>Cancelar</button>
          <button type="button" disabled={!caja || cuenta.pendientes > 0 || cuenta.total <= 0} onClick={() => { setError(null); setPaso("pago"); }}
            className={`${BOTON_PRIMARIO} flex-1`} style={{ backgroundColor: color }}>
            {cobrando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Cobrar {gs(cuenta.total)}
          </button>
        </div>
      </div>
    </CapaModal>
  );
}
