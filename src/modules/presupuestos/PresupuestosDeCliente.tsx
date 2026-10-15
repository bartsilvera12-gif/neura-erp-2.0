"use client";

/**
 * Pestaña "Presupuestos" de la ficha del cliente: sus últimos presupuestos (todos los
 * estados) con acceso a cada uno, "Nuevo presupuesto" y "Ver todos" (lista filtrada).
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { FileSignature, Loader2, Plus } from "lucide-react";
import { apiFetchSWR, guardadoAlInstante } from "@/lib/api/cache-cliente";
import { clienteConfig } from "@/cliente.config";
import { BadgeEstado } from "@/modules/presupuestos/ui";
import { diaCorto, monto, type ListaPresupuestos } from "@/modules/presupuestos/tipos";

const TEAL = clienteConfig.color;
const LIMITE = 10;

export function PresupuestosDeCliente({ clienteId, clienteNombre }: { clienteId: string; clienteNombre: string }) {
  const url = `/api/presupuestos?cliente=${clienteId}&por_pagina=${LIMITE}`;
  const [data, setData] = useState<ListaPresupuestos | null>(() => guardadoAlInstante<ListaPresupuestos>(url) ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    apiFetchSWR<ListaPresupuestos>(url, setData, { signal: ctrl.signal }).catch((e) => { if (!ctrl.signal.aborted) setError((e as Error).message); });
    return () => ctrl.abort();
  }, [url]);

  const nuevo = `/presupuestos/nuevo?cliente=${clienteId}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">Presupuestos del cliente{data ? <span className="ml-1.5 font-normal text-slate-400">({data.total})</span> : null}</p>
        <div className="flex items-center gap-2">
          {data && data.total > LIMITE ? (
            <Link href={`/presupuestos?cliente=${clienteId}&nombre=${encodeURIComponent(clienteNombre)}`} className="text-xs font-semibold text-[var(--brand)] hover:underline">Ver todos</Link>
          ) : null}
          <Link href={nuevo} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:brightness-95" style={{ backgroundColor: TEAL }}>
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Nuevo presupuesto
          </Link>
        </div>
      </div>
      {!data ? (
        error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          : <p className="flex items-center gap-2 py-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : data.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
          <FileSignature className="mx-auto h-7 w-7 text-slate-300" />
          <p className="mt-2 text-sm text-slate-500">Todavía no tiene presupuestos.</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
          {data.rows.map((r) => (
            <li key={r.id}>
              <Link href={`/presupuestos/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--brand-50)]">
                <span className="w-28 shrink-0 font-mono text-xs font-semibold text-slate-800">{r.numero}{r.revision > 1 ? <span className="ml-1 text-[10px] text-slate-400">rev {r.revision}</span> : null}</span>
                <span className="w-24 shrink-0 text-xs text-slate-500">{diaCorto(r.fecha)}</span>
                <span className={`hidden w-32 shrink-0 text-xs sm:block ${r.estado === "vencido" ? "font-semibold text-rose-600" : "text-slate-500"}`}>hasta {diaCorto(r.valido_hasta)}</span>
                <span className="min-w-0 flex-1"><BadgeEstado estado={r.estado} /></span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{monto(r.total, r.moneda)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
