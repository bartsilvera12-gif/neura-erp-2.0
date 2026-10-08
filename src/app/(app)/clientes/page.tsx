"use client";

/**
 * /clientes — lista de clientes (Fase 1). Arriba: clientes, con deuda, a cobrar y vencido.
 * Lista paginada en el servidor (listar_clientes) con búsqueda inteligente (nombre, RUC
 * o CI con o sin puntos, teléfono, email, ciudad), filtros por tipo, condición, deuda e
 * inactivos, exportar Excel y alta en panel lateral. Por defecto, los que deben primero.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Download, Loader2, Plus, Search, Users, Wallet } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { TZ_PY } from "@/lib/fecha/paraguay";
import { ClienteForm, type ClienteFicha } from "@/modules/clientes/ClienteForm";

const TEAL = clienteConfig.color;
const POR_PAGINA = 25;
const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "short", year: "numeric" });

type Fila = ClienteFicha & { total_comprado: number; compras: number; ultima_compra: string | null; deuda: number; vencido: number };
type Kpis = { clientes: number; con_deuda: number; a_cobrar: number; vencido: number };

export default function ClientesPage() {
  const [rows, setRows] = useState<Fila[]>([]);
  const [total, setTotal] = useState(0);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [borrador, setBorrador] = useState("");
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState("");
  const [condicion, setCondicion] = useState("");
  const [deuda, setDeuda] = useState("");
  const [verInactivos, setVerInactivos] = useState(false);
  const [nuevo, setNuevo] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const [exportando, setExportando] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setQ(borrador.trim()); setPagina(1); }, 300);
    return () => clearTimeout(t);
  }, [borrador]);

  const filtros = useCallback(() => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (tipo) sp.set("tipo", tipo);
    if (condicion) sp.set("condicion", condicion);
    if (deuda) sp.set("deuda", deuda);
    if (verInactivos) sp.set("inactivos", "1");
    return sp;
  }, [q, tipo, condicion, deuda, verInactivos]);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    const sp = filtros();
    sp.set("paginado", "1");
    sp.set("pagina", String(pagina));
    sp.set("por_pagina", String(POR_PAGINA));
    apiFetch<{ rows: Fila[]; total: number; kpis: Kpis }>(`/api/clientes?${sp}`)
      .then((r) => { if (!cancel) { setRows(r.rows); setTotal(r.total); setKpis(r.kpis); } })
      .catch(() => { if (!cancel) { setRows([]); setTotal(0); } })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [filtros, pagina, recarga]);

  const hayFiltros = !!(q || tipo || condicion || deuda || verInactivos);
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  async function exportar() {
    setExportando(true);
    try {
      await descargarArchivo(`/api/clientes/export?${filtros()}`, "clientes.xlsx");
    } catch {
      /* best-effort */
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Comercial</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Clientes</h1>
          <p className="mt-1 text-sm text-slate-500">Tus clientes, lo que compran y lo que te deben.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={exportar} disabled={exportando} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">
            {exportando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Exportar Excel
          </button>
          <button onClick={() => setNuevo(true)} className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95" style={{ backgroundColor: TEAL }}>
            <Plus className="h-4 w-4" /> Nuevo cliente
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi titulo="Clientes activos" valor={kpis ? kpis.clientes.toLocaleString("es-PY") : "—"} icono={<Users className="h-4 w-4" />} />
        <Kpi titulo="Con deuda" valor={kpis ? kpis.con_deuda.toLocaleString("es-PY") : "—"} icono={<Wallet className="h-4 w-4" />} onClick={() => { setDeuda(deuda === "con_deuda" ? "" : "con_deuda"); setPagina(1); }} activo={deuda === "con_deuda"} />
        <Kpi titulo="Total a cobrar" valor={kpis ? gs(kpis.a_cobrar) : "—"} icono={<Wallet className="h-4 w-4" />} />
        <Kpi titulo="Vencido" valor={kpis ? gs(kpis.vencido) : "—"} icono={<AlertTriangle className="h-4 w-4" />} tono={kpis && kpis.vencido > 0 ? "rojo" : undefined}
          onClick={() => { setDeuda(deuda === "vencidos" ? "" : "vencidos"); setPagina(1); }} activo={deuda === "vencidos"} />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={borrador} onChange={(e) => setBorrador(e.target.value)} placeholder="Buscar por nombre, RUC, CI, teléfono o ciudad…"
              className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]" />
          </div>
          <Select value={tipo} onChange={(v) => { setTipo(v); setPagina(1); }} minWidth={150} options={[["", "Personas y empresas"], ["persona", "Personas"], ["empresa", "Empresas"]]} />
          <Select value={condicion} onChange={(v) => { setCondicion(v); setPagina(1); }} minWidth={150} options={[["", "Contado y crédito"], ["CONTADO", "Contado"], ["CREDITO", "A crédito"]]} />
          <Select value={deuda} onChange={(v) => { setDeuda(v); setPagina(1); }} minWidth={150} options={[["", "Con y sin deuda"], ["con_deuda", "Con deuda"], ["vencidos", "Con deuda vencida"]]} />
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={verInactivos} onChange={(e) => { setVerInactivos(e.target.checked); setPagina(1); }} className="h-4 w-4 accent-[var(--brand)]" />
            Ver inactivos
          </label>
          {hayFiltros ? (
            <button onClick={() => { setBorrador(""); setQ(""); setTipo(""); setCondicion(""); setDeuda(""); setVerInactivos(false); setPagina(1); }} className="text-xs text-slate-400 underline-offset-2 hover:text-slate-700 hover:underline">Limpiar</button>
          ) : null}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b-2 text-[11px] font-bold uppercase tracking-wider" style={{ borderColor: `${TEAL}26`, backgroundColor: `${TEAL}0d`, color: TEAL }}>
                <th className="px-5 py-3">Cliente</th>
                <th className="px-3 py-3">RUC / CI</th>
                <th className="px-3 py-3">Teléfono</th>
                <th className="px-3 py-3">Condición</th>
                <th className="px-3 py-3">Última compra</th>
                <th className="px-3 py-3 text-right">Comprado</th>
                <th className="px-5 py-3 text-right">Deuda</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando && rows.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-400">Cargando…</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <Users className="mx-auto h-8 w-8 text-slate-300" />
                    <p className="mt-3 text-sm font-medium text-slate-700">{hayFiltros ? "Ningún cliente coincide" : "Todavía no cargaste clientes"}</p>
                    {!hayFiltros ? (
                      <button onClick={() => setNuevo(true)} className="mt-4 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: TEAL }}>
                        <Plus className="h-4 w-4" /> Nuevo cliente
                      </button>
                    ) : null}
                  </td>
                </tr>
              ) : (
                rows.map((c) => (
                  <tr key={c.id} className={`transition-colors hover:bg-[var(--brand-50)] ${cargando ? "opacity-60" : ""} ${c.activo === false ? "opacity-60" : ""}`}>
                    <td className="px-5 py-3">
                      <Link href={`/clientes/${c.id}`} className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ backgroundColor: `${TEAL}1a`, color: TEAL }}>
                          {c.nombre.charAt(0).toUpperCase()}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-bold text-slate-900 hover:text-[var(--brand)]">
                            {c.nombre}
                            {c.activo === false ? <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-slate-500">Inactivo</span> : null}
                          </span>
                          <span className="block truncate text-[11px] text-slate-500">
                            {c.tipo_cliente === "empresa" ? "Empresa" : "Persona"}{c.ciudad ? ` · ${c.ciudad}` : ""}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-600">{c.documento || "—"}</td>
                    <td className="px-3 py-3 text-xs text-slate-600">{c.telefono || "—"}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.condicion_pago === "CREDITO" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                        {c.condicion_pago === "CREDITO" ? `Crédito${c.plazo_dias ? ` ${c.plazo_dias} días` : ""}` : "Contado"}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600">{c.ultima_compra ? fecha(c.ultima_compra) : <span className="text-slate-400">Nunca compró</span>}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-700">{Number(c.total_comprado) ? gs(c.total_comprado) : "—"}</td>
                    <td className="px-5 py-3 text-right">
                      {Number(c.deuda) > 0 ? (
                        <>
                          <p className={`font-bold tabular-nums ${Number(c.vencido) > 0 ? "text-rose-600" : "text-slate-900"}`}>{gs(c.deuda)}</p>
                          {Number(c.vencido) > 0 ? <p className="text-[11px] font-semibold text-rose-600">vencido {gs(c.vencido)}</p> : null}
                        </>
                      ) : <span className="text-xs text-slate-400">Al día</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {total > POR_PAGINA ? (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            <span>Página {pagina} de {totalPaginas} · {total} clientes</span>
            <div className="flex gap-2">
              <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Anterior</button>
              <button disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Siguiente</button>
            </div>
          </div>
        ) : null}
      </section>

      {nuevo ? <ClienteForm onClose={() => setNuevo(false)} onSaved={() => { setNuevo(false); setRecarga((k) => k + 1); }} /> : null}
    </div>
  );
}

function Kpi({ titulo, valor, icono, tono, onClick, activo }: { titulo: string; valor: string; icono: React.ReactNode; tono?: "rojo"; onClick?: () => void; activo?: boolean }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={`rounded-2xl border bg-white px-4 py-3 text-left shadow-sm transition ${onClick ? "hover:border-slate-300" : ""} ${activo ? "border-[var(--brand)] ring-2 ring-[var(--brand-100)]" : "border-slate-200"}`}>
      <p className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${tono === "rojo" ? "text-rose-600" : "text-slate-500"}`}>{icono} {titulo}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${tono === "rojo" ? "text-rose-600" : "text-slate-900"}`}>{valor}</p>
      {onClick ? <p className="text-[11px] text-slate-400">{activo ? "Filtrando · tocá para quitar" : "Tocá para ver cuáles"}</p> : null}
    </Tag>
  );
}
