"use client";

/**
 * /pagos — Pagos (igual que el sistema actual): registrar pagos de facturas pendientes de cobro.
 *   · Pendientes: facturas (ventas con cuenta a cobrar) con saldo, por vencimiento. "Cobrar"
 *     registra una transferencia que queda pendiente de aprobación en Conciliación (con una
 *     transferencia se pueden cobrar varias facturas del mismo cliente). "En caja" abre el
 *     cobro en caja de siempre (efectivo, tarjeta…).
 *   · Cobrados: lo cobrado aplicado a cada factura (recibos; las transferencias aprobadas
 *     ya son recibos), con método, usuario, fecha y hora y el recibo en PDF.
 * Las tarjetas y el pie suman la vista completa (filtros incluidos), no solo la página.
 * "Tipo de servicio" del actual = categoría del cliente; además se filtra por plan.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Banknote, CheckCircle2, Clock, Inbox, Loader2, Receipt, Search, Wallet, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { TZ_PY } from "@/lib/fecha/paraguay";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { Select } from "@/components/Select";
import { RegistrarTransferencia } from "@/modules/cobranzas/RegistrarTransferencia";
import { ROLES_REGISTRAR } from "@/modules/cobranzas/tipos";
import { RegistrarCobro } from "@/modules/clientes/RegistrarCobro";
import { nombreMetodo } from "@/modules/clientes/cobros";

const POR_PAGINA = 50;
const INPUT = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20";
const LABEL = "mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500";
const gs = (n: number | null | undefined) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
const fecha = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
const fechaHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";

type Tab = "pendientes" | "cobrados";

type FilaPendiente = {
  id: string; venta_id: string; numero: string; cliente_id: string; cliente_nombre: string;
  categoria_id: string | null; categoria_nombre: string | null; vendedor: string | null; plan_nombre: string | null;
  fecha_emision: string; vencimiento: string; monto: number; cobrado: number; saldo: number; estado: string;
  dias_atraso: number; en_aprobacion: number;
};
type FilaCobrada = {
  id: string; cobro_id: string; numero_recibo: string; fecha: string; created_at: string; fecha_pago: string;
  cliente_id: string; cliente_nombre: string; usuario_nombre: string | null; factura_numero: string; monto: number;
  categoria_nombre: string | null; plan_nombre: string | null; vendedor: string | null; metodos: string | null; referencia: string | null;
};
type Respuesta = {
  pendientes: { rows: FilaPendiente[]; total: number; total_monto: number; total_saldo: number; total_general: number };
  cobrados: { rows: FilaCobrada[]; total: number; total_monto: number; total_general: number };
  opciones?: { categorias: { id: string; nombre: string }[]; planes: { id: string; nombre: string }[] };
};

export default function PagosPage() {
  const rol = useUsuario()?.rol;
  const puedeCobrar = !!rol && ROLES_REGISTRAR.includes(rol);
  const [tab, setTab] = useState<Tab>("pendientes");
  const [borrador, setBorrador] = useState("");
  const [q, setQ] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [categoria, setCategoria] = useState("");
  const [plan, setPlan] = useState("");
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [opciones, setOpciones] = useState<Respuesta["opciones"] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [transferencia, setTransferencia] = useState<FilaPendiente | null>(null);
  const [enCaja, setEnCaja] = useState<FilaPendiente | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(borrador.trim()), 300);
    return () => clearTimeout(t);
  }, [borrador]);
  useEffect(() => { setPagina(1); }, [tab, q, desde, hasta, categoria, plan]);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 10000);
    return () => clearTimeout(t);
  }, [aviso]);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    const sp = new URLSearchParams({ tab, pagina: String(pagina), por_pagina: String(POR_PAGINA) });
    if (q) sp.set("q", q);
    if (desde) sp.set("desde", desde);
    if (hasta) sp.set("hasta", hasta);
    if (categoria) sp.set("categoria", categoria);
    if (plan) sp.set("plan", plan);
    if (!opciones) sp.set("opciones", "1");
    apiFetch<Respuesta>(`/api/pagos?${sp}`)
      .then((r) => {
        if (!vivo) return;
        setDatos(r);
        if (r.opciones) setOpciones(r.opciones);
        setError(null);
      })
      .catch((e) => { if (vivo) setError((e as Error).message); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
    // `opciones` se pide una sola vez: no es dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, q, desde, hasta, categoria, plan, pagina, recarga]);

  const refrescar = useCallback(() => setRecarga((k) => k + 1), []);
  const hayFiltros = !!(q || desde || hasta || categoria || plan);
  const limpiar = () => { setBorrador(""); setQ(""); setDesde(""); setHasta(""); setCategoria(""); setPlan(""); };

  const pend = datos?.pendientes;
  const cob = datos?.cobrados;
  const filasTotal = tab === "pendientes" ? pend?.total ?? 0 : cob?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(filasTotal / POR_PAGINA));

  return (
    <div className="w-full min-w-0 max-w-full space-y-6 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Cobranzas</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Pagos</h1>
          <p className="mt-1 text-sm text-slate-500">Registrar pagos de facturas pendientes de cobro</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1 rounded-2xl border border-[#4FAEB2]/45 bg-white p-1.5 shadow-sm">
          <BotonTab activo={tab === "pendientes"} onClick={() => setTab("pendientes")} icono={<Clock className="h-4 w-4" />} label="Pendientes" n={pend?.total} />
          <BotonTab activo={tab === "cobrados"} onClick={() => setTab("cobrados")} icono={<CheckCircle2 className="h-4 w-4" />} label="Cobrados" n={cob?.total} />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi icono={<Receipt className="h-4 w-4" />} label="Facturas con saldo" valor={String(pend?.total ?? 0)}
          sub={pend && (hayFiltros || pend.total !== pend.total_general) ? `de ${pend.total_general} en total` : "vista actual"} />
        <Kpi icono={<Clock className="h-4 w-4" />} label="Saldo pendiente" valor={gs(pend?.total_saldo)} sub={`Total: ${gs(pend?.total_monto)}`} acento="aviso" />
        <Kpi icono={<CheckCircle2 className="h-4 w-4" />} label="Cobrado (filtros)" valor={gs(cob?.total_monto)}
          sub={`${cob?.total ?? 0} ${cob?.total === 1 ? "pago" : "pagos"}`} acento="destacado" />
      </div>

      <div className="rounded-2xl border border-[#4FAEB2]/45 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1">
            <label className={LABEL}>Buscar por nombre de cliente</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type="search" value={borrador} onChange={(e) => setBorrador(e.target.value)} placeholder="Nombre del cliente o número de factura…" className={`${INPUT} pl-9`} />
            </div>
          </div>
          <div className="min-w-[10rem]">
            <label className={LABEL}>Desde {tab === "pendientes" ? "(vencimiento)" : "(fecha de pago)"}</label>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={INPUT} />
          </div>
          <div className="min-w-[10rem]">
            <label className={LABEL}>Hasta {tab === "pendientes" ? "(vencimiento)" : "(fecha de pago)"}</label>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={INPUT} />
          </div>
          <div className="min-w-[12rem]">
            <label className={LABEL}>Tipo de servicio (categoría)</label>
            <Select value={categoria} onChange={setCategoria} block
              options={[["", "Todas las categorías"], ["__sin__", "Sin clasificar"], ...(opciones?.categorias ?? []).map((c): [string, string] => [c.id, c.nombre])]} />
          </div>
          <div className="min-w-[12rem]">
            <label className={LABEL}>Plan</label>
            <Select value={plan} onChange={setPlan} block
              options={[["", "Todos los planes"], ["__sin__", "Sin plan"], ...(opciones?.planes ?? []).map((p): [string, string] => [p.id, p.nombre])]} />
          </div>
          {hayFiltros ? (
            <button type="button" onClick={limpiar}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:bg-[#4FAEB2]/5 hover:text-[#3F8E91]">
              Limpiar filtros
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <section className="overflow-hidden rounded-2xl border border-[#4FAEB2]/45 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <span aria-hidden className="block h-5 w-1 rounded-full bg-[#4FAEB2]" />
            <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
              <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]" />
              {tab === "pendientes" ? "Facturas pendientes de cobro" : "Pagos registrados"}
            </h2>
            {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" /> : null}
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-[#4FAEB2]/30 bg-[#4FAEB2]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#3F8E91]">
            {tab === "pendientes"
              ? hayFiltros ? `${pend?.total ?? 0} según filtros · ${pend?.total_general ?? 0} en total` : `${pend?.total ?? 0} facturas con saldo`
              : hayFiltros ? `${cob?.total ?? 0} según filtros · ${cob?.total_general ?? 0} en total` : `${cob?.total ?? 0} pagos`}
          </span>
        </div>

        {tab === "pendientes" ? (
          <TablaPendientes filas={pend?.rows ?? []} cargando={cargando && !datos} hayFiltros={hayFiltros} onLimpiar={limpiar}
            totalMonto={pend?.total_monto ?? 0} totalSaldo={pend?.total_saldo ?? 0} total={pend?.total ?? 0}
            puedeCobrar={puedeCobrar} onTransferencia={setTransferencia} onCaja={setEnCaja} />
        ) : (
          <TablaCobrados filas={cob?.rows ?? []} cargando={cargando && !datos} hayFiltros={hayFiltros} onLimpiar={limpiar}
            totalMonto={cob?.total_monto ?? 0} total={cob?.total ?? 0} />
        )}

        {filasTotal > POR_PAGINA ? (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            <span>Página {pagina} de {totalPaginas}</span>
            <div className="flex gap-2">
              <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Anterior</button>
              <button disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Siguiente</button>
            </div>
          </div>
        ) : null}
      </section>

      {transferencia ? (
        <RegistrarTransferencia
          clienteInicial={{ id: transferencia.cliente_id, nombre: transferencia.cliente_nombre, cxcId: transferencia.id }}
          onClose={() => setTransferencia(null)}
          onHecho={(m) => { setTransferencia(null); setAviso(m); refrescar(); }} />
      ) : null}
      {enCaja ? (
        <RegistrarCobro clienteId={enCaja.cliente_id} clienteNombre={enCaja.cliente_nombre} cxcInicial={enCaja.id}
          onClose={() => setEnCaja(null)} onHecho={refrescar} />
      ) : null}
      {aviso ? (
        <div role="status" className="fixed bottom-5 right-5 z-[130] flex max-w-sm items-start gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm text-slate-800 shadow-lg"
          style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
          <p className="min-w-0 flex-1">{aviso}</p>
          <button type="button" onClick={() => setAviso(null)} aria-label="Cerrar aviso" className="shrink-0 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>
      ) : null}
    </div>
  );
}

const TH = "px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500 first:pl-5 last:pr-5 sm:px-4";
const TD = "px-3 py-3 text-sm text-slate-600 first:pl-5 last:pr-5 sm:px-4";

function TablaPendientes({ filas, cargando, hayFiltros, onLimpiar, totalMonto, totalSaldo, total, puedeCobrar, onTransferencia, onCaja }: {
  filas: FilaPendiente[]; cargando: boolean; hayFiltros: boolean; onLimpiar: () => void;
  totalMonto: number; totalSaldo: number; total: number; puedeCobrar: boolean;
  onTransferencia: (f: FilaPendiente) => void; onCaja: (f: FilaPendiente) => void;
}) {
  if (cargando) return <Cargando texto="Cargando facturas…" />;
  if (filas.length === 0) {
    return hayFiltros ? (
      <Vacio titulo="Ninguna factura con saldo coincide con los filtros"
        cta={<button type="button" onClick={onLimpiar} className="text-xs font-semibold text-[#4FAEB2] hover:text-[#3F8E91] hover:underline">Limpiar filtros</button>} />
    ) : (
      <Vacio titulo="No hay facturas pendientes de cobro"
        cta={<Link href="/clientes" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#4FAEB2] hover:text-[#3F8E91] hover:underline">Ir a Clientes →</Link>} />
    );
  }
  return (
    <div className="overflow-x-auto overscroll-x-contain">
      <table className="w-full min-w-[1040px] table-auto border-separate border-spacing-0 text-sm">
        <thead className="bg-slate-50/80">
          <tr>{["Número", "Cliente", "Tipo de cliente", "Vendedor", "Fecha", "Vencimiento", "Total", "Saldo", "Estado", "Acción"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            const vencida = f.dias_atraso > 0;
            const est = vencida
              ? { t: "Vencida", c: "border-rose-200 bg-rose-50 text-rose-700", p: "bg-rose-500" }
              : f.estado === "parcial"
                ? { t: "Pagada en parte", c: "border-amber-200 bg-amber-50 text-amber-700", p: "bg-amber-500" }
                : { t: "Pendiente", c: "border-amber-200 bg-amber-50 text-amber-700", p: "bg-amber-500" };
            const libre = Math.max(0, Number(f.saldo) - Number(f.en_aprobacion));
            return (
              <tr key={f.id} className="border-t border-slate-100 transition-colors hover:bg-[#4FAEB2]/5 [&>td]:border-t [&>td]:border-slate-100">
                <td className={`${TD} whitespace-nowrap`}>
                  <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">{f.numero}</span>
                </td>
                <td className={`${TD} min-w-[12rem] lg:min-w-[16rem]`}>
                  <Link href={`/clientes/${f.cliente_id}`} className="block min-w-0 break-words font-medium text-[#3F8E91] hover:underline" title={f.cliente_nombre}>{f.cliente_nombre}</Link>
                  {f.plan_nombre ? <span className="block text-[11px] text-slate-400">{f.plan_nombre}</span> : null}
                </td>
                <td className={TD}><span className="inline-block max-w-[14rem] truncate">{f.categoria_nombre ?? "Sin clasificar"}</span></td>
                <td className={TD}><span className="inline-block max-w-[12rem] truncate">{f.vendedor ?? "—"}</span></td>
                <td className={`${TD} whitespace-nowrap`}>{fecha(f.fecha_emision)}</td>
                <td className={`${TD} whitespace-nowrap`}>
                  {fecha(f.vencimiento)}
                  {vencida ? <span className="block text-[11px] font-semibold text-rose-600">{f.dias_atraso} {f.dias_atraso === 1 ? "día" : "días"} de atraso</span> : null}
                </td>
                <td className={`${TD} whitespace-nowrap font-semibold tabular-nums text-slate-900`}>{gs(f.monto)}</td>
                <td className={`${TD} whitespace-nowrap font-semibold tabular-nums text-amber-600`}>{gs(f.saldo)}</td>
                <td className={`${TD} whitespace-nowrap`}>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${est.c}`}>
                    <span aria-hidden className={`h-1 w-1 rounded-full ${est.p}`} />{est.t}
                  </span>
                  {Number(f.en_aprobacion) > 0 ? <span className="mt-0.5 block text-[10px] font-medium text-sky-700">{gs(f.en_aprobacion)} en aprobación</span> : null}
                </td>
                <td className={`${TD} whitespace-nowrap`}>
                  {puedeCobrar ? (
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={() => onTransferencia(f)} disabled={libre <= 0}
                        title={libre <= 0 ? "Todo el saldo ya está esperando aprobación en Conciliación" : "Registrar el pago por transferencia (va a Conciliación)"}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#4FAEB2] px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91] disabled:opacity-40">
                        <Banknote className="h-3.5 w-3.5" /> Cobrar
                      </button>
                      <button type="button" onClick={() => onCaja(f)} title="Cobrar en caja (efectivo, tarjeta, POS…)"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-semibold text-slate-600 transition-colors hover:border-[#4FAEB2]/60 hover:text-[#3F8E91]">
                        <Wallet className="h-3.5 w-3.5" /> En caja
                      </button>
                    </div>
                  ) : <span className="text-xs text-slate-400">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-slate-50/80" role="status">
            <td colSpan={6} className="border-t-2 border-slate-100 px-3 py-4 pl-5 sm:px-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-700">{hayFiltros ? "Suma con filtros activos" : "Suma de la vista"}</p>
              <p className="mt-0.5 text-[10px] text-slate-500">{total} {total === 1 ? "registro" : "registros"} · recalcula al cambiar fecha, tipo o tabla</p>
            </td>
            <td className="whitespace-nowrap border-t-2 border-slate-100 px-3 py-4 sm:px-4">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Total</span>
              <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-900">{gs(totalMonto)}</p>
            </td>
            <td className="whitespace-nowrap border-t-2 border-slate-100 px-3 py-4 sm:px-4">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-amber-600">Saldo</span>
              <p className="mt-0.5 text-sm font-bold tabular-nums text-amber-600">{gs(totalSaldo)}</p>
            </td>
            <td colSpan={2} className="border-t-2 border-slate-100 px-3 py-4 pr-5 sm:px-4" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function TablaCobrados({ filas, cargando, hayFiltros, onLimpiar, totalMonto, total }: {
  filas: FilaCobrada[]; cargando: boolean; hayFiltros: boolean; onLimpiar: () => void; totalMonto: number; total: number;
}) {
  const [bajando, setBajando] = useState<string | null>(null);
  if (cargando) return <Cargando texto="Cargando pagos…" />;
  if (filas.length === 0) {
    return hayFiltros ? (
      <Vacio titulo="Ningún pago coincide con los filtros"
        cta={<button type="button" onClick={onLimpiar} className="text-xs font-semibold text-[#4FAEB2] hover:text-[#3F8E91] hover:underline">Limpiar filtros</button>} />
    ) : (
      <Vacio titulo="No hay pagos registrados" subtitulo="Los pagos aparecen acá cuando se cobran en caja o se aprueban en Conciliación." />
    );
  }
  async function recibo(f: FilaCobrada) {
    setBajando(f.id);
    try { await descargarArchivo(`/api/cobros/${f.cobro_id}/pdf`, `recibo-${f.numero_recibo}.pdf`); } catch { /* best-effort */ } finally { setBajando(null); }
  }
  return (
    <div className="overflow-x-auto overscroll-x-contain">
      <table className="w-full min-w-[1100px] table-auto border-separate border-spacing-0 text-sm">
        <thead className="bg-slate-50/80">
          <tr>{["Factura", "Cliente", "Tipo de servicio", "Vendedor", "Monto pagado", "Fecha", "Método", "Usuario", "Fecha y hora", "Recibo"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id} className="transition-colors hover:bg-[#4FAEB2]/5 [&>td]:border-t [&>td]:border-slate-100">
              <td className={`${TD} whitespace-nowrap`}>
                <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">{f.factura_numero}</span>
              </td>
              <td className={`${TD} min-w-[12rem] lg:min-w-[16rem]`}>
                <Link href={`/clientes/${f.cliente_id}`} className="block min-w-0 break-words font-medium text-slate-900 hover:text-[#3F8E91] hover:underline" title={f.cliente_nombre}>{f.cliente_nombre}</Link>
              </td>
              <td className={TD}><span className="inline-block max-w-[16rem] truncate">{f.plan_nombre ?? f.categoria_nombre ?? "Sin clasificar"}</span></td>
              <td className={TD}><span className="inline-block max-w-[12rem] truncate">{f.vendedor ?? "—"}</span></td>
              <td className={`${TD} whitespace-nowrap font-semibold tabular-nums text-[#3F8E91]`}>{gs(f.monto)}</td>
              <td className={`${TD} whitespace-nowrap`}>{fecha(f.fecha_pago)}</td>
              <td className={TD}>
                <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-700">
                  <Wallet className="h-3 w-3 text-slate-400" />
                  {(f.metodos ?? "").split(",").filter(Boolean).map(nombreMetodo).join(" + ") || "—"}
                </span>
                {f.referencia ? <span className="mt-0.5 block max-w-[14rem] truncate text-[10px] text-slate-400" title={f.referencia}>{f.referencia}</span> : null}
              </td>
              <td className={`${TD} break-words [overflow-wrap:anywhere]`}>{f.usuario_nombre ?? "—"}</td>
              <td className={`${TD} min-w-[6rem] text-slate-500`}>{fechaHora(f.created_at)}</td>
              <td className={`${TD} whitespace-nowrap`}>
                <button type="button" onClick={() => recibo(f)} title={`Descargar el recibo ${f.numero_recibo}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#4FAEB2]/30 bg-[#4FAEB2]/10 px-2.5 py-1 text-[11px] font-semibold text-[#3F8E91] transition-colors hover:bg-[#4FAEB2]/20">
                  {bajando === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />} {f.numero_recibo}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={10} className="p-0">
              <div role="status" className="flex w-full min-w-0 flex-col items-stretch gap-2 border-t-2 border-slate-100 bg-slate-50/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-700">{hayFiltros ? "Total cobrado (filtros activos)" : "Total cobrado en esta vista"}</p>
                <p className="min-w-0 flex-1 whitespace-nowrap text-center text-base font-bold tabular-nums text-[#3F8E91] sm:text-lg">{gs(totalMonto)}</p>
                <p className="shrink-0 text-[10px] text-slate-500 sm:text-right">{total} {total === 1 ? "registro" : "registros"} · recalcula al cambiar el filtro</p>
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function BotonTab({ activo, onClick, icono, label, n }: { activo: boolean; onClick: () => void; icono: React.ReactNode; label: string; n?: number }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all ${activo ? "bg-[#4FAEB2] text-white shadow-md shadow-[#4FAEB2]/30" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"}`}>
      <span className={activo ? "text-white" : "text-slate-400"}>{icono}</span>
      {label}
      {typeof n === "number" ? (
        <span className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${activo ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"}`}>{n}</span>
      ) : null}
    </button>
  );
}

function Kpi({ icono, label, valor, sub, acento = "neutro" }: { icono: React.ReactNode; label: string; valor: string; sub?: string; acento?: "neutro" | "destacado" | "aviso" }) {
  const chip = acento === "destacado" ? "border-[#4FAEB2]/30 bg-[#4FAEB2]/10 text-[#4FAEB2]" : acento === "aviso" ? "border-amber-200 bg-amber-50 text-amber-600" : "border-slate-200 bg-slate-50 text-slate-500";
  const tarjeta = acento === "destacado"
    ? "relative overflow-hidden rounded-xl border border-[#4FAEB2]/55 bg-gradient-to-br from-white via-white to-[#4FAEB2]/[0.08] px-3.5 py-3 shadow-[0_4px_18px_rgba(79,174,178,0.08)]"
    : "relative overflow-hidden rounded-xl border border-[#4FAEB2]/45 bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";
  return (
    <div className={tarjeta}>
      {acento === "destacado" ? <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-[#4FAEB2] via-[#4FAEB2]/70 to-[#4FAEB2]/30" /> : null}
      <div className="flex items-start gap-2.5">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${chip}`}>{icono}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
          <p className={`mt-0.5 truncate text-lg font-semibold leading-tight tracking-tight tabular-nums ${acento === "destacado" ? "text-[#3F8E91]" : acento === "aviso" ? "text-amber-600" : "text-slate-900"}`}>{valor}</p>
          {sub ? <p className="mt-0.5 truncate text-[10px] text-slate-500">{sub}</p> : null}
        </div>
      </div>
    </div>
  );
}

function Cargando({ texto }: { texto: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-slate-500">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#4FAEB2]" /> {texto}
    </div>
  );
}

function Vacio({ titulo, subtitulo, cta }: { titulo: string; subtitulo?: string; cta?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#4FAEB2]/25 bg-[#4FAEB2]/[0.08] text-[#4FAEB2]"><Inbox className="h-6 w-6" /></span>
      <p className="text-sm font-medium text-slate-700">{titulo}</p>
      {subtitulo ? <p className="text-xs text-slate-500">{subtitulo}</p> : null}
      {cta ? <div className="mt-1">{cta}</div> : null}
    </div>
  );
}
