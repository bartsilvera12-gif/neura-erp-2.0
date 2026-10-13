"use client";

/**
 * /compras/pagos — Pagos a proveedores (cuentas a pagar). Espejo de Cuentas a cobrar:
 * arriba lo que se debe, lo que vence esta semana, lo vencido por tramos y lo pagado en
 * el mes (Gs. o USD); los tramos filtran. Lista por vencimiento (lo más urgente primero)
 * con "Pagar" por factura y "Registrar pago" por proveedor. Pestaña "Pagos realizados"
 * con las órdenes de pago (ver, PDF, anular).
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Ban, Banknote, CalendarClock, Download, Eye, Loader2, Printer, Search, Wallet } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { TZ_PY } from "@/lib/fecha/paraguay";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { cargarProveedores } from "@/modules/proveedores/cache";
import { nombreProveedor, type ProveedorMin } from "@/modules/proveedores/tipos";
import {
  ESTADO_CXP, dinero, hrefOrigenCxp, nombreMetodoPago, textoVencimiento,
  type AntiguedadPagar, type CuentaPagar, type ListaCuentasPagar, type Moneda, type PagoProveedor,
} from "@/modules/compras/pagos";
import { RegistrarPagoProveedor, imprimirOrdenPago, useAvisoPago } from "@/modules/compras/RegistrarPagoProveedor";
import { AnularPago, DetallePago } from "@/modules/compras/DetallePago";

const TEAL = clienteConfig.color;
const POR_PAGINA = 50;
const dia = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("es-PY", { day: "2-digit", month: "short", year: "numeric" });
const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const BUSCADOR = "w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";

type Pagando = { id: string; nombre: string; cxp?: string | null };

export default function PagosProveedoresPage() {
  const esAdmin = useUsuario()?.rol === "ADMIN";
  const [tab, setTab] = useState<"cuentas" | "pagos">("cuentas");
  const [moneda, setMoneda] = useState<Moneda>("GS");
  const [proveedor, setProveedor] = useState("");
  const [proveedores, setProveedores] = useState<ProveedorMin[]>([]);
  const [ant, setAnt] = useState<AntiguedadPagar | null>(null);
  const [pagando, setPagando] = useState<Pagando | null>(null);
  const [filtro, setFiltro] = useState("");
  const [recarga, setRecarga] = useState(0);
  const { nodo: aviso, avisar } = useAvisoPago();

  useEffect(() => { void cargarProveedores().then(setProveedores); }, []);
  const refrescar = useCallback(() => setRecarga((k) => k + 1), []);
  const din = (v: number) => dinero(v, moneda);
  const provSel = proveedores.find((p) => p.id === proveedor);

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Finanzas · Compras</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Pagos a proveedores</h1>
          <p className="mt-1 text-sm text-slate-500">Lo que les debés a tus proveedores por compras y gastos a crédito, empezando por lo más urgente.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl bg-slate-100 p-1">
            {(["GS", "USD"] as const).map((m) => (
              <button key={m} onClick={() => setMoneda(m)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${moneda === m ? "bg-white shadow-sm" : "text-slate-500"}`}
                style={moneda === m ? { color: TEAL } : undefined}>{m === "GS" ? "Guaraníes" : "Dólares"}</button>
            ))}
          </div>
          {provSel && esAdmin ? (
            <button onClick={() => setPagando({ id: provSel.id, nombre: nombreProveedor(provSel) })}
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95" style={{ backgroundColor: TEAL }}>
              <Banknote className="h-4 w-4" /> Registrar pago a {nombreProveedor(provSel)}
            </button>
          ) : null}
        </div>
      </header>

      <Kpis ant={ant} din={din} filtro={tab === "cuentas" ? filtro : ""} onFiltro={(f) => { setFiltro(f); setTab("cuentas"); }} />

      <div className="flex gap-1 border-b border-slate-200">
        {([["cuentas", "Cuentas a pagar"], ["pagos", "Pagos realizados"]] as const).map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition ${tab === v ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === "cuentas" ? (
        <TablaCuentas moneda={moneda} filtro={filtro} setFiltro={setFiltro} proveedor={proveedor} setProveedor={setProveedor} proveedores={proveedores} recarga={recarga}
          onAntiguedad={setAnt} esAdmin={esAdmin} onPagar={setPagando} />
      ) : (
        <>
          <AntiguedadSilenciosa moneda={moneda} recarga={recarga} onAntiguedad={setAnt} />
          <TablaPagos moneda={moneda} proveedor={proveedor} setProveedor={setProveedor} proveedores={proveedores} recarga={recarga} esAdmin={esAdmin} onCambio={refrescar} />
        </>
      )}

      {pagando ? (
        <RegistrarPagoProveedor proveedorId={pagando.id} proveedorNombre={pagando.nombre} moneda={moneda} cxpInicial={pagando.cxp ?? null}
          onClose={() => setPagando(null)} onHecho={(p) => { avisar(p); refrescar(); }} />
      ) : null}
      {aviso}
    </div>
  );
}

function Kpis({ ant, din, filtro, onFiltro }: { ant: AntiguedadPagar | null; din: (v: number) => string; filtro: string; onFiltro: (f: string) => void }) {
  const tile = (clave: string) =>
    `rounded-2xl border bg-white px-3 py-3 text-left shadow-sm transition hover:border-slate-300 ${filtro === clave ? "border-[var(--brand)] ring-2 ring-[var(--brand-100)]" : "border-slate-200"}`;
  const tocar = (clave: string) => onFiltro(filtro === clave ? "" : clave);
  const vencido = ant ? Number(ant.d1_30) + Number(ant.d31_60) + Number(ant.d61_90) + Number(ant.d90) : 0;
  const tramos: { l: string; v: number; tono: string }[] = [
    { l: "Vencido 1 a 30 días", v: Number(ant?.d1_30 ?? 0), tono: "text-amber-600" },
    { l: "31 a 60 días", v: Number(ant?.d31_60 ?? 0), tono: "text-orange-600" },
    { l: "61 a 90 días", v: Number(ant?.d61_90 ?? 0), tono: "text-rose-600" },
    { l: "Más de 90 días", v: Number(ant?.d90 ?? 0), tono: "text-rose-700" },
  ];
  return (
    <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr_2fr]">
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><Wallet className="h-4 w-4" /> A pagar</p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{din(ant?.total ?? 0)}</p>
        <p className="mt-1 text-xs text-slate-500">
          {ant?.proveedores ?? 0} {ant?.proveedores === 1 ? "proveedor" : "proveedores"}
          {vencido > 0 ? <span className="font-semibold text-rose-600"> · vencido {din(vencido)}</span> : null}
          <span className="text-emerald-700"> · pagado este mes {din(ant?.pagado_mes ?? 0)}</span>
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => tocar("semana")} className={tile("semana")}>
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500"><CalendarClock className="h-3.5 w-3.5" /> Vence esta semana</p>
          <p className={`mt-1 text-sm font-bold tabular-nums ${Number(ant?.vence_semana ?? 0) > 0 ? "text-amber-600" : "text-slate-300"}`}>{din(ant?.vence_semana ?? 0)}</p>
        </button>
        <button onClick={() => tocar("por_vencer")} className={tile("por_vencer")}>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Por vencer</p>
          <p className={`mt-1 text-sm font-bold tabular-nums ${Number(ant?.por_vencer ?? 0) > 0 ? "text-slate-900" : "text-slate-300"}`}>{din(ant?.por_vencer ?? 0)}</p>
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tramos.map((t) => (
          <button key={t.l} onClick={() => tocar("vencidas")} className={tile("vencidas")}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t.l}</p>
            <p className={`mt-1 text-sm font-bold tabular-nums ${t.v > 0 ? t.tono : "text-slate-300"}`}>{din(t.v)}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

/** En la pestaña de pagos los KPIs siguen al día (antigüedad de la moneda elegida). */
function AntiguedadSilenciosa({ moneda, recarga, onAntiguedad }: { moneda: Moneda; recarga: number; onAntiguedad: (a: AntiguedadPagar) => void }) {
  useEffect(() => {
    apiFetch<ListaCuentasPagar>(`/api/cuentas-pagar?moneda=${moneda}&por_pagina=10`).then((r) => onAntiguedad(r.antiguedad)).catch(() => {});
  }, [moneda, recarga, onAntiguedad]);
  return null;
}

function FiltroProveedor({ proveedor, setProveedor, proveedores }: { proveedor: string; setProveedor: (v: string) => void; proveedores: ProveedorMin[] }) {
  return <Select value={proveedor} onChange={setProveedor} minWidth={200} options={[["", "Todos los proveedores"], ...proveedores.map((p): [string, string] => [p.id, nombreProveedor(p)])]} />;
}

function TablaCuentas({ moneda, filtro, setFiltro, proveedor, setProveedor, proveedores, recarga, onAntiguedad, esAdmin, onPagar }: {
  moneda: Moneda; filtro: string; setFiltro: (f: string) => void; proveedor: string; setProveedor: (v: string) => void; proveedores: ProveedorMin[]; recarga: number;
  onAntiguedad: (a: AntiguedadPagar) => void; esAdmin: boolean; onPagar: (p: Pagando) => void;
}) {
  const [rows, setRows] = useState<CuentaPagar[]>([]);
  const [total, setTotal] = useState(0);
  const [totalSaldo, setTotalSaldo] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [borrador, setBorrador] = useState("");
  const [q, setQ] = useState("");
  const [pagina, setPagina] = useState(1);
  const [exportando, setExportando] = useState(false);
  const din = (v: number) => dinero(v, moneda);

  useEffect(() => {
    const t = setTimeout(() => { setQ(borrador.trim()); setPagina(1); }, 300);
    return () => clearTimeout(t);
  }, [borrador]);
  useEffect(() => { setPagina(1); }, [moneda, proveedor, filtro]);

  const params = useCallback(() => {
    const sp = new URLSearchParams({ moneda });
    if (q) sp.set("q", q);
    if (filtro) sp.set("filtro", filtro);
    if (proveedor) sp.set("proveedor", proveedor);
    return sp;
  }, [moneda, q, filtro, proveedor]);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    const sp = params();
    sp.set("pagina", String(pagina));
    sp.set("por_pagina", String(POR_PAGINA));
    apiFetch<ListaCuentasPagar>(`/api/cuentas-pagar?${sp}`)
      .then((r) => { if (!cancel) { setRows(r.rows); setTotal(r.total); setTotalSaldo(r.total_saldo); onAntiguedad(r.antiguedad); } })
      .catch(() => { if (!cancel) { setRows([]); setTotal(0); } })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [params, pagina, recarga, onAntiguedad]);

  async function exportar() {
    setExportando(true);
    try { await descargarArchivo(`/api/cuentas-pagar/export?${params()}`, "cuentas-a-pagar.xlsx"); } catch { /* best-effort */ } finally { setExportando(false); }
  }

  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={borrador} onChange={(e) => setBorrador(e.target.value)} placeholder="Buscar por proveedor, RUC, factura o compra…" className={BUSCADOR} />
        </div>
        <FiltroProveedor proveedor={proveedor} setProveedor={setProveedor} proveedores={proveedores} />
        <div className="flex rounded-xl bg-slate-100 p-1">
          {([["", "Todas"], ["vencidas", "Vencidas"], ["semana", "Vencen esta semana"], ["por_vencer", "Por vencer"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => { setFiltro(v); setPagina(1); }}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${filtro === v ? "bg-white shadow-sm" : "text-slate-500"}`}
              style={filtro === v ? { color: TEAL } : undefined}>{l}</button>
          ))}
        </div>
        <button onClick={exportar} disabled={exportando || total === 0} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">
          {exportando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Excel
        </button>
        <p className="text-xs text-slate-500">{total} {total === 1 ? "factura" : "facturas"} · {din(totalSaldo)}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-left text-sm">
          <thead>
            <tr className="border-b-2 text-[11px] font-bold uppercase tracking-wider" style={{ borderColor: `${TEAL}26`, backgroundColor: `${TEAL}0d`, color: TEAL }}>
              <th className="px-5 py-3">Proveedor</th>
              <th className="px-3 py-3">Factura</th>
              <th className="px-3 py-3">Compra / gasto</th>
              <th className="px-3 py-3">Emisión</th>
              <th className="px-3 py-3">Vencimiento</th>
              <th className="px-3 py-3 text-right">Monto</th>
              <th className="px-3 py-3 text-right">Pagado</th>
              <th className="px-3 py-3 text-right">Saldo</th>
              <th className="px-3 py-3">Estado</th>
              <th className="w-px px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cargando && rows.length === 0 ? (
              <tr><td colSpan={10} className="px-5 py-12 text-center text-sm text-slate-400">Cargando…</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-5 py-16 text-center">
                  <Banknote className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-3 text-sm font-medium text-slate-700">{q || filtro || proveedor ? "Ninguna factura coincide" : `No le debés nada a ningún proveedor${moneda === "USD" ? " en dólares" : ""}`}</p>
                  <p className="mt-1 text-xs text-slate-500">Las compras y los gastos a crédito aparecen acá hasta que los pagues.</p>
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const v = textoVencimiento(r.dias_atraso, r.dias_para_vencer);
                const est = r.dias_atraso > 0 ? { t: "Vencida", c: "bg-rose-50 text-rose-700" } : ESTADO_CXP[r.estado] ?? ESTADO_CXP.pendiente;
                return (
                  <tr key={r.id} className={`transition-colors hover:bg-[var(--brand-50)] ${cargando ? "opacity-60" : ""}`}>
                    <td className="px-5 py-3">
                      <p className="font-bold text-slate-900">{r.proveedor_nombre}</p>
                      <p className="text-[11px] text-slate-500">
                        {r.proveedor_ruc ? <span className="font-mono">RUC {r.proveedor_ruc}</span> : "sin RUC"}
                        {esAdmin ? (
                          <button onClick={() => onPagar({ id: r.proveedor_id, nombre: r.proveedor_nombre })} className="ml-2 font-semibold text-[var(--brand)] hover:underline">Registrar pago</button>
                        ) : null}
                      </p>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs font-semibold text-slate-800">{r.numero}</td>
                    <td className="px-3 py-3"><Link href={hrefOrigenCxp(r)} className="font-mono text-xs font-semibold text-[var(--brand)] hover:underline">{r.compra_numero}</Link></td>
                    <td className="px-3 py-3 text-xs text-slate-600">{dia(r.fecha_emision)}</td>
                    <td className="px-3 py-3 text-xs">
                      <span className="text-slate-700">{dia(r.vencimiento)}</span>
                      <span className={`block text-[11px] ${v.c}`}>{v.t}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-slate-600">{din(r.monto)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-emerald-700">{Number(r.pagado) ? din(r.pagado) : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-bold tabular-nums text-slate-900">{din(r.saldo)}</td>
                    <td className="px-3 py-3"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${est.c}`}>{est.t}</span></td>
                    <td className="px-5 py-3">
                      {esAdmin ? (
                        <button onClick={() => onPagar({ id: r.proveedor_id, nombre: r.proveedor_nombre, cxp: r.id })}
                          className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white hover:brightness-95" style={{ backgroundColor: TEAL }}>
                          <Banknote className="h-3.5 w-3.5" /> Pagar
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <Paginador pagina={pagina} totalPaginas={totalPaginas} total={total} porPagina={POR_PAGINA} setPagina={setPagina} />
    </section>
  );
}

function TablaPagos({ moneda, proveedor, setProveedor, proveedores, recarga, esAdmin, onCambio }: {
  moneda: Moneda; proveedor: string; setProveedor: (v: string) => void; proveedores: ProveedorMin[]; recarga: number; esAdmin: boolean; onCambio: () => void;
}) {
  const POR = 25;
  const [rows, setRows] = useState<PagoProveedor[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [borrador, setBorrador] = useState("");
  const [q, setQ] = useState("");
  const [anulados, setAnulados] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [viendo, setViendo] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<PagoProveedor | null>(null);
  const [recargaLocal, setRecargaLocal] = useState(0);
  const din = (v: number) => dinero(v, moneda);

  useEffect(() => {
    const t = setTimeout(() => { setQ(borrador.trim()); setPagina(1); }, 300);
    return () => clearTimeout(t);
  }, [borrador]);
  useEffect(() => { setPagina(1); }, [moneda, proveedor, anulados]);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    const sp = new URLSearchParams({ moneda, pagina: String(pagina), por_pagina: String(POR) });
    if (q) sp.set("q", q);
    if (proveedor) sp.set("proveedor", proveedor);
    if (anulados) sp.set("anulados", "1");
    apiFetch<{ rows: PagoProveedor[]; total: number }>(`/api/pagos-proveedores?${sp}`)
      .then((r) => { if (!cancel) { setRows(r.rows); setTotal(r.total); } })
      .catch(() => { if (!cancel) { setRows([]); setTotal(0); } })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [moneda, q, proveedor, anulados, pagina, recarga, recargaLocal]);

  const totalPaginas = Math.max(1, Math.ceil(total / POR));
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={borrador} onChange={(e) => setBorrador(e.target.value)} placeholder="Buscar por número de orden (OP-…) o proveedor…" className={BUSCADOR} />
        </div>
        <FiltroProveedor proveedor={proveedor} setProveedor={setProveedor} proveedores={proveedores} />
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={anulados} onChange={(e) => setAnulados(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />
          Ver también las anuladas
        </label>
        <p className="text-xs text-slate-500">{total} {total === 1 ? "orden de pago" : "órdenes de pago"}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead>
            <tr className="border-b-2 text-[11px] font-bold uppercase tracking-wider" style={{ borderColor: `${TEAL}26`, backgroundColor: `${TEAL}0d`, color: TEAL }}>
              <th className="px-5 py-3">Número</th>
              <th className="px-3 py-3">Proveedor</th>
              <th className="px-3 py-3">Fecha</th>
              <th className="px-3 py-3">Medios</th>
              <th className="px-3 py-3 text-right">Total</th>
              <th className="px-3 py-3">Usuario</th>
              <th className="w-px px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cargando && rows.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-400">Cargando…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-16 text-center text-sm text-slate-400">{q || proveedor ? "Ninguna orden de pago coincide." : "Todavía no registraste pagos a proveedores."}</td></tr>
            ) : (
              rows.map((p) => {
                const anulado = !!p.anulado_at;
                return (
                  <tr key={p.id} className={`transition-colors hover:bg-[var(--brand-50)] ${cargando ? "opacity-60" : ""} ${anulado ? "opacity-60" : ""}`}>
                    <td className="px-5 py-3">
                      <button onClick={() => setViendo(p.id)} className={`font-mono text-xs font-semibold hover:text-[var(--brand)] ${anulado ? "text-slate-400 line-through" : "text-slate-800"}`}>{p.numero}</button>
                      {anulado ? <span className="ml-2 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">Anulada</span> : null}
                    </td>
                    <td className="px-3 py-3 font-semibold text-slate-800">{p.proveedor_nombre}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600">{fechaHora(p.fecha)}</td>
                    <td className="px-3 py-3 text-xs text-slate-600">
                      {(p.medios ?? []).map((m) => `${nombreMetodoPago(m.metodo)}${m.referencia ? ` (${m.referencia})` : ""}`).join(" + ")}
                      {anulado && p.anulado_motivo ? <span className="block text-[11px] text-rose-600">anulada: {p.anulado_motivo}</span> : null}
                    </td>
                    <td className={`whitespace-nowrap px-3 py-3 text-right font-bold tabular-nums ${anulado ? "text-slate-400 line-through" : "text-slate-900"}`}>{din(p.total)}</td>
                    <td className="px-3 py-3 text-xs text-slate-600">{p.usuario_nombre ?? "—"}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setViendo(p.id)} title="Ver" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"><Eye className="h-3.5 w-3.5" /> Ver</button>
                        <button onClick={() => imprimirOrdenPago(p.id, p.numero).catch(() => {})} title="Orden de pago en PDF" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"><Printer className="h-3.5 w-3.5" /> PDF</button>
                        {!anulado && esAdmin ? (
                          <button onClick={() => setAnulando(p)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Ban className="h-3.5 w-3.5" /> Anular</button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <Paginador pagina={pagina} totalPaginas={totalPaginas} total={total} porPagina={POR} setPagina={setPagina} />

      {viendo ? <DetallePago id={viendo} puedeAnular={esAdmin} onClose={() => setViendo(null)} onAnular={(p) => { setViendo(null); setAnulando(p); }} /> : null}
      {anulando ? (
        <AnularPago pago={anulando} onClose={() => setAnulando(null)} onAnulado={() => { setRecargaLocal((k) => k + 1); onCambio(); }} />
      ) : null}
    </section>
  );
}

function Paginador({ pagina, totalPaginas, total, porPagina, setPagina }: { pagina: number; totalPaginas: number; total: number; porPagina: number; setPagina: (f: (p: number) => number) => void }) {
  if (total <= porPagina) return null;
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
      <span>Página {pagina} de {totalPaginas}</span>
      <div className="flex gap-2">
        <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Anterior</button>
        <button disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Siguiente</button>
      </div>
    </div>
  );
}
