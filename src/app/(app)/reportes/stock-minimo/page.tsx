"use client";

/**
 * /reportes/stock-minimo — productos con stock por debajo del mínimo (portado de
 * Ferretería República). Suma: cifras de reposición, ventas de los últimos 30 días,
 * costo de reposición, filtros, Excel/PDF (lista de compra) y edición del producto en el
 * panel lateral para ajustar mínimo o stock sin salir del reporte.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { unidadCorta } from "@/modules/inventario/recetas";
import { FileSpreadsheet, FileText, Loader2, PackageMinus, RefreshCw, Search, X } from "lucide-react";
import { filtrar } from "@/lib/busqueda";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { BarraFiltros } from "@/components/EncabezadoPagina";
import { TablaTarjetas } from "@/components/TablaResponsive";
import { EncabezadoReporte, FilaKpis, Kpi } from "@/modules/reportes/ui";
import { ProductoForm } from "@/modules/inventario/ProductoForm";
import { opcionesFiltroCategoria, type Categoria } from "@/modules/inventario/categorias";
import type { ProductoInventario } from "@/modules/inventario/tipos";
import type { ReporteStockMinimo } from "@/modules/reportes/server/stock";

const TEAL = clienteConfig.color;
const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const num = (v: number) => Number(v || 0).toLocaleString("es-PY", { maximumFractionDigits: 3 });

export default function ReporteStockMinimoPage() {
  const [data, setData] = useState<ReporteStockMinimo | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState("");
  const [soloSinStock, setSoloSinStock] = useState(false);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [editando, setEditando] = useState<ProductoInventario | null>(null);
  const [bajando, setBajando] = useState<"" | "xlsx" | "pdf">("");

  const filtros = useMemo(() => {
    const sp = new URLSearchParams();
    if (categoria) sp.set("categoria", categoria);
    if (soloSinStock) sp.set("sin_stock", "1");
    return sp.toString();
  }, [categoria, soloSinStock]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setData(await apiFetch<ReporteStockMinimo>(`/api/reportes/stock-minimo?${filtros}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, [filtros]);

  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => {
    apiFetch<{ categorias: Categoria[] }>("/api/inventario/categorias").then((r) => setCategorias(r.categorias)).catch(() => {});
  }, []);

  async function abrir(id: string) {
    try {
      setEditando(await apiFetch<ProductoInventario>(`/api/productos/${id}`));
    } catch {
      /* best-effort */
    }
  }

  async function bajar(f: "xlsx" | "pdf") {
    setBajando(f);
    try {
      await descargarArchivo(`/api/reportes/stock-minimo/${f === "xlsx" ? "export" : "pdf"}?${filtros}`, `stock-minimo.${f}`);
    } catch {
      /* best-effort */
    } finally {
      setBajando("");
    }
  }

  // Búsqueda inteligente (sin tildes, cualquier orden, errores de tipeo); respeta el orden del reporte.
  // Con el texto diferido: el input no espera al filtro y solo se recalcula si cambia algo.
  const busquedaDiferida = useDeferredValue(busqueda);
  const items = useMemo(
    () => filtrar(data?.items ?? [], busquedaDiferida, (i) => ({ principal: i.nombre, otros: [i.categoria], codigos: [i.sku, i.codigo_barras] })),
    [data, busquedaDiferida],
  );
  const t = data?.totales;

  return (
    <div className="space-y-6 pb-10">
      <EncabezadoReporte kicker="Reportes · Stock" titulo="Productos con stock mínimo"
        subtitulo="Productos cuyo stock actual quedó por debajo del mínimo definido. Ordenados por mayor faltante.">
        <button onClick={() => bajar("xlsx")} disabled={!!bajando || !items.length} className="inline-flex h-[38px] items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition hover:bg-[var(--brand-50)] disabled:opacity-50" style={{ borderColor: `${TEAL}55`, color: TEAL }}>
          {bajando === "xlsx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} <span className="sm:hidden">Excel</span><span className="max-sm:hidden">Exportar Excel</span>
        </button>
        <button onClick={() => bajar("pdf")} disabled={!!bajando || !items.length} className="inline-flex h-[38px] items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50" style={{ backgroundColor: TEAL }}>
          {bajando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} <span className="sm:hidden">PDF</span><span className="max-sm:hidden">Lista de reposición (PDF)</span>
        </button>
      </EncabezadoReporte>

      {/* Cifras */}
      <FilaKpis n={3}>
        <Kpi acento label="Bajo el mínimo" valor={t ? num(t.productos) : "—"} hint="productos a reponer" />
        <Kpi label="Sin stock" valor={t ? num(t.sin_stock) : "—"} hint="ya no se pueden vender" tono={t?.sin_stock ? "malo" : undefined} />
        <Kpi label="Costo de reposición" valor={t ? gs(t.costo_reposicion) : "—"} hint={t?.sin_costo ? `${t.sin_costo} sin costo cargado (no suman)` : "faltante × costo promedio"} />
      </FilaKpis>

      {/* Filtros: búsqueda siempre visible; categoría y "solo sin stock" en la hoja "Filtros" en celular. */}
      <BarraFiltros plano
        activos={(categoria ? 1 : 0) + (soloSinStock ? 1 : 0)}
        onLimpiar={() => { setCategoria(""); setSoloSinStock(false); }}
        busqueda={
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre, SKU, código o categoría…" type="search" enterKeyHint="search"
              className="h-[38px] w-full rounded-xl border border-slate-200 bg-white pl-9 pr-9 text-[13px] outline-none max-md:text-sm transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)] max-md:h-11 [&::-webkit-search-cancel-button]:hidden" />
            {busqueda ? (
              <button onClick={() => setBusqueda("")} aria-label="Limpiar búsqueda" className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"><X className="h-3.5 w-3.5" /></button>
            ) : null}
          </div>
        }
        extra={
          <button onClick={() => void cargar()} aria-label="Actualizar" className="inline-flex h-[38px] shrink-0 items-center gap-2 rounded-xl border px-4 text-[13px] font-semibold transition hover:bg-[var(--brand-50)] max-md:h-11 max-md:w-11 max-md:justify-center max-md:px-0" style={{ borderColor: `${TEAL}55`, color: TEAL }}>
            <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} /> <span className="max-md:hidden">Actualizar</span>
          </button>
        }>
        <Select chip prefijo="Categoría" textoVacio="Todas" value={categoria} onChange={setCategoria} minWidth={220} etiqueta="Categoría" className="max-w-[260px] max-md:max-w-none" options={[["", "Todas las categorías"], ["__sin__", "— Sin categoría —"], ...opcionesFiltroCategoria(categorias)]} />
        <label className={`flex h-[38px] cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl border px-3 text-[13px] transition max-md:h-12 max-md:text-sm ${soloSinStock ? "border-[color-mix(in_srgb,var(--brand)_38%,white)] bg-[var(--brand-50)] font-semibold text-[var(--brand)]" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
          <input type="checkbox" checked={soloSinStock} onChange={(e) => setSoloSinStock(e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-[var(--brand)]" />
          Solo sin stock
        </label>
      </BarraFiltros>

      {/* Tabla */}
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}33` }}>
        <div className="flex items-center gap-2 border-b px-3.5 py-3 sm:px-5 sm:py-3.5" style={{ borderColor: `${TEAL}22`, background: `linear-gradient(to right, ${TEAL}0d, transparent)` }}>
          <PackageMinus className="h-4 w-4" style={{ color: TEAL }} />
          <h2 className="text-[15px] font-bold text-slate-800">Bajo stock mínimo</h2>
          {cargando ? <Loader2 className="h-4 w-4 animate-spin" style={{ color: TEAL }} /> : <span className="text-xs text-slate-400">{items.length} producto{items.length === 1 ? "" : "s"}</span>}
        </div>

        {error ? (
          <p className="px-5 py-10 text-center text-sm text-red-600">No se pudo cargar el reporte: {error}</p>
        ) : cargando && !data ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">Cargando…</p>
        ) : items.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm text-slate-500">
              {(data?.items.length ?? 0) === 0 ? "No hay productos por debajo del stock mínimo." : "Ningún producto coincide con la búsqueda."}
            </p>
            {(data?.items.length ?? 0) === 0 ? (
              <p className="mt-1 text-xs text-slate-400">Un producto entra cuando tiene un <strong>stock mínimo</strong> cargado (en Inventario) y su stock queda por debajo.</p>
            ) : null}
          </div>
        ) : (
          // Cada producto se abre para editarlo: tarjetas en celular, tabla desde 768 px.
          <TablaTarjetas filas={items} claveFila={(r) => r.id} onFila={(r) => abrir(r.id)} minAncho={900}
            claseThead="border-b border-slate-200 bg-slate-50" thBase="whitespace-nowrap px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 first:pl-5"
            tdBase="px-3 py-2.5 first:pl-5"
            columnas={[
              { key: "p", titulo: "Producto", movil: "titulo",
                celda: (r) => (
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
                      {r.imagen_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.imagen_url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                      ) : (
                        r.nombre.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">{r.nombre}</p>
                      <p className="font-mono text-[11px] text-slate-400">{r.sku}</p>
                    </div>
                  </div>
                ),
                celdaMovil: (r) => r.nombre },
              { key: "sku", titulo: "SKU", movil: "subtitulo", claseTh: "hidden", claseTd: "hidden",
                celda: (r) => <span className="font-mono text-xs">{[r.sku, r.categoria].filter(Boolean).join(" · ") || "—"}</span> },
              { key: "cat", titulo: "Categoría", movil: "oculto", claseTd: "text-slate-600", celda: (r) => r.categoria || "—" },
              { key: "st", titulo: "Stock actual", movil: "dato", etiquetaMovil: "Stock", claseTh: "text-right",
                claseTd: "text-right font-semibold tabular-nums",
                celda: (r) => (
                  <span className={Number(r.stock_actual) <= 0 ? "text-red-700" : "text-red-600"}>
                    {num(r.stock_actual)}
                    {Number(r.stock_actual) <= 0 ? <span className="ml-1.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">Sin stock</span> : null}
                  </span>
                ) },
              { key: "min", titulo: "Mínimo", movil: "dato", claseTh: "text-right", claseTd: "text-right tabular-nums text-slate-600", celda: (r) => num(r.stock_minimo) },
              { key: "f", titulo: "Faltante", movil: "valor", claseTh: "text-right", claseTd: "text-right font-bold tabular-nums text-amber-700",
                celda: (r) => <>{num(r.faltante)} <span className="text-[10px] font-normal text-slate-400">{unidadCorta(r.unidad_medida ?? "Unidad")}</span></>,
                celdaMovil: (r) => <span className="text-amber-700">Faltan {num(r.faltante)} <span className="text-[11px] font-normal text-slate-400">{unidadCorta(r.unidad_medida ?? "Unidad")}</span></span> },
              { key: "v30", titulo: <span title="Unidades vendidas en los últimos 30 días">Vendido 30 días</span>, etiquetaMovil: "Vendido 30 días", movil: "dato",
                claseTh: "text-right", claseTd: "text-right tabular-nums text-slate-600", celda: (r) => num(r.vendido_30d) },
              { key: "cr", titulo: "Costo reposición", movil: "dato", etiquetaMovil: "Reposición", claseTh: "pr-4 text-right", claseTd: "pr-4 text-right tabular-nums text-slate-700",
                celda: (r) => (Number(r.costo) ? gs(r.costo_reposicion) : <span className="text-xs text-amber-600">sin costo</span>) },
            ]} />
        )}
      </section>

      {editando ? (
        <ProductoForm
          producto={editando}
          categorias={categorias}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); void cargar(); }}
        />
      ) : null}
    </div>
  );
}
