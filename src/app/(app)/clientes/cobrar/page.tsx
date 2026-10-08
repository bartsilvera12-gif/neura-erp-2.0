"use client";

/**
 * /clientes/cobrar — Cuentas a cobrar de todos los clientes (Fase 2). Arriba la antigüedad
 * de la deuda (por vencer, 1-30, 31-60, 61-90, +90 días) y lo cobrado en el mes; los
 * tramos filtran. Lista por vencimiento (lo más urgente primero), con teléfono para llamar
 * y "Cobrar" que abre el cobro de ese cliente.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { HandCoins, Search, Wallet } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { RegistrarCobro } from "@/modules/clientes/RegistrarCobro";
import type { CuentaCobrar } from "@/modules/clientes/cobros";

const TEAL = clienteConfig.color;
const POR_PAGINA = 50;
const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const dia = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("es-PY", { day: "2-digit", month: "short", year: "numeric" });

type Antiguedad = { por_vencer: number; d1_30: number; d31_60: number; d61_90: number; d90: number; clientes: number; total: number; cobrado_mes: number };
type Fila = CuentaCobrar & { cliente_id: string; cliente_nombre: string; cliente_telefono: string | null; cliente_documento: string | null };

export default function CuentasCobrarPage() {
  const [rows, setRows] = useState<Fila[]>([]);
  const [total, setTotal] = useState(0);
  const [totalSaldo, setTotalSaldo] = useState(0);
  const [ant, setAnt] = useState<Antiguedad | null>(null);
  const [cargando, setCargando] = useState(true);
  const [borrador, setBorrador] = useState("");
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState("");
  const [pagina, setPagina] = useState(1);
  const [cobrando, setCobrando] = useState<{ id: string; nombre: string } | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => { setQ(borrador.trim()); setPagina(1); }, 300);
    return () => clearTimeout(t);
  }, [borrador]);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    const sp = new URLSearchParams({ pagina: String(pagina), por_pagina: String(POR_PAGINA) });
    if (q) sp.set("q", q);
    if (filtro) sp.set("filtro", filtro);
    apiFetch<{ rows: Fila[]; total: number; total_saldo: number; antiguedad: Antiguedad }>(`/api/cuentas-cobrar?${sp}`)
      .then((r) => { if (!cancel) { setRows(r.rows); setTotal(r.total); setTotalSaldo(r.total_saldo); setAnt(r.antiguedad); } })
      .catch(() => { if (!cancel) { setRows([]); setTotal(0); } })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [q, filtro, pagina, recarga]);

  const refrescar = useCallback(() => setRecarga((k) => k + 1), []);
  const vencido = ant ? ant.d1_30 + ant.d31_60 + ant.d61_90 + ant.d90 : 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const tramos: { l: string; v: number; tono: string }[] = ant ? [
    { l: "Por vencer", v: ant.por_vencer, tono: "text-slate-900" },
    { l: "1 a 30 días", v: ant.d1_30, tono: "text-amber-600" },
    { l: "31 a 60 días", v: ant.d31_60, tono: "text-orange-600" },
    { l: "61 a 90 días", v: ant.d61_90, tono: "text-rose-600" },
    { l: "Más de 90 días", v: ant.d90, tono: "text-rose-700" },
  ] : [];

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Comercial · Clientes</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Cuentas a cobrar</h1>
          <p className="mt-1 text-sm text-slate-500">Todo lo que te deben tus clientes, empezando por lo más urgente.</p>
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-[1.2fr_2fr]">
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><Wallet className="h-4 w-4" /> Total a cobrar</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{gs(ant?.total ?? 0)}</p>
          <p className="mt-1 text-xs text-slate-500">
            {ant?.clientes ?? 0} {ant?.clientes === 1 ? "cliente" : "clientes"}
            {vencido > 0 ? <span className="font-semibold text-rose-600"> · vencido {gs(vencido)}</span> : null}
            <span className="text-emerald-700"> · cobrado este mes {gs(ant?.cobrado_mes ?? 0)}</span>
          </p>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {tramos.map((t, i) => {
            const clave = i === 0 ? "por_vencer" : "vencidas";
            const activo = (i === 0 && filtro === "por_vencer") || (i > 0 && filtro === "vencidas");
            return (
              <button key={t.l} onClick={() => { setFiltro(activo ? "" : clave); setPagina(1); }}
                className={`rounded-2xl border bg-white px-3 py-3 text-left shadow-sm transition hover:border-slate-300 ${activo ? "border-[var(--brand)] ring-2 ring-[var(--brand-100)]" : "border-slate-200"}`}>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t.l}</p>
                <p className={`mt-1 text-sm font-bold tabular-nums ${t.v > 0 ? t.tono : "text-slate-300"}`}>{gs(t.v)}</p>
              </button>
            );
          })}
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={borrador} onChange={(e) => setBorrador(e.target.value)} placeholder="Buscar por cliente, RUC o número de venta…"
              className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]" />
          </div>
          <div className="flex rounded-xl bg-slate-100 p-1">
            {([["", "Todas"], ["vencidas", "Vencidas"], ["semana", "Vencen esta semana"], ["por_vencer", "Por vencer"]] as const).map(([v, l]) => (
              <button key={v} onClick={() => { setFiltro(v); setPagina(1); }}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${filtro === v ? "bg-white shadow-sm" : "text-slate-500"}`}
                style={filtro === v ? { color: TEAL } : undefined}>{l}</button>
            ))}
          </div>
          <p className="text-xs text-slate-500">{total} {total === 1 ? "cuenta" : "cuentas"} · {gs(totalSaldo)}</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b-2 text-[11px] font-bold uppercase tracking-wider" style={{ borderColor: `${TEAL}26`, backgroundColor: `${TEAL}0d`, color: TEAL }}>
                <th className="px-5 py-3">Cliente</th>
                <th className="px-3 py-3">Venta</th>
                <th className="px-3 py-3">Vence</th>
                <th className="px-3 py-3 text-right">Importe</th>
                <th className="px-3 py-3 text-right">Debe</th>
                <th className="w-px px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando && rows.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-slate-400">Cargando…</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-16 text-center">
                    <HandCoins className="mx-auto h-8 w-8 text-slate-300" />
                    <p className="mt-3 text-sm font-medium text-slate-700">{q || filtro ? "Ninguna cuenta coincide" : "Nadie te debe nada"}</p>
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className={`transition-colors hover:bg-[var(--brand-50)] ${cargando ? "opacity-60" : ""}`}>
                    <td className="px-5 py-3">
                      <Link href={`/clientes/${r.cliente_id}`} className="font-bold text-slate-900 hover:text-[var(--brand)]">{r.cliente_nombre}</Link>
                      <p className="text-[11px] text-slate-500">{r.cliente_telefono ? <a href={`tel:${r.cliente_telefono}`} className="hover:underline">{r.cliente_telefono}</a> : "sin teléfono"}</p>
                    </td>
                    <td className="px-3 py-3"><span className="font-mono text-xs font-semibold text-slate-800">{r.numero}</span><span className="block text-[11px] text-slate-500">{dia(r.fecha_emision)}</span></td>
                    <td className={`px-3 py-3 text-xs ${r.dias_atraso > 0 ? "font-semibold text-rose-600" : "text-slate-600"}`}>
                      {dia(r.vencimiento)}{r.dias_atraso > 0 ? <span className="block">vencida hace {r.dias_atraso} días</span> : null}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-600">{gs(r.monto)}</td>
                    <td className="px-3 py-3 text-right font-bold tabular-nums text-slate-900">{gs(r.saldo)}</td>
                    <td className="px-5 py-3">
                      <button onClick={() => setCobrando({ id: r.cliente_id, nombre: r.cliente_nombre })}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
                        <HandCoins className="h-3.5 w-3.5" /> Cobrar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {total > POR_PAGINA ? (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            <span>Página {pagina} de {totalPaginas}</span>
            <div className="flex gap-2">
              <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Anterior</button>
              <button disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Siguiente</button>
            </div>
          </div>
        ) : null}
      </section>

      {cobrando ? <RegistrarCobro clienteId={cobrando.id} clienteNombre={cobrando.nombre} onClose={() => setCobrando(null)} onHecho={refrescar} /> : null}
    </div>
  );
}
