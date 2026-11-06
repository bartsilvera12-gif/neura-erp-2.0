"use client";

/** /comedor/liquidacion — Liquidación mensual por funcionario (subsidio / excedente / diferencia), con PDF y Excel. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { Select } from "@/components/Select";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { Download, FileText, Loader2 } from "lucide-react";
import type { Liquidacion } from "@/modules/comedor/liquidacion-server";

type Empresa = { id: string; nombre: string };
const gs = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-PY");

function primeroMes() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); }
function hoy() { return new Date().toISOString().slice(0, 10); }

export default function LiquidacionPage() {
  const [desde, setDesde] = useState(primeroMes);
  const [hasta, setHasta] = useState(hoy);
  const [empresa, setEmpresa] = useState("");
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [data, setData] = useState<Liquidacion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bajando, setBajando] = useState<"pdf" | "excel" | null>(null);

  useEffect(() => { void apiFetch<Empresa[]>("/api/comedor/empresas").then(setEmpresas).catch(() => {}); }, []);

  const qs = useMemo(() => {
    const sp = new URLSearchParams({ desde, hasta });
    if (empresa) sp.set("empresa", empresa);
    return sp.toString();
  }, [desde, hasta, empresa]);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try { setData(await apiFetch<Liquidacion>(`/api/comedor/liquidacion?${qs}`)); }
    catch (e) { setError((e as Error).message); }
    finally { setCargando(false); }
  }, [qs]);

  useEffect(() => { const t = setTimeout(() => void cargar(), 200); return () => clearTimeout(t); }, [cargar]);

  async function bajar(tipo: "pdf" | "excel") {
    setBajando(tipo);
    try {
      const url = tipo === "pdf" ? `/api/comedor/liquidacion/pdf?${qs}` : `/api/comedor/liquidacion/export?${qs}`;
      await descargarArchivo(url, `liquidacion-comedor.${tipo === "pdf" ? "pdf" : "xlsx"}`);
    } catch (e) { setError((e as Error).message); }
    finally { setBajando(null); }
  }

  const t = data?.totales;

  return (
    <div className="space-y-5">
      <EncabezadoPagina
        kicker="Comedor"
        titulo="Liquidación"
        subtitulo="Lo que se le liquida a la empresa en el período: subsidio, excedente (a recuperar del funcionario) y diferencia de menús especiales."
        volver={{ href: "/comedor/panel", label: "Comedor" }}
        acciones={
          <div className="flex gap-2">
            <button onClick={() => void bajar("excel")} disabled={bajando !== null || !data} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {bajando === "excel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Excel
            </button>
            <button onClick={() => void bajar("pdf")} disabled={bajando !== null || !data} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {bajando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} PDF
            </button>
          </div>
        }
      />

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">Desde</span><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="min-h-11 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[var(--brand)]" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="min-h-11 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[var(--brand)]" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">Empresa</span>
          <Select value={empresa} onChange={setEmpresa} options={[["", "Todas"], ...empresas.map((e) => [e.id, e.nombre] as [string, string])]} />
        </label>
      </div>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      {t ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Funcionarios" valor={t.funcionarios} />
          <Kpi label="Subsidio" valor={`Gs ${gs(t.subsidio)}`} />
          <Kpi label="Excedente" valor={`Gs ${gs(t.excedente)}`} />
          <Kpi label="Total a la empresa" valor={`Gs ${gs(t.total)}`} destacado />
        </div>
      ) : null}

      {cargando && !data ? (
        <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
      ) : data && data.rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center text-sm text-slate-500">No hubo consumos ni reservas en este período.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Funcionario</th><th className="px-3 py-2 text-left">CI</th>
                <th className="px-3 py-2 text-right">Reservas</th><th className="px-3 py-2 text-right">Almuerzos</th><th className="px-3 py-2 text-right">Cantina</th>
                <th className="px-3 py-2 text-right">Subsidio</th><th className="px-3 py-2 text-right">Excedente</th><th className="px-3 py-2 text-right">Dif. esp.</th><th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((f) => (
                <tr key={f.funcionario_id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-800">{f.funcionario}</td>
                  <td className="px-3 py-2 text-slate-500">{f.documento ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.reservas}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.almuerzos}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.cantina_items}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{gs(f.subsidio)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-amber-700">{gs(f.excedente)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{gs(f.diferencia)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-[var(--brand-700)]">{gs(f.total)}</td>
                </tr>
              ))}
            </tbody>
            {t ? (
              <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <tr>
                  <td className="px-3 py-2" colSpan={3}>Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.almuerzos}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.cantina_items}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{gs(t.subsidio)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{gs(t.excedente)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{gs(t.diferencia)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--brand-700)]">{gs(t.total)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, valor, destacado }: { label: string; valor: string | number; destacado?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${destacado ? "border-[var(--brand)]/30 bg-[var(--brand-50)]" : "border-slate-200 bg-white"}`}>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 text-lg font-bold tabular-nums ${destacado ? "text-[var(--brand-700)]" : "text-slate-800"}`}>{valor}</p>
    </div>
  );
}
