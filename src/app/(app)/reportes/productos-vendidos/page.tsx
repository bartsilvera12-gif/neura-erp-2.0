"use client";

/**
 * /reportes/productos-vendidos — cuánto se vendió de cada producto (portado de Ferretería
 * República). Resumido (por producto) o Detallado (cada venta). Suma: precio promedio,
 * ganancia y margen, stock actual, columnas ordenables, productos SIN ventas con su stock
 * inmovilizado, atajos de fecha, Excel y PDF.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Boxes, ChevronLeft, ChevronRight, FileSpreadsheet, FileText, Loader2, Search, X } from "lucide-react";
import { filtrar } from "@/lib/busqueda";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchCache } from "@/lib/api/cache-cliente";
import { descargarArchivo } from "@/lib/api/client-blob";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { VentaDetalle } from "@/modules/caja/VentaDetalle";
import { opcionesFiltroCategoria, type Categoria } from "@/modules/inventario/categorias";
import type { ItemProducto, LineaProducto, ResumenProductos } from "@/modules/reportes/server/productos";

const TEAL = clienteConfig.color;
const TZ = "America/Asuncion";
const POR_PAGINA = 50;
const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const num = (v: number) => Number(v || 0).toLocaleString("es-PY", { maximumFractionDigits: 3 });
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
const margenColor = (a: number, b: number) => {
  const m = b ? (a / b) * 100 : 0;
  return m >= 40 ? "text-emerald-600" : m >= 20 ? "text-amber-600" : "text-red-600";
};
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
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

type Orden = "unidades" | "total" | "ganancia" | "margen" | "nombre" | "stock";

export default function ProductosVendidosPage() {
  const [desde, setDesde] = useState(() => rangoAtajo("mes").desde);
  const [hasta, setHasta] = useState(hoy);
  const [atajo, setAtajo] = useState<string | null>("mes");
  const [categoria, setCategoria] = useState("");
  const [modo, setModo] = useState<"resumido" | "detallado">("resumido");
  const [sinVentas, setSinVentas] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [orden, setOrden] = useState<{ campo: Orden; desc: boolean }>({ campo: "unidades", desc: true });
  const [categorias, setCategorias] = useState<Categoria[]>([]);

  const [resumen, setResumen] = useState<ResumenProductos | null>(null);
  const [lineas, setLineas] = useState<LineaProducto[]>([]);
  const [totalLineas, setTotalLineas] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bajando, setBajando] = useState<"" | "xlsx" | "pdf">("");
  const [viendo, setViendo] = useState<string | null>(null);

  useEffect(() => {
    apiFetchCache<{ categorias: Categoria[] }>("/api/inventario/categorias").then((r) => setCategorias(r.categorias)).catch(() => {});
  }, []);

  const filtros = useMemo(() => {
    const sp = new URLSearchParams({ desde, hasta });
    if (categoria) sp.set("categoria", categoria);
    if (sinVentas) sp.set("sin_ventas", "1");
    return sp.toString();
  }, [desde, hasta, categoria, sinVentas]);

  // En el detallado la búsqueda la hace la base sobre TODAS las líneas del período
  // (no solo la página visible), con debounce.
  const [qDetalle, setQDetalle] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setQDetalle(busqueda.trim()), 300);
    return () => clearTimeout(h);
  }, [busqueda]);

  useEffect(() => { setPagina(1); }, [filtros, modo, qDetalle]);

  // El resumen se usa siempre (cifras de arriba); el detalle solo en modo detallado.
  useEffect(() => {
    let cancel = false;
    setCargando(true);
    setError(null);
    apiFetch<ResumenProductos>(`/api/reportes/productos-vendidos?${filtros}`)
      .then((r) => { if (!cancel) setResumen(r); })
      .catch((e: Error) => { if (!cancel) setError(e.message); })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [filtros]);

  useEffect(() => {
    if (modo !== "detallado") return;
    let cancel = false;
    const qs = qDetalle ? `&q=${encodeURIComponent(qDetalle)}` : "";
    apiFetch<{ total: number; rows: LineaProducto[] }>(`/api/reportes/productos-vendidos?${filtros}&modo=detallado&pagina=${pagina}&por_pagina=${POR_PAGINA}${qs}`)
      .then((r) => { if (!cancel) { setLineas(r.rows); setTotalLineas(r.total); } })
      .catch(() => { if (!cancel) { setLineas([]); setTotalLineas(0); } });
    return () => { cancel = true; };
  }, [filtros, modo, pagina, qDetalle]);

  async function bajar(f: "xlsx" | "pdf") {
    setBajando(f);
    try {
      await descargarArchivo(`/api/reportes/productos-vendidos/${f === "xlsx" ? "export" : "pdf"}?${filtros}`, `productos-vendidos.${f}`);
    } catch {
      /* best-effort */
    } finally {
      setBajando("");
    }
  }

  const items = useMemo(() => {
    // Búsqueda inteligente; después se ordena por la columna elegida.
    const base = filtrar(resumen?.items ?? [], busqueda, (i) => ({ principal: i.nombre, otros: [i.categoria], codigos: [i.sku] }));
    const val = (i: ItemProducto): number | string => {
      switch (orden.campo) {
        case "nombre": return i.nombre.toLowerCase();
        case "total": return Number(i.total);
        case "ganancia": return Number(i.ganancia);
        case "margen": return Number(i.total) ? Number(i.ganancia) / Number(i.total) : -1;
        case "stock": return Number(i.stock_actual ?? -1);
        default: return Number(i.unidades);
      }
    };
    return [...base].sort((a, b) => {
      const x = val(a), y = val(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return orden.desc ? -c : c;
    });
  }, [resumen, busqueda, orden]);
  const lineasF = lineas;

  const t = resumen?.totales;
  const totalPaginas = Math.max(1, Math.ceil(totalLineas / POR_PAGINA));
  const inputFecha = "h-[38px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";

  const Th = ({ campo, children, der }: { campo: Orden; children: React.ReactNode; der?: boolean }) => {
    const act = orden.campo === campo;
    return (
      <th className={`px-3 py-3 font-semibold ${der ? "text-right" : ""}`}>
        <button type="button" onClick={() => setOrden((o) => ({ campo, desc: o.campo === campo ? !o.desc : campo !== "nombre" }))}
          className={`inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-slate-800 ${act ? "text-slate-800" : ""}`}>
          {children}
          {act ? (orden.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : null}
        </button>
      </th>
    );
  };

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
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Reportes · Productos</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Productos vendidos</h1>
          <p className="mt-1 text-sm text-slate-500">Cuánto se vendió de cada producto. Resumido (por producto) o detallado (cada venta).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => bajar("xlsx")} disabled={!!bajando || !resumen?.items.length} className="inline-flex h-[38px] items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition hover:bg-[var(--brand-50)] disabled:opacity-50" style={{ borderColor: `${TEAL}55`, color: TEAL }}>
            {bajando === "xlsx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Exportar Excel
          </button>
          <button onClick={() => bajar("pdf")} disabled={!!bajando || !resumen?.items.length} className="inline-flex h-[38px] items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50" style={{ backgroundColor: TEAL }}>
            {bajando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Descargar PDF
          </button>
        </div>
      </div>

      {/* Filtros */}
      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-2.5">
          <div className="flex rounded-xl border border-slate-200 bg-white p-0.5">
            {ATAJOS.map(([k, l]) => (
              <button key={k} type="button" onClick={() => { const r = rangoAtajo(k); setDesde(r.desde); setHasta(r.hasta); setAtajo(k); }}
                className="rounded-[10px] px-3 py-1.5 text-xs font-semibold transition-colors" style={atajo === k ? { backgroundColor: TEAL, color: "#fff" } : { color: "#64748b" }}>
                {l}
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
          <div className="ml-auto flex rounded-xl border border-slate-200 bg-white p-0.5">
            {([["resumido", "Resumido"], ["detallado", "Detallado"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setModo(k)} className="rounded-[10px] px-3 py-1.5 text-xs font-semibold transition-colors" style={modo === k ? { backgroundColor: TEAL, color: "#fff" } : { color: "#64748b" }}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative w-full max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder={modo === "resumido" ? "Filtrar por producto, SKU o categoría…" : "Filtrar por producto, venta, cliente o cajero…"}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-9 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]" />
            {busqueda ? <button onClick={() => setBusqueda("")} aria-label="Limpiar" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100"><X className="h-3.5 w-3.5" /></button> : null}
          </div>
          <Select value={categoria} onChange={setCategoria} minWidth={190} options={[["", "Todas las categorías"], ["__sin__", "— Sin categoría —"], ...opcionesFiltroCategoria(categorias)]} />
          {modo === "resumido" ? (
            <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-600" title="Suma los productos activos que no tuvieron ninguna venta en el período">
              <input type="checkbox" checked={sinVentas} onChange={(e) => setSinVentas(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Incluir productos sin ventas
            </label>
          ) : null}
        </div>
      </section>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">No se pudo cargar el reporte: {error}</div> : null}

      {/* Cifras */}
      <div className={`grid grid-cols-2 gap-3 transition-opacity lg:grid-cols-4 ${cargando ? "opacity-60" : ""}`}>
        <Cifra accent label="Productos vendidos" value={t ? num(t.productos_vendidos) : "—"} hint={t ? `${num(t.unidades)} unidades` : ""} />
        <Cifra label="Total vendido" value={t ? gs(t.total) : "—"} />
        <Cifra label="Ganancia" value={t ? gs(t.ganancia) : "—"} hint={t ? `${pct(t.ganancia, t.total)} sobre ventas` : ""} />
        <Cifra label="Sin ventas" value={sinVentas && t ? num(t.productos_sin_ventas) : "—"} hint={sinVentas && t ? `${gs(t.valor_stock_sin_ventas)} en stock inmovilizado` : "marcá «Incluir productos sin ventas»"} valueClass={sinVentas && t?.productos_sin_ventas ? "text-amber-600" : undefined} />
      </div>

      {/* Tabla */}
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}33` }}>
        <div className="flex items-center gap-2 border-b px-5 py-3.5" style={{ borderColor: `${TEAL}22`, background: `linear-gradient(to right, ${TEAL}0d, transparent)` }}>
          <Boxes className="h-4 w-4" style={{ color: TEAL }} />
          <h2 className="text-[15px] font-bold text-slate-800">{modo === "resumido" ? "Resumen por producto" : "Detalle de ventas"}</h2>
          {cargando ? <Loader2 className="h-4 w-4 animate-spin" style={{ color: TEAL }} /> : (
            <span className="text-xs text-slate-400">{modo === "resumido" ? `${items.length} producto${items.length === 1 ? "" : "s"}` : `${num(totalLineas)} línea(s)`}</span>
          )}
        </div>

        {modo === "resumido" ? (
          items.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-slate-400">{cargando ? "Cargando…" : "Sin ventas para los filtros seleccionados."}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500">
                    <Th campo="nombre">Producto</Th>
                    <th className="px-3 py-3 font-semibold uppercase tracking-wide">Categoría</th>
                    <Th campo="unidades" der>Unidades</Th>
                    <th className="px-3 py-3 text-right font-semibold uppercase tracking-wide">Ventas</th>
                    <Th campo="total" der>Total</Th>
                    <th className="px-3 py-3 text-right font-semibold uppercase tracking-wide">%</th>
                    <th className="px-3 py-3 text-right font-semibold uppercase tracking-wide">Precio prom.</th>
                    <Th campo="ganancia" der>Ganancia</Th>
                    <Th campo="margen" der>Margen</Th>
                    <Th campo="stock" der>Stock</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((i) => {
                    const sinV = !Number(i.unidades);
                    return (
                      <tr key={i.producto_id ?? i.nombre} className={`transition-colors hover:bg-[var(--brand-50)] ${sinV ? "bg-amber-50/40" : ""}`}>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
                              {i.imagen_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={i.imagen_url} alt="" className="h-full w-full object-cover" />
                              ) : (
                                i.nombre.charAt(0).toUpperCase()
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-slate-800">
                                {i.nombre}
                                {i.sin_costo ? <span className="ml-1 font-bold text-amber-600" title="Vendido al menos una vez sin costo cargado">*</span> : null}
                                {sinV ? <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Sin ventas</span> : null}
                              </p>
                              <p className="font-mono text-[11px] text-slate-400">{i.sku}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{i.categoria ?? "—"}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">{num(i.unidades)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{num(i.ventas)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">{gs(i.total)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{pct(Number(i.total), Number(t?.total ?? 0))}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-600">{sinV ? "—" : gs(i.precio_promedio)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-700">{sinV ? "—" : gs(i.ganancia)}</td>
                        <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${sinV ? "text-slate-300" : margenColor(Number(i.ganancia), Number(i.total))}`}>{sinV ? "—" : pct(Number(i.ganancia), Number(i.total))}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-600">
                          {i.controla_stock ? <>{num(Number(i.stock_actual))} <span className="text-[10px] text-slate-400">{i.unidad_medida}</span></> : "—"}
                          {sinV && Number(i.valor_stock) ? <p className="text-[10px] text-amber-600">{gs(i.valor_stock)} inmov.</p> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {t && items.length > 1 ? (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 font-semibold text-slate-900">
                      <td className="px-3 py-2.5" colSpan={2}>Total</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{num(t.unidades)}</td>
                      <td />
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{gs(t.total)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">100%</td>
                      <td />
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{gs(t.ganancia)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{pct(t.ganancia, t.total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          )
        ) : (
          <>
            {lineasF.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-slate-400">Sin ventas para los filtros seleccionados.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="px-5 py-3 font-semibold">Fecha</th>
                      <th className="px-3 py-3 font-semibold">Venta</th>
                      <th className="px-3 py-3 font-semibold">Producto</th>
                      <th className="px-3 py-3 font-semibold">Cliente</th>
                      <th className="px-3 py-3 font-semibold">Cajero</th>
                      <th className="px-3 py-3 text-right font-semibold">Cant.</th>
                      <th className="px-3 py-3 text-right font-semibold">P. unit.</th>
                      <th className="px-3 py-3 text-right font-semibold">Total</th>
                      <th className="px-4 py-3 text-right font-semibold">Ganancia</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lineasF.map((l) => (
                      <tr key={l.id} onClick={() => setViendo(l.venta_id)} title="Ver la venta" className="cursor-pointer transition-colors hover:bg-[var(--brand-50)]">
                        <td className="whitespace-nowrap px-5 py-2.5 text-xs tabular-nums text-slate-500">{fechaHora(l.fecha)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-slate-600">{l.numero}</td>
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-slate-800">{l.producto}</p>
                          <p className="font-mono text-[11px] text-slate-400">{l.sku}</p>
                        </td>
                        <td className="max-w-[160px] truncate px-3 py-2.5 text-slate-600">{l.cliente ?? <span className="text-slate-300">Sin cliente</span>}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{l.cajero ?? "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">{num(l.cantidad)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-600">
                          {gs(l.precio)}
                          {Number(l.precio) < Number(l.precio_lista) ? <p className="text-[10px] text-slate-400 line-through">{gs(l.precio_lista)}</p> : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">{gs(l.total)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-600">{gs(l.ganancia)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {totalLineas > POR_PAGINA ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3.5">
                <span className="text-xs text-slate-500">
                  Mostrando <strong className="text-slate-700">{(pagina - 1) * POR_PAGINA + 1}–{Math.min(pagina * POR_PAGINA, totalLineas)}</strong> de <strong className="text-slate-700">{num(totalLineas)}</strong>
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={pagina <= 1} aria-label="Anterior" className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                  <span className="px-2 text-xs tabular-nums text-slate-600">{pagina} / {totalPaginas}</span>
                  <button onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={pagina >= totalPaginas} aria-label="Siguiente" className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>

      {viendo ? <VentaDetalle ventaId={viendo} onClose={() => setViendo(null)} onAnulada={() => setViendo(null)} /> : null}
    </div>
  );
}

function Cifra({ label, value, hint, accent, valueClass }: { label: string; value: string; hint?: string; accent?: boolean; valueClass?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-white p-4 shadow-sm" style={accent ? { borderColor: `${TEAL}55`, backgroundColor: "var(--brand-50)" } : { borderColor: "#e2e8f0" }}>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <p className={`mt-1 truncate text-xl font-semibold tabular-nums ${valueClass ?? "text-slate-900"}`} style={accent && !valueClass ? { color: TEAL } : undefined}>{value}</p>
      {hint ? <p className="mt-0.5 truncate text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}
