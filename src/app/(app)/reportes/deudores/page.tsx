"use client";

/**
 * /reportes/deudores — quién te debe y cuánto, lo vencido primero. Cifras arriba
 * (clientes, deuda, vencido, tramos de atraso), una fila por cliente con teléfono,
 * días de atraso de lo más viejo y último pago. Excel y PDF (lista para salir a cobrar).
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FileSpreadsheet, FileText, HandCoins, Loader2, Search } from "lucide-react";
import { filtrar } from "@/lib/busqueda";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { clienteConfig } from "@/cliente.config";
import { TZ_PY } from "@/lib/fecha/paraguay";
import { RegistrarCobro } from "@/modules/clientes/RegistrarCobro";
import type { ReporteDeudores } from "@/modules/reportes/server/deudores";

const TEAL = clienteConfig.color;
const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "short", year: "numeric" });

export default function ReporteDeudoresPage() {
  const [data, setData] = useState<ReporteDeudores | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [soloVencidos, setSoloVencidos] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [bajando, setBajando] = useState<"" | "xlsx" | "pdf">("");
  const [cobrando, setCobrando] = useState<{ id: string; nombre: string } | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setData(await apiFetch<ReporteDeudores>(`/api/reportes/deudores${soloVencidos ? "?vencidos=1" : ""}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, [soloVencidos]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function bajar(f: "xlsx" | "pdf") {
    setBajando(f);
    try {
      await descargarArchivo(`/api/reportes/deudores/${f === "xlsx" ? "export" : "pdf"}${soloVencidos ? "?vencidos=1" : ""}`, `deudores.${f}`);
    } catch {
      /* best-effort */
    } finally {
      setBajando("");
    }
  }

  const filas = filtrar(data?.rows ?? [], busqueda, (f) => ({ principal: f.razon_social || f.nombre, otros: [f.nombre, f.ciudad], codigos: [f.documento, f.telefono] }));
  const t = data?.totales;
  const tramos: [string, number, string][] = t ? [
    ["Por vencer", t.por_vencer, "text-slate-900"], ["1 a 30 días", t.d1_30, "text-amber-600"], ["31 a 60 días", t.d31_60, "text-orange-600"],
    ["61 a 90 días", t.d61_90, "text-rose-600"], ["Más de 90 días", t.d90, "text-rose-700"],
  ] : [];

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link href="/reportes" aria-label="Volver a reportes" className="mt-1 flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" /></Link>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Reportes</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Deudores</h1>
            <p className="mt-1 text-sm text-slate-500">Quién te debe y cuánto, empezando por lo vencido.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => bajar("xlsx")} disabled={!!bajando} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            {bajando === "xlsx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Excel
          </button>
          <button onClick={() => bajar("pdf")} disabled={!!bajando} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            {bajando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} PDF para cobrar
          </button>
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-[1.1fr_2fr]">
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Te deben</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{gs(t?.deuda ?? 0)}</p>
          <p className="mt-1 text-xs text-slate-500">
            {t?.clientes ?? 0} {t?.clientes === 1 ? "cliente" : "clientes"}
            {t && t.vencido > 0 ? <span className="font-semibold text-rose-600"> · vencido {gs(t.vencido)}</span> : null}
          </p>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {tramos.map(([l, v, c]) => (
            <div key={l} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{l}</p>
              <p className={`mt-1 text-sm font-bold tabular-nums ${v > 0 ? c : "text-slate-300"}`}>{gs(v)}</p>
            </div>
          ))}
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar cliente, RUC o teléfono…"
              className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]" />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={soloVencidos} onChange={(e) => setSoloVencidos(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />
            Solo los que tienen deuda vencida
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b-2 text-[11px] font-bold uppercase tracking-wider" style={{ borderColor: `${TEAL}26`, backgroundColor: `${TEAL}0d`, color: TEAL }}>
                <th className="px-5 py-3">Cliente</th>
                <th className="px-3 py-3 text-right">Debe</th>
                <th className="px-3 py-3 text-right">Vencido</th>
                <th className="px-3 py-3 text-right">Atraso</th>
                <th className="px-3 py-3">Último pago</th>
                <th className="w-px px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando && !data ? (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-slate-400">Cargando…</td></tr>
              ) : error ? (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-rose-600">{error}</td></tr>
              ) : filas.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-16 text-center text-sm text-slate-400">{busqueda ? "Ningún deudor coincide." : soloVencidos ? "Nadie tiene deuda vencida." : "Nadie te debe nada."}</td></tr>
              ) : (
                filas.map((f) => (
                  <tr key={f.id} className="hover:bg-[var(--brand-50)]">
                    <td className="px-5 py-3">
                      <Link href={`/clientes/${f.id}`} className="font-bold text-slate-900 hover:text-[var(--brand)]">{f.razon_social || f.nombre}</Link>
                      <p className="text-[11px] text-slate-500">
                        {f.telefono ? <a href={`tel:${f.telefono}`} className="hover:underline">{f.telefono}</a> : "sin teléfono"}
                        {f.cuentas > 1 ? ` · ${f.cuentas} ventas abiertas` : ""}
                        {Number(f.saldo_favor) > 0 ? <span className="text-emerald-700"> · a favor {gs(f.saldo_favor)}</span> : null}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-right font-bold tabular-nums text-slate-900">{gs(f.deuda)}</td>
                    <td className={`px-3 py-3 text-right tabular-nums ${Number(f.vencido) > 0 ? "font-semibold text-rose-600" : "text-slate-400"}`}>{Number(f.vencido) > 0 ? gs(f.vencido) : "—"}</td>
                    <td className={`px-3 py-3 text-right text-xs ${Number(f.max_atraso) > 0 ? "font-semibold text-rose-600" : "text-slate-500"}`}>{Number(f.max_atraso) > 0 ? `${f.max_atraso} días` : "al día"}</td>
                    <td className="px-3 py-3 text-xs text-slate-600">{f.ultimo_cobro ? <>{fecha(f.ultimo_cobro)}<span className="block text-slate-400">{gs(Number(f.ultimo_cobro_monto ?? 0))}</span></> : <span className="text-slate-400">nunca pagó</span>}</td>
                    <td className="px-5 py-3">
                      <button onClick={() => setCobrando({ id: f.id, nombre: f.razon_social || f.nombre })} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
                        <HandCoins className="h-3.5 w-3.5" /> Cobrar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {cobrando ? <RegistrarCobro clienteId={cobrando.id} clienteNombre={cobrando.nombre} onClose={() => setCobrando(null)} onHecho={cargar} /> : null}
    </div>
  );
}
