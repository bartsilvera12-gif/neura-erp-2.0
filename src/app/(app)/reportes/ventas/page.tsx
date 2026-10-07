"use client";

/**
 * /reportes/ventas — "Ventas del período": cuánto se vendió, cuánto se ganó, cómo se
 * cobró, qué se vende, quién vendió y cuánto IVA hay que declarar. Todo se calcula en la
 * base (reporte_ventas_resumen / reporte_ventas_detalle); acá solo se muestra.
 * Sin gráficos (pedido del usuario): números claros + tablas. Excel y PDF con los filtros.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, FileSpreadsheet, FileText, Loader2, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { VentaDetalle } from "@/modules/caja/VentaDetalle";
import { CorregirCostos } from "@/modules/reportes/CorregirCostos";
import type { Categoria } from "@/modules/inventario/categorias";
import type { ResumenVentas, VentaDetalle as FilaVenta } from "@/modules/reportes/server/ventas";

const TEAL = clienteConfig.color;
const TZ = "America/Asuncion";
const POR_PAGINA = 25;

const MEDIO: Record<string, string> = {
  efectivo: "Efectivo", tarjeta: "Tarjeta", pos: "POS", transferencia: "Transferencia", cheque: "Cheque", otro: "Otros", credito: "Crédito",
};
const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const num = (v: number) => Number(v || 0).toLocaleString("es-PY", { maximumFractionDigits: 3 });
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
const margenColor = (a: number, b: number) => {
  const m = b ? (a / b) * 100 : 0;
  return m >= 40 ? "text-emerald-600" : m >= 20 ? "text-amber-600" : "text-red-600";
};
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const diaCorto = (s: string) => {
  const d = new Date(`${s}T12:00:00Z`);
  return d.toLocaleDateString("es-PY", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });
};
const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-PY", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).replace(",", "");

function rangoAtajo(k: string) {
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
    const mm = String(pm).padStart(2, "0");
    return { desde: `${py}-${mm}-01`, hasta: `${py}-${mm}-${new Date(py, pm, 0).getDate()}` };
  }
  return { desde: `${h.slice(0, 7)}-01`, hasta: h };
}
const ATAJOS: [string, string][] = [["hoy", "Hoy"], ["7d", "7 días"], ["mes", "Este mes"], ["mes_ant", "Mes anterior"]];

export default function ReporteVentasPage() {
  const [desde, setDesde] = useState(() => rangoAtajo("mes").desde);
  const [hasta, setHasta] = useState(hoy);
  const [atajo, setAtajo] = useState<string | null>("mes");
  const [cajero, setCajero] = useState("");
  const [tipo, setTipo] = useState("");
  const [medio, setMedio] = useState("");
  const [categoria, setCategoria] = useState("");

  const [resumen, setResumen] = useState<ResumenVentas | null>(null);
  const [cajeros, setCajeros] = useState<{ id: string; nombre: string }[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [ventas, setVentas] = useState<FilaVenta[]>([]);
  const [totalVentas, setTotalVentas] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [cargandoDet, setCargandoDet] = useState(true);
  const [verTodosProd, setVerTodosProd] = useState(false);
  const [viendo, setViendo] = useState<string | null>(null);
  const [bajando, setBajando] = useState<"" | "xlsx" | "pdf">("");
  const [recarga, setRecarga] = useState(0);
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ categorias: Categoria[] }>("/api/inventario/categorias").then((r) => setCategorias(r.categorias)).catch(() => {});
  }, []);

  const filtros = useMemo(() => {
    const sp = new URLSearchParams({ desde, hasta });
    if (cajero) sp.set("cajero", cajero);
    if (tipo) sp.set("tipo", tipo);
    if (medio) sp.set("medio", medio);
    if (categoria) sp.set("categoria", categoria);
    return sp.toString();
  }, [desde, hasta, cajero, tipo, medio, categoria]);

  useEffect(() => { setPagina(1); }, [filtros]);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    setError(null);
    apiFetch<{ resumen: ResumenVentas; cajeros: { id: string; nombre: string }[] }>(`/api/reportes/ventas?${filtros}`)
      .then((r) => { if (!cancel) { setResumen(r.resumen); setCajeros(r.cajeros); } })
      .catch((e: Error) => { if (!cancel) setError(e.message); })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [filtros, recarga]);

  useEffect(() => {
    let cancel = false;
    setCargandoDet(true);
    apiFetch<{ total: number; rows: FilaVenta[] }>(`/api/reportes/ventas/detalle?${filtros}&pagina=${pagina}&por_pagina=${POR_PAGINA}`)
      .then((r) => { if (!cancel) { setVentas(r.rows); setTotalVentas(r.total); } })
      .catch(() => { if (!cancel) { setVentas([]); setTotalVentas(0); } })
      .finally(() => { if (!cancel) setCargandoDet(false); });
    return () => { cancel = true; };
  }, [filtros, pagina, recarga]);

  async function bajar(formato: "xlsx" | "pdf") {
    setBajando(formato);
    try {
      await descargarArchivo(`/api/reportes/ventas/${formato === "xlsx" ? "export" : "pdf"}?${filtros}`, `ventas.${formato}`);
    } catch {
      /* best-effort */
    } finally {
      setBajando("");
    }
  }

  const k = resumen?.kpis;
  const ticket = k && k.cantidad_ventas ? k.ventas_netas / k.cantidad_ventas : 0;
  const totalMedios = resumen?.por_medio.reduce((a, m) => a + Number(m.monto), 0) ?? 0;
  const hayFiltrosExtra = !!(cajero || tipo || medio || categoria);
  const totalPaginas = Math.max(1, Math.ceil(totalVentas / POR_PAGINA));
  const productos = verTodosProd ? resumen?.productos ?? [] : (resumen?.productos ?? []).slice(0, 10);
  const inputFecha = "h-[38px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";

  return (
    <div className="space-y-6 pb-10">
      {/* Encabezado */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/reportes" className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-800">
            <ArrowLeft className="h-3.5 w-3.5" /> Reportes
          </Link>
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Reportes · Ventas</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Ventas del período</h1>
          <p className="mt-1 text-sm text-slate-500">Cuánto se vendió y se ganó, cómo se cobró, qué se vende y quién vendió.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => bajar("xlsx")} disabled={!!bajando || !k?.cantidad_ventas} className="inline-flex h-[38px] items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition hover:bg-[var(--brand-50)] disabled:opacity-50" style={{ borderColor: `${TEAL}55`, color: TEAL }}>
            {bajando === "xlsx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Exportar Excel
          </button>
          <button onClick={() => bajar("pdf")} disabled={!!bajando || !k?.cantidad_ventas} className="inline-flex h-[38px] items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50" style={{ backgroundColor: TEAL }}>
            {bajando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Descargar PDF
          </button>
        </div>
      </div>

      {/* Filtros */}
      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-2.5">
          <div className="flex rounded-xl border border-slate-200 bg-white p-0.5">
            {ATAJOS.map(([key, label]) => (
              <button key={key} type="button" onClick={() => { const r = rangoAtajo(key); setDesde(r.desde); setHasta(r.hasta); setAtajo(key); }}
                className="rounded-[10px] px-3 py-1.5 text-xs font-semibold transition-colors"
                style={atajo === key ? { backgroundColor: TEAL, color: "#fff" } : { color: "#64748b" }}>
                {label}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1">
            <span className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Desde</span>
            <input type="date" value={desde} max={hasta} onChange={(e) => { if (e.target.value) { setDesde(e.target.value); setAtajo(null); } }} className={inputFecha} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Hasta</span>
            <input type="date" value={hasta} min={desde} onChange={(e) => { if (e.target.value) { setHasta(e.target.value); setAtajo(null); } }} className={inputFecha} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Select value={cajero} onChange={setCajero} minWidth={170} options={[["", "Todos los cajeros"], ...cajeros.map((c): [string, string] => [c.id, c.nombre])]} />
          <Select value={tipo} onChange={setTipo} minWidth={150} options={[["", "Contado y crédito"], ["CONTADO", "Solo contado"], ["CREDITO", "Solo crédito"]]} />
          <Select value={medio} onChange={setMedio} minWidth={170} options={[["", "Todos los medios"], ...Object.entries(MEDIO).map(([v, l]): [string, string] => [v, l])]} />
          <Select value={categoria} onChange={setCategoria} minWidth={190} options={[["", "Todas las categorías"], ["__sin__", "— Sin categoría —"], ...categorias.map((c): [string, string] => [c.id, c.nombre])]} />
          {hayFiltrosExtra ? (
            <button onClick={() => { setCajero(""); setTipo(""); setMedio(""); setCategoria(""); }} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800">
              <X className="h-3.5 w-3.5" /> Limpiar filtros
            </button>
          ) : null}
        </div>
        {medio || categoria ? (
          <p className="text-[11px] text-slate-400">
            {medio ? "Con filtro de medio se incluyen las ventas que usaron ese medio (con su monto total). " : ""}
            {categoria ? "Con filtro de categoría, los montos son solo de los productos de esa categoría." : ""}
          </p>
        ) : null}
      </section>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">No se pudo cargar el reporte: {error}</div> : null}

      {!k ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-[92px] animate-pulse rounded-2xl border border-slate-200 bg-white" />)}</div>
      ) : (
        <div className={`space-y-6 transition-opacity ${cargando ? "opacity-60" : ""}`}>
          {/* Números clave */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi accent label="Ventas netas" value={gs(k.ventas_netas)} hint={`${num(k.cantidad_ventas)} venta(s) · ${num(k.unidades)} unidades`} />
            <Kpi label="Ticket promedio" value={gs(ticket)} hint="por venta" />
            <Kpi label="Ganancia bruta" value={gs(k.ganancia)} hint={`${pct(k.ganancia, k.ventas_netas)} sobre ventas`} valueClass={k.ganancia < 0 ? "text-red-600" : undefined} />
            <Kpi label="IVA incluido" value={gs(k.iva_total)} hint={(resumen.iva ?? []).map((t) => `${t.tipo === "EXENTA" ? "Exentas" : t.tipo} ${gs(t.total)}`).join(" · ") || "—"} />
            <Kpi label="Anuladas" value={num(resumen.anuladas.cantidad)} hint={gs(resumen.anuladas.monto)} valueClass={resumen.anuladas.cantidad ? "text-red-600" : undefined} />
          </div>

          {k.productos_sin_costo ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
              <span className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span><strong>{k.productos_sin_costo} producto(s) vendidos sin costo</strong> · la ganancia está sobreestimada</span>
              </span>
              <button onClick={() => setCorrigiendo(true)} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700">
                Corregir costos
              </button>
            </div>
          ) : null}
          {aviso ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
              <span>{aviso}</span>
              <button onClick={() => setAviso(null)} aria-label="Cerrar aviso" className="rounded p-0.5 text-emerald-600 hover:bg-emerald-100"><X className="h-4 w-4" /></button>
            </div>
          ) : null}

          {k.cantidad_ventas === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400 shadow-sm">No hay ventas con estos filtros.</div>
          ) : (
            <>
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Medios de pago */}
                <Tarjeta titulo="Por medio de pago">
                  <Tabla
                    cols={["Medio", "Ventas", "Monto", "%"]}
                    der={[1, 2, 3]}
                    filas={resumen.por_medio.map((m) => [MEDIO[m.medio] ?? m.medio, num(m.ventas), gs(m.monto), pct(m.monto, totalMedios)])}
                    pie={["Total", "", gs(totalMedios), "100%"]}
                  />
                </Tarjeta>
                {/* Cajeros */}
                <Tarjeta titulo="Por cajero">
                  <Tabla
                    cols={["Cajero", "Ventas", "Monto", "Ticket prom.", "Anuladas"]}
                    der={[1, 2, 3, 4]}
                    filas={resumen.por_cajero.map((c) => [c.nombre, num(c.cantidad), gs(c.ventas), gs(c.cantidad ? c.ventas / c.cantidad : 0), c.anuladas ? <span key="a" className="font-semibold text-red-600">{c.anuladas}</span> : "0"])}
                  />
                </Tarjeta>
              </div>

              {/* Productos */}
              <Tarjeta titulo="Productos más vendidos" extra={resumen.productos.length > 10 ? (
                <button onClick={() => setVerTodosProd((v) => !v)} className="text-xs font-semibold hover:underline" style={{ color: TEAL }}>
                  {verTodosProd ? "Ver top 10" : `Ver los ${resumen.productos.length}`}
                </button>
              ) : null}>
                <Tabla
                  cols={["#", "Producto", "SKU", "Unidades", "Monto", "Ganancia", "Margen"]}
                  der={[0, 3, 4, 5, 6]}
                  filas={productos.map((p, i) => [
                    i + 1,
                    <span key="n" className="font-medium text-slate-800">{p.nombre}{p.sin_costo ? <span className="ml-1 font-bold text-amber-600" title="Vendido al menos una vez sin costo cargado">*</span> : null}</span>,
                    <span key="s" className="font-mono text-xs text-slate-500">{p.sku ?? "—"}</span>,
                    num(p.unidades),
                    gs(p.monto),
                    gs(p.ganancia),
                    <span key="m" className={`font-semibold ${margenColor(p.ganancia, p.monto)}`}>{pct(p.ganancia, p.monto)}</span>,
                  ])}
                />
              </Tarjeta>

              <div className="grid gap-6 lg:grid-cols-2">
                {/* Por día */}
                <Tarjeta titulo="Por día">
                  <Tabla
                    cols={["Día", "Ventas", "Monto", "Ticket prom.", "Ganancia"]}
                    der={[1, 2, 3, 4]}
                    filas={resumen.por_dia.map((d) => [<span key="d" className="capitalize">{diaCorto(d.dia)}</span>, num(d.cantidad), gs(d.ventas), gs(d.cantidad ? d.ventas / d.cantidad : 0), gs(d.ganancia)])}
                  />
                </Tarjeta>
                {/* Categorías */}
                <Tarjeta titulo="Por categoría">
                  <Tabla
                    cols={["Categoría", "Unidades", "Monto", "%", "Margen"]}
                    der={[1, 2, 3, 4]}
                    filas={resumen.por_categoria.map((c) => [c.nombre, num(c.unidades), gs(c.monto), pct(c.monto, k.ventas_netas), <span key="m" className={`font-semibold ${margenColor(c.ganancia, c.monto)}`}>{pct(c.ganancia, c.monto)}</span>])}
                  />
                </Tarjeta>
              </div>
            </>
          )}
        </div>
      )}

      {/* Detalle de ventas */}
      <Tarjeta titulo="Detalle de ventas" extra={<span className="text-sm text-slate-400">{num(totalVentas)} venta(s)</span>}>
        <div className={`overflow-x-auto transition-opacity ${cargandoDet ? "opacity-60" : ""}`}>
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs font-semibold text-slate-500">
                {["Número", "Fecha", "Cliente", "Cajero", "Tipo", "Medio de pago", "Ítems", "Total", "Ganancia"].map((h, i) => (
                  <th key={h} className={`whitespace-nowrap px-3 py-3 ${i === 0 ? "rounded-l-lg" : ""} ${i === 8 ? "rounded-r-lg" : ""} ${i >= 6 ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ventas.length === 0 ? (
                <tr><td colSpan={9} className="py-10 text-center text-slate-400">{cargandoDet ? "Cargando…" : "No hay ventas con estos filtros."}</td></tr>
              ) : (
                ventas.map((v) => {
                  const anulada = v.estado === "anulada";
                  return (
                    <tr key={v.id} onClick={() => setViendo(v.id)} title="Ver el detalle de la venta" className={`cursor-pointer border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50 ${anulada ? "opacity-60" : ""}`}>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-600">
                        {v.numero}
                        {anulada ? <span className="ml-1.5 rounded-full bg-red-50 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-red-600">Anulada</span> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs tabular-nums text-slate-500">{fechaHora(v.fecha)}</td>
                      <td className="max-w-[180px] truncate px-3 py-3 text-slate-700">{v.cliente ?? <span className="text-slate-300">Sin cliente</span>}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-slate-600">{v.cajero ?? "—"}</td>
                      <td className="px-3 py-3">
                        <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={v.tipo === "CREDITO" ? { backgroundColor: "#fff7ed", color: "#ea580c" } : { backgroundColor: "#f1f5f9", color: "#475569" }}>
                          {v.tipo === "CREDITO" ? "Crédito" : "Contado"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600">{v.medios.map((m) => MEDIO[m] ?? m).join(" + ")}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-600">{v.items}</td>
                      <td className={`whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums ${anulada ? "text-slate-400 line-through" : "text-slate-900"}`}>{gs(v.total)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-slate-600">{anulada ? "—" : gs(v.ganancia)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {totalVentas > POR_PAGINA ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <span className="text-sm text-slate-500">
              Mostrando <strong className="font-semibold text-slate-700">{(pagina - 1) * POR_PAGINA + 1}–{Math.min(pagina * POR_PAGINA, totalVentas)}</strong> de <strong className="font-semibold text-slate-700">{num(totalVentas)}</strong>
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={pagina <= 1} aria-label="Página anterior" className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
              <span className="min-w-[110px] text-center text-sm tabular-nums text-slate-600">Página <strong className="text-slate-800">{pagina}</strong> de {totalPaginas}</span>
              <button onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={pagina >= totalPaginas} aria-label="Página siguiente" className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        ) : null}
      </Tarjeta>

      {corrigiendo && resumen ? (
        <CorregirCostos
          productos={resumen.productos.filter((p) => p.sin_costo)}
          onClose={() => setCorrigiendo(false)}
          onListo={(msg) => { setCorrigiendo(false); setAviso(msg); setRecarga((n) => n + 1); }}
        />
      ) : null}

      {viendo ? <VentaDetalle ventaId={viendo} onClose={() => setViendo(null)} onAnulada={() => { setViendo(null); setRecarga((n) => n + 1); }} /> : null}
    </div>
  );
}

function Kpi({ label, value, hint, accent, valueClass }: { label: string; value: string; hint?: string; accent?: boolean; valueClass?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-white p-4 shadow-sm" style={accent ? { borderColor: `${TEAL}55`, backgroundColor: "var(--brand-50)" } : { borderColor: "#e2e8f0" }}>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <p className={`mt-1 truncate text-xl font-semibold tabular-nums ${valueClass ?? "text-slate-900"}`} style={accent && !valueClass ? { color: TEAL } : undefined}>{value}</p>
      {hint ? <p className="mt-0.5 truncate text-xs text-slate-400" title={hint}>{hint}</p> : null}
    </div>
  );
}

function Tarjeta({ titulo, extra, children }: { titulo: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="block h-5 w-1 rounded-full" style={{ backgroundColor: TEAL }} />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">{titulo}</h2>
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}

function Tabla({ cols, filas, der, pie }: { cols: string[]; filas: React.ReactNode[][]; der: number[]; pie?: React.ReactNode[] }) {
  if (!filas.length) return <p className="py-6 text-center text-sm text-slate-400">Sin datos.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="bg-slate-50 text-xs font-semibold text-slate-500">
            {cols.map((c, i) => (
              <th key={c} className={`whitespace-nowrap px-3 py-2.5 ${i === 0 ? "rounded-l-lg" : ""} ${i === cols.length - 1 ? "rounded-r-lg" : ""} ${der.includes(i) ? "text-right" : ""}`}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, r) => (
            <tr key={r} className="border-b border-slate-100 last:border-0">
              {f.map((c, i) => (
                <td key={i} className={`whitespace-nowrap px-3 py-2.5 ${der.includes(i) ? "text-right tabular-nums" : ""} ${i === 0 ? "text-slate-800" : "text-slate-600"}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {pie ? (
          <tfoot>
            <tr className="border-t-2 border-slate-200 font-semibold text-slate-900">
              {pie.map((c, i) => <td key={i} className={`px-3 py-2.5 ${der.includes(i) ? "text-right tabular-nums" : ""}`}>{c}</td>)}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
