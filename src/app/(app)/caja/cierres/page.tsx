"use client";

/**
 * /caja/cierres — Reporte de cierres de caja (portado de Ferretería República).
 * Turnos del período con apertura, cierre, efectivo esperado vs. contado y diferencias.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Eye, FileSpreadsheet, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { GraficosCierres } from "@/modules/caja/GraficosCierres";
import { formatGs } from "@/modules/caja/lib";
import { estadoCajaLabel, type CajasReporte } from "@/modules/caja/reporte-cajas";

const TEAL = clienteConfig.color;
const TZ = "America/Asuncion";

const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const fechaHora = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("es-PY", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).replace(",", "")
    : "—";

/** Atajos de rango: Hoy, Últimos 7 días, Este mes, Mes anterior. */
function rangoAtajo(k: string): { desde: string; hasta: string } {
  const h = hoy();
  const [y, m] = h.split("-").map(Number);
  if (k === "hoy") return { desde: h, hasta: h };
  if (k === "7d") {
    const d = new Date(`${h}T12:00:00`);
    d.setDate(d.getDate() - 6);
    return { desde: d.toISOString().slice(0, 10), hasta: h };
  }
  if (k === "mes_ant") {
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    const ult = new Date(py, pm, 0).getDate();
    const mm = String(pm).padStart(2, "0");
    return { desde: `${py}-${mm}-01`, hasta: `${py}-${mm}-${ult}` };
  }
  return { desde: `${h.slice(0, 7)}-01`, hasta: h };
}

const ATAJOS: [string, string][] = [["hoy", "Hoy"], ["7d", "7 días"], ["mes", "Este mes"], ["mes_ant", "Mes anterior"]];

export default function CierresCajaPage() {
  const [desde, setDesde] = useState(() => rangoAtajo("mes").desde);
  const [hasta, setHasta] = useState(hoy);
  const [data, setData] = useState<CajasReporte | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtroCaja, setFiltroCaja] = useState("");
  const [exportando, setExportando] = useState(false);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    setError(null);
    apiFetch<CajasReporte>(`/api/reportes/cajas?desde=${desde}&hasta=${hasta}`)
      .then((d) => { if (!cancel) setData(d); })
      .catch((e: Error) => { if (!cancel) { setData(null); setError(e.message); } })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [desde, hasta]);

  const t = data?.totales;
  const numerosCajas = useMemo(() => [...new Set((data?.cajas ?? []).map((c) => c.numero_caja))].sort((a, b) => a - b), [data]);
  const cajas = (data?.cajas ?? []).filter((c) => filtroCaja === "" || String(c.numero_caja) === filtroCaja);
  const atajoActivo = [...ATAJOS].sort(([a]) => (a === "mes" ? -1 : 0)).find(([k]) => { const r = rangoAtajo(k); return r.desde === desde && r.hasta === hasta; })?.[0];

  async function exportar() {
    setExportando(true);
    try {
      await descargarArchivo(`/api/reportes/cajas/export?desde=${desde}&hasta=${hasta}`, `cierres-caja-${desde}_${hasta}.xlsx`);
    } catch { /* best-effort */ } finally {
      setExportando(false);
    }
  }

  const inputFecha = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";

  return (
    <div className="space-y-6 pb-10">
      {/* Encabezado */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Caja · Reportes</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Cierres de caja</h1>
          <p className="mt-1 text-sm text-slate-500">Arqueo de turnos: apertura, cierre, efectivo esperado vs. contado y diferencias.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2.5">
          <div className="flex rounded-xl border border-slate-200 bg-white p-0.5">
            {ATAJOS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => { const r = rangoAtajo(k); setDesde(r.desde); setHasta(r.hasta); }}
                className="rounded-[10px] px-3 py-1.5 text-xs font-semibold transition-colors"
                style={atajoActivo === k ? { backgroundColor: TEAL, color: "#fff" } : { color: "#64748b" }}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1">
            <span className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Desde</span>
            <input type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)} className={inputFecha} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Hasta</span>
            <input type="date" value={hasta} min={desde} onChange={(e) => e.target.value && setHasta(e.target.value)} className={inputFecha} />
          </label>
          {numerosCajas.length > 1 ? (
            <Select
              value={filtroCaja}
              onChange={setFiltroCaja}
              options={[["", "Todas las cajas"], ...numerosCajas.map((n): [string, string] => [String(n), `Caja ${n}`])]}
              minWidth={150}
            />
          ) : null}
          <button
            type="button"
            onClick={exportar}
            disabled={exportando || !data?.cajas.length}
            className="inline-flex h-[38px] items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors hover:bg-[var(--brand-50)] disabled:cursor-not-allowed disabled:opacity-50"
            style={{ borderColor: `${TEAL}55`, color: TEAL }}
          >
            {exportando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Exportar Excel
          </button>
        </div>
      </div>

      {cargando && !data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-[92px] animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
        </div>
      ) : error || !data || !t ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
          No se pudo cargar el reporte de caja{error ? `: ${error}` : "."}
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className={`grid grid-cols-2 gap-3 transition-opacity lg:grid-cols-4 ${cargando ? "opacity-60" : ""}`}>
            <Kpi accent label="Cajas en el período" value={String(t.cantidad_cajas)} hint={`${t.cajas_cerradas} cerradas · ${t.cajas_abiertas} abiertas`} />
            <Kpi label="Total vendido" value={formatGs(t.total_vendido)} hint={`${formatGs(t.total_efectivo)} efectivo · ${formatGs(t.total_credito)} crédito`} />
            <Kpi
              label="Diferencia neta"
              value={`${t.total_diferencia > 0 ? "+" : ""}${formatGs(t.total_diferencia)}`}
              valueClass={t.total_diferencia === 0 ? undefined : t.total_diferencia < 0 ? "text-red-600" : "text-amber-600"}
              hint={`${t.cajas_con_diferencia} caja(s) con diferencia`}
            />
            <Kpi label="Faltantes / Sobrantes" value={`${formatGs(t.faltantes)} / ${formatGs(t.sobrantes)}`} hint="faltante / sobrante acumulado" />
          </div>

          {/* Gráficos gerenciales (respetan el filtro de caja) */}
          <div className={`transition-opacity ${cargando ? "opacity-60" : ""}`}>
            <GraficosCierres data={data} cajas={cajas} />
          </div>

          {/* Detalle de turnos */}
          <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-opacity ${cargando ? "opacity-60" : ""}`}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="block h-5 w-1 rounded-full" style={{ backgroundColor: TEAL }} />
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">Detalle de turnos</h2>
              </div>
              <span className="text-sm text-slate-400">{cajas.length} turno(s)</span>
            </div>
            {cajas.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-400">No hay turnos de caja en el período seleccionado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs font-semibold text-slate-500">
                      {["Caja", "Apertura", "Cierre", "Estado", "Abrió / Cerró", "Apertura Gs.", "Ventas", "Vendido", "Efectivo", "Esperado", "Contado", "Diferencia"].map((h, i) => (
                        <th key={h} className={`whitespace-nowrap px-2.5 py-3 ${i === 0 ? "rounded-l-lg" : ""} ${i >= 5 ? "text-right" : ""}`}>{h}</th>
                      ))}
                      <th className="rounded-r-lg px-2.5 py-3 text-center">Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cajas.map((c) => {
                      const dif = c.diferencia;
                      const difClass = dif == null ? "text-slate-400" : dif === 0 ? "text-emerald-600" : dif < 0 ? "text-red-600" : "text-amber-600";
                      const cerrada = c.estado === "cerrada";
                      return (
                        <tr key={c.id} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50">
                          <td className="whitespace-nowrap px-2.5 py-3 text-xs font-bold" style={{ color: TEAL }}>Caja {c.numero_caja}</td>
                          <td className="whitespace-nowrap px-2.5 py-3 text-xs tabular-nums text-slate-600">{fechaHora(c.fecha_apertura)}</td>
                          <td className="whitespace-nowrap px-2.5 py-3 text-xs tabular-nums text-slate-600">{fechaHora(c.fecha_cierre)}</td>
                          <td className="px-2.5 py-3">
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cerrada ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>
                              {!cerrada && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                              {estadoCajaLabel(c.estado)}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-2.5 py-3 text-xs text-slate-600">
                            <span className="font-medium text-slate-800">{c.abierta_por_nombre ?? "—"}</span>
                            {cerrada && c.cerrada_por_nombre !== c.abierta_por_nombre && <span className="text-slate-400"> → {c.cerrada_por_nombre ?? "—"}</span>}
                          </td>
                          <td className="whitespace-nowrap px-2.5 py-3 text-right text-xs tabular-nums text-slate-600">{formatGs(c.monto_apertura)}</td>
                          <td className="whitespace-nowrap px-2.5 py-3 text-right text-xs tabular-nums text-slate-700">{c.cantidad_ventas}</td>
                          <td className="whitespace-nowrap px-2.5 py-3 text-right text-xs font-semibold tabular-nums text-slate-900">{formatGs(c.total_vendido)}</td>
                          <td className="whitespace-nowrap px-2.5 py-3 text-right text-xs tabular-nums text-slate-600">{formatGs(c.total_efectivo)}</td>
                          <td className="whitespace-nowrap px-2.5 py-3 text-right text-xs tabular-nums text-slate-700">{formatGs(c.efectivo_esperado)}</td>
                          <td className="whitespace-nowrap px-2.5 py-3 text-right text-xs tabular-nums text-slate-700">{c.monto_cierre_contado == null ? "—" : formatGs(c.monto_cierre_contado)}</td>
                          <td className={`whitespace-nowrap px-2.5 py-3 text-right text-xs font-bold tabular-nums ${difClass}`}>
                            {dif == null ? "—" : (dif > 0 ? "+" : "") + formatGs(dif)}
                          </td>
                          <td className="px-2.5 py-3 text-center">
                            <Link
                              href={`/caja/cierres/${c.id}`}
                              className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--brand-50)]"
                              style={{ borderColor: `${TEAL}55`, color: TEAL }}
                            >
                              <Eye className="h-3.5 w-3.5" /> Ver
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, hint, accent, valueClass }: { label: string; value: string; hint?: string; accent?: boolean; valueClass?: string }) {
  return (
    <div
      className="rounded-2xl border bg-white p-4 shadow-sm"
      style={accent ? { borderColor: `${TEAL}55`, backgroundColor: "var(--brand-50)" } : { borderColor: "#e2e8f0" }}
    >
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${valueClass ?? "text-slate-900"}`} style={accent && !valueClass ? { color: TEAL } : undefined}>{value}</p>
      {hint ? <p className="mt-0.5 truncate text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}
