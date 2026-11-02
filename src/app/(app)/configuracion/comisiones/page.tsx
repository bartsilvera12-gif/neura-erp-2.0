"use client";

/**
 * /configuracion/comisiones — Política de comisiones (receta 115): nombre, estado, base de cálculo y
 * escalas por monto. Hay una política por empresa; cada guardado deja una versión.
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Loader2, Percent, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { gs } from "@/components/graficos/formato";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { Select } from "@/components/Select";
import MontoInput from "@/components/ui/MontoInput";
import { fechaHora } from "@/lib/fecha/paraguay";

type EscalaApi = { desde_monto: number; hasta_monto: number | null; porcentaje_comision: number; premio_fijo: number | null };
type Datos = { politica: { id: string; nombre: string; activo: boolean; base_calculo: string; updated_at: string } | null; escalas: EscalaApi[] };
type Fila = { desde: number; hasta: number; pct: string; premio: number };

const URL_POLITICA = "/api/comisiones/politica";
const BASES: [string, string][] = [["pago_registrado", "Pago registrado"], ["factura_emitida", "Factura emitida"], ["factura_pagada", "Factura pagada"]];
const VACIA: Fila = { desde: 0, hasta: 0, pct: "0", premio: 0 };
const INPUT = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
const LABEL = "mb-1 block text-xs font-medium text-slate-600";

function Metrica({ label, valor, sub }: { label: string; valor: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-800">{valor}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

const resumen = (filas: Fila[]) => {
  if (!filas.length) return "Sin escalas";
  const primera = `desde ${gs(filas[0].desde)} · ${filas[0].pct}%`;
  return filas.length === 1 ? `1 escala · ${primera}` : `${filas.length} escalas · primera ${primera}`;
};

export default function ConfiguracionComisionesPage() {
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardada, setGuardada] = useState(false);
  const [actualizada, setActualizada] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(true);
  const [nombre, setNombre] = useState("Política principal");
  const [activo, setActivo] = useState(true);
  const [base, setBase] = useState("pago_registrado");
  const [filas, setFilas] = useState<Fila[]>([VACIA]);

  const aplicar = useCallback((d: Datos) => {
    setGuardada(!!d.politica);
    if (d.politica) {
      setNombre(d.politica.nombre);
      setActivo(d.politica.activo);
      setBase(d.politica.base_calculo);
      setActualizada(d.politica.updated_at);
    }
    if (d.escalas.length) {
      setFilas(d.escalas.map((e) => ({ desde: Number(e.desde_monto), hasta: Number(e.hasta_monto) || 0, pct: String(Number(e.porcentaje_comision)), premio: Number(e.premio_fijo) || 0 })));
    }
  }, []);

  useEffect(() => {
    apiFetch<Datos>(URL_POLITICA)
      .then((d) => { aplicar(d); setAbierto(!d.politica); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setCargando(false));
  }, [aplicar]);

  const cambiar = (i: number, p: Partial<Fila>) => setFilas((l) => l.map((f, k) => (k === i ? { ...f, ...p } : f)));

  async function guardar() {
    setError(null);
    setAviso(null);
    const pcts = filas.map((f) => Number(f.pct.replace(",", ".")));
    if (pcts.some((p) => !Number.isFinite(p) || p < 0 || p > 100)) { setError("El porcentaje va de 0 a 100."); return; }
    if (filas.some((f) => f.hasta > 0 && f.hasta <= f.desde)) { setError("«Hasta» tiene que ser mayor que «Desde»."); return; }
    setGuardando(true);
    try {
      const d = await apiFetch<Datos>(URL_POLITICA, {
        method: "PUT",
        body: JSON.stringify({
          nombre: nombre.trim(), activo, base_calculo: base,
          escalas: filas.map((f, i) => ({ desde_monto: f.desde, hasta_monto: f.hasta > 0 ? f.hasta : null, porcentaje_comision: pcts[i], premio_fijo: f.premio > 0 ? f.premio : null })),
        }),
      });
      aplicar(d);
      setAbierto(false);
      setAviso("Política guardada.");
      setTimeout(() => setAviso(null), 5000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) {
    return <div className="flex items-center justify-center gap-2 py-24 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando política de comisiones…</div>;
  }

  return (
    <div className="space-y-5 pb-10">
      <EncabezadoPagina volver={{ href: "/configuracion", label: "Configuración" }} kicker="Configuración" titulo="Comisiones" subtitulo="Política comercial y escalas por montos." />

      {aviso ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{aviso}</p> : null}
      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700"><Percent className="h-5 w-5" aria-hidden /></div>
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-slate-900">{nombre || "Política comercial"}</h2>
              <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">Política · empresa actual</p>
            </div>
          </div>
          <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${!guardada ? "border-amber-200 bg-amber-50 text-amber-900" : activo ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-slate-100 text-slate-600"}`}>
            {!guardada ? "Sin guardar" : activo ? "Activa" : "Inactiva"}
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Metrica label="Base de cálculo" valor={BASES.find(([v]) => v === base)?.[1] ?? base} />
          <Metrica label="Escalas" valor={resumen(filas)} />
          <Metrica label="Última actualización" valor={actualizada ? fechaHora(actualizada) : "—"} sub={!guardada ? "Guardá la política para activarla." : undefined} />
        </div>
        <button type="button" onClick={() => setAbierto((v) => !v)} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 sm:min-h-0 max-sm:w-full max-sm:justify-center">
          {abierto ? "Ocultar edición" : "Editar configuración"}
          <ChevronDown className={`h-4 w-4 transition-transform ${abierto ? "rotate-180" : ""}`} aria-hidden />
        </button>
      </section>

      {abierto ? (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Política</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className={LABEL}>Nombre</span>
                <input value={nombre} maxLength={120} onChange={(e) => setNombre(e.target.value)} className={INPUT} />
              </label>
              <div>
                <span className={LABEL}>Estado</span>
                <Select block value={activo ? "1" : "0"} onChange={(v) => setActivo(v === "1")} etiqueta="Estado" options={[["1", "Activa"], ["0", "Inactiva"]]} />
              </div>
              <div>
                <span className={LABEL}>Base de cálculo</span>
                <Select block value={base} onChange={setBase} etiqueta="Base de cálculo" options={BASES} />
                <p className="mt-1 text-[11px] text-slate-500">Qué cuenta para la comisión de cada mes: lo cobrado, lo facturado o las ventas que terminaron de cobrarse.</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Escalas</h3>
            <p className="mb-3 text-xs text-slate-500">Rangos de monto en guaraníes y porcentaje de comisión. Dejá «Hasta» vacío para indicar sin techo.</p>
            <div className="space-y-3">
              {filas.map((f, i) => (
                <div key={i} className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3 sm:grid-cols-12 sm:items-end">
                  <label className="sm:col-span-3"><span className={LABEL}>Desde</span><MontoInput value={f.desde || ""} onChange={(n) => cambiar(i, { desde: n })} placeholder="0" className={`${INPUT} tabular-nums`} /></label>
                  <label className="sm:col-span-3"><span className={LABEL}>Hasta (opcional)</span><MontoInput value={f.hasta || ""} onChange={(n) => cambiar(i, { hasta: n })} placeholder="Sin techo" className={`${INPUT} tabular-nums`} /></label>
                  <label className="sm:col-span-2"><span className={LABEL}>% comisión</span><input inputMode="decimal" value={f.pct} onChange={(e) => cambiar(i, { pct: e.target.value })} className={`${INPUT} tabular-nums`} /></label>
                  <label className="sm:col-span-3"><span className={LABEL}>Premio fijo (opcional)</span><MontoInput value={f.premio || ""} onChange={(n) => cambiar(i, { premio: n })} placeholder="0" className={`${INPUT} tabular-nums`} /></label>
                  <div className="flex justify-end sm:col-span-1">
                    {filas.length > 1 ? (
                      <button type="button" onClick={() => setFilas((l) => l.filter((_, k) => k !== i))} aria-label={`Quitar la escala ${i + 1}`} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setFilas((l) => [...l, { ...VACIA }])} className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-[var(--brand)] hover:underline sm:min-h-0">
              <Plus className="h-4 w-4" /> Agregar escala
            </button>
          </section>

          <div className="flex justify-end">
            <button type="button" onClick={() => void guardar()} disabled={guardando || !nombre.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-5 py-2.5 text-sm font-semibold text-white shadow hover:brightness-95 disabled:opacity-60 max-sm:w-full">
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {guardando ? "Guardando…" : "Guardar política"}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
