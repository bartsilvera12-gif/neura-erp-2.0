"use client";

/**
 * /reportes/productos-vendidos — cuánto se vendió de cada producto (portado de Ferretería
 * República). Resumido (por producto) o Detallado (cada venta). Suma: precio promedio,
 * ganancia y margen, stock actual, columnas ordenables, productos SIN ventas con su stock
 * inmovilizado, atajos de fecha, Excel y PDF.
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { unidadCorta } from "@/modules/inventario/recetas";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, Boxes, ChevronLeft, ChevronRight, FileSpreadsheet, FileText, Loader2, Search, X } from "lucide-react";
import { filtrar } from "@/lib/busqueda";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchCache } from "@/lib/api/cache-cliente";
import { descargarArchivo } from "@/lib/api/client-blob";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { BarraFiltros } from "@/components/EncabezadoPagina";
import { TablaScroll, TablaTarjetas } from "@/components/TablaResponsive";
import { EncabezadoReporte, FilaKpis, Kpi, RangoFechasLocal, Segmentos } from "@/modules/reportes/ui";
import { VentaDetalle } from "@/modules/caja/VentaDetalle";
import { opcionesFiltroCategoria, type Categoria } from "@/modules/inventario/categorias";
import type { ItemProducto, LineaProducto, ResumenProductos } from "@/modules/reportes/server/productos";

const TEAL = clienteConfig.color;
const TZ = "America/Asuncion";
const POR_PAGINA = 50;
const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const num = (v: number) => Number(v || 0).toLocaleString("es-PY", { maximumFractionDigits: 3 });
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1).replace(".", ",")} %` : "—");
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
  return <Suspense fallback={null}><Contenido /></Suspense>;
}

// Acepta ?desde&hasta en la URL (enlaces del Inicio, Estado de cuenta y Ventas por mes).
const FECHA_URL = /^\d{4}-\d{2}-\d{2}$/;

function Contenido() {
  const sp = useSearchParams();
  const rangoUrl = FECHA_URL.test(sp.get("desde") ?? "") && FECHA_URL.test(sp.get("hasta") ?? "");
  const [desde, setDesde] = useState(() => (rangoUrl ? sp.get("desde")! : rangoAtajo("mes").desde));
  const [hasta, setHasta] = useState(() => (rangoUrl ? sp.get("hasta")! : hoy()));
  const [atajo, setAtajo] = useState<string | null>(rangoUrl ? null : "mes");
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
  const Th = ({ campo, children, der }: { campo: Orden; children: React.ReactNode; der?: boolean }) => {
    const act = orden.campo === campo;
    return (
      <th className={`whitespace-nowrap px-3 py-3 font-semibold max-sm:py-0 ${der ? "text-right" : ""}`}>
        <button type="button" onClick={() => setOrden((o) => ({ campo, desc: o.campo === campo ? !o.desc : campo !== "nombre" }))}
          className={`inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-slate-800 max-sm:min-h-11 ${act ? "text-slate-800" : ""}`}>
          {children}
          {act ? (orden.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : null}
        </button>
      </th>
    );
  };

  return (
    <div className="space-y-6 pb-10">
      <EncabezadoReporte kicker="Reportes · Productos" titulo="Productos vendidos"
        subtitulo="Cuánto se vendió de cada producto. Resumido (por producto) o detallado (cada venta).">
        <button onClick={() => bajar("xlsx")} disabled={!!bajando || !resumen?.items.length} className="inline-flex h-[38px] items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition hover:bg-[var(--brand-50)] disabled:opacity-50" style={{ borderColor: `${TEAL}55`, color: TEAL }}>
          {bajando === "xlsx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} <span className="sm:hidden">Excel</span><span className="max-sm:hidden">Exportar Excel</span>
        </button>
        <button onClick={() => bajar("pdf")} disabled={!!bajando || !resumen?.items.length} className="inline-flex h-[38px] items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50" style={{ backgroundColor: TEAL }}>
          {bajando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} <span className="sm:hidden">PDF</span><span className="max-sm:hidden">Descargar PDF</span>
        </button>
      </EncabezadoReporte>

      {/* Filtros en una fila (≥ 768 px): período, Resumido/Detallado, búsqueda, categoría y
          "sin ventas". En celular: período y vista arriba; categoría y "sin ventas" en la hoja "Filtros". */}
      <BarraFiltros
        inicio={
          <>
            <RangoFechasLocal atajos={ATAJOS} atajo={atajo}
              onAtajo={(k) => { const r = rangoAtajo(k); setDesde(r.desde); setHasta(r.hasta); setAtajo(k); }}
              desde={desde} hasta={hasta}
              onDesde={(v) => { if (v) { setDesde(v); setAtajo(null); } }}
              onHasta={(v) => { if (v) { setHasta(v); setAtajo(null); } }} />
            <Segmentos barra valor={modo} onChange={setModo} opciones={[["resumido", "Resumido"], ["detallado", "Detallado"]]} />
          </>
        }
        activos={(categoria ? 1 : 0) + (modo === "resumido" && sinVentas ? 1 : 0)}
        onLimpiar={() => { setCategoria(""); setSinVentas(false); }}
        busqueda={
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} type="search" enterKeyHint="search"
              placeholder={modo === "resumido" ? "Filtrar por producto, SKU o categoría…" : "Filtrar por producto, venta, cliente o cajero…"}
              className="h-[38px] w-full rounded-xl border border-slate-200 bg-white pl-9 pr-9 text-[13px] outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)] max-md:h-11 max-md:text-sm [&::-webkit-search-cancel-button]:hidden" />
            {busqueda ? <button onClick={() => setBusqueda("")} aria-label="Limpiar" className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"><X className="h-3.5 w-3.5" /></button> : null}
          </div>
        }>
        <Select chip prefijo="Categoría" textoVacio="Todas" value={categoria} onChange={setCategoria} minWidth={220} etiqueta="Categoría" className="max-w-[260px] max-md:max-w-none" options={[["", "Todas las categorías"], ["__sin__", "— Sin categoría —"], ...opcionesFiltroCategoria(categorias)]} />
        {modo === "resumido" ? (
          <label className={`flex h-[38px] cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl border px-3 text-[13px] transition max-md:h-12 max-md:text-sm ${sinVentas ? "border-[color-mix(in_srgb,var(--brand)_38%,white)] bg-[var(--brand-50)] font-semibold text-[var(--brand)]" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`} title="Suma los productos activos que no tuvieron ninguna venta en el período">
            <input type="checkbox" checked={sinVentas} onChange={(e) => setSinVentas(e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-[var(--brand)]" />
            Incluir sin ventas
          </label>
        ) : null}
      </BarraFiltros>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">No se pudo cargar el reporte: {error}</div> : null}

      {/* Cifras */}
      <div className={`transition-opacity ${cargando ? "opacity-60" : ""}`}>
        <FilaKpis n={4}>
          <Kpi acento label="Productos vendidos" valor={t ? num(t.productos_vendidos) : "—"} hint={t ? `${num(t.unidades)} unidades` : ""} />
          <Kpi label="Total vendido" valor={t ? gs(t.total) : "—"} />
          <Kpi label="Ganancia" valor={t ? gs(t.ganancia) : "—"} hint={t ? `${pct(t.ganancia, t.total)} sobre ventas` : ""} />
          <Kpi label="Sin ventas" valor={sinVentas && t ? num(t.productos_sin_ventas) : "—"} hint={sinVentas && t ? `${gs(t.valor_stock_sin_ventas)} en stock inmovilizado` : "marcá «Incluir productos sin ventas»"} tono={sinVentas && t?.productos_sin_ventas ? "alerta" : undefined} />
        </FilaKpis>
      </div>

      {/* Tabla */}
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}33` }}>
        <div className="flex flex-wrap items-center gap-2 border-b px-3.5 py-3 sm:px-5 sm:py-3.5" style={{ borderColor: `${TEAL}22`, background: `linear-gradient(to right, ${TEAL}0d, transparent)` }}>
          <Boxes className="h-4 w-4" style={{ color: TEAL }} />
          <h2 className="text-[15px] font-bold text-slate-800">{modo === "resumido" ? "Resumen por producto" : "Detalle de ventas"}</h2>
          {cargando ? <Loader2 className="h-4 w-4 animate-spin" style={{ color: TEAL }} /> : (
            <span className="text-xs text-slate-400">{modo === "resumido" ? `${items.length} producto${items.length === 1 ? "" : "s"}` : `${num(totalLineas)} línea${Number(totalLineas) === 1 ? "" : "s"}`}</span>
          )}
        </div>

        {modo === "resumido" ? (
          items.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-slate-400">{cargando ? "Cargando…" : "Sin ventas para los filtros seleccionados."}</p>
          ) : (
            // Comparar columnas entre productos: tabla con scroll interno y el producto fijo a la izquierda.
            <TablaScroll primeraFija>
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
                    <Th campo="margen" der>Margen de ganancia</Th>
                    <Th campo="stock" der>Stock</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((i) => {
                    const sinV = !Number(i.unidades);
                    return (
                      <tr key={i.producto_id ?? i.nombre} className={`transition-colors hover:bg-[var(--brand-50)] hover:[--tabla-fondo:var(--brand-50)] ${sinV ? "bg-amber-50/40 [--tabla-fondo:#fffdf5]" : ""}`}>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-3 max-sm:w-[44vw]">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xs font-semibold text-slate-500 max-sm:hidden">
                              {i.imagen_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={i.imagen_url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                              ) : (
                                i.nombre.charAt(0).toUpperCase()
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-slate-800 max-sm:line-clamp-2 max-sm:whitespace-normal max-sm:leading-snug max-sm:[overflow-wrap:anywhere]">
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
                          {i.controla_stock ? <>{num(Number(i.stock_actual))} <span className="text-[10px] text-slate-400">{unidadCorta(i.unidad_medida ?? "Unidad")}</span></> : "—"}
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
            </TablaScroll>
          )
        ) : (
          <>
            {/* Cada línea abre su venta: tarjetas en celular, tabla desde 768 px. */}
            <TablaTarjetas filas={lineasF} claveFila={(l) => l.id} onFila={(l) => setViendo(l.venta_id)} minAncho={1000}
              claseThead="border-b border-slate-200 bg-slate-50" thBase="whitespace-nowrap px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 first:pl-5"
              tdBase="px-3 py-2.5 first:pl-5"
              vacio={<p className="px-5 py-12 text-center text-sm text-slate-400">Sin ventas para los filtros seleccionados.</p>}
              columnas={[
                { key: "f", titulo: "Fecha", movil: "oculto", claseTd: "whitespace-nowrap text-xs tabular-nums text-slate-500", celda: (l) => fechaHora(l.fecha) },
                { key: "v", titulo: "Venta", movil: "subtitulo", claseTd: "whitespace-nowrap font-mono text-xs text-slate-600", celda: (l) => l.numero,
                  celdaMovil: (l) => <span className="tabular-nums"><span className="font-mono text-xs">{l.numero}</span> · {fechaHora(l.fecha)}</span> },
                { key: "p", titulo: "Producto", movil: "titulo",
                  celda: (l) => <><p className="font-medium text-slate-800">{l.producto}</p><p className="font-mono text-[11px] text-slate-400">{l.sku}</p></>,
                  celdaMovil: (l) => l.producto },
                { key: "c", titulo: "Cliente", movil: "dato", claseTd: "max-w-[160px] truncate text-slate-600", celda: (l) => l.cliente ?? <span className="text-slate-300">Sin cliente</span> },
                { key: "cj", titulo: "Cajero", movil: "dato", claseTd: "whitespace-nowrap text-slate-600", celda: (l) => l.cajero ?? "—" },
                { key: "q", titulo: "Cant.", movil: "dato", etiquetaMovil: "Cantidad", claseTh: "text-right", claseTd: "text-right tabular-nums text-slate-900", celda: (l) => num(l.cantidad) },
                { key: "pu", titulo: "P. unit.", movil: "dato", etiquetaMovil: "Precio unit.", claseTh: "text-right", claseTd: "whitespace-nowrap text-right tabular-nums text-slate-600",
                  celda: (l) => <>{gs(l.precio)}{Number(l.precio) < Number(l.precio_lista) ? <p className="text-[10px] text-slate-400 line-through">{gs(l.precio_lista)}</p> : null}</> },
                { key: "t", titulo: "Total", movil: "valor", claseTh: "text-right", claseTd: "whitespace-nowrap text-right font-semibold tabular-nums text-slate-900", celda: (l) => gs(l.total) },
                { key: "g", titulo: "Ganancia", claseTh: "text-right pr-4", claseTd: "whitespace-nowrap pr-4 text-right tabular-nums text-slate-600", celda: (l) => gs(l.ganancia) },
              ]} />
            {totalLineas > POR_PAGINA ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-3.5 py-3.5 max-sm:justify-center sm:px-5">
                <span className="text-xs text-slate-500">
                  Mostrando <strong className="text-slate-700">{(pagina - 1) * POR_PAGINA + 1}–{Math.min(pagina * POR_PAGINA, totalLineas)}</strong> de <strong className="text-slate-700">{num(totalLineas)}</strong>
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={pagina <= 1} aria-label="Anterior" className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 max-sm:h-11 max-sm:w-11"><ChevronLeft className="h-4 w-4" /></button>
                  <span className="px-2 text-xs tabular-nums text-slate-600">{pagina} / {totalPaginas}</span>
                  <button onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={pagina >= totalPaginas} aria-label="Siguiente" className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 max-sm:h-11 max-sm:w-11"><ChevronRight className="h-4 w-4" /></button>
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
