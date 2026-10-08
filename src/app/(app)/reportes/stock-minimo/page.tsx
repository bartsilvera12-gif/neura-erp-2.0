"use client";

/**
 * /reportes/stock-minimo — productos con stock por debajo del mínimo (portado de
 * Ferretería República). Suma: cifras de reposición, ventas de los últimos 30 días,
 * costo de reposición, filtros, Excel/PDF (lista de compra) y edición del producto en el
 * panel lateral para ajustar mínimo o stock sin salir del reporte.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileSpreadsheet, FileText, Loader2, PackageMinus, RefreshCw, Search, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { ProductoForm } from "@/modules/inventario/ProductoForm";
import type { Categoria } from "@/modules/inventario/categorias";
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

  const q = busqueda.trim().toLowerCase();
  const items = (data?.items ?? []).filter(
    (i) => !q || [i.nombre, i.sku, i.codigo_barras, i.categoria].some((v) => (v ?? "").toLowerCase().includes(q)),
  );
  const t = data?.totales;

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
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Reportes · Stock</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Productos con stock mínimo</h1>
          <p className="mt-1 text-sm text-slate-500">Productos cuyo stock actual quedó por debajo del mínimo definido. Ordenados por mayor faltante.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => bajar("xlsx")} disabled={!!bajando || !items.length} className="inline-flex h-[38px] items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition hover:bg-[var(--brand-50)] disabled:opacity-50" style={{ borderColor: `${TEAL}55`, color: TEAL }}>
            {bajando === "xlsx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Exportar Excel
          </button>
          <button onClick={() => bajar("pdf")} disabled={!!bajando || !items.length} className="inline-flex h-[38px] items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50" style={{ backgroundColor: TEAL }}>
            {bajando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Lista de reposición (PDF)
          </button>
        </div>
      </div>

      {/* Cifras */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Cifra accent label="Bajo el mínimo" value={t ? num(t.productos) : "—"} hint="productos a reponer" />
        <Cifra label="Sin stock" value={t ? num(t.sin_stock) : "—"} hint="ya no se pueden vender" valueClass={t?.sin_stock ? "text-red-600" : undefined} />
        <Cifra label="Costo de reposición" value={t ? gs(t.costo_reposicion) : "—"} hint={t?.sin_costo ? `${t.sin_costo} sin costo cargado (no suman)` : "faltante × costo promedio"} />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative w-full max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre, SKU, código o categoría…"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-9 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]" />
          {busqueda ? (
            <button onClick={() => setBusqueda("")} aria-label="Limpiar búsqueda" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100"><X className="h-3.5 w-3.5" /></button>
          ) : null}
        </div>
        <Select value={categoria} onChange={setCategoria} minWidth={190} options={[["", "Todas las categorías"], ["__sin__", "— Sin categoría —"], ...categorias.map((c): [string, string] => [c.id, c.nombre])]} />
        <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-600">
          <input type="checkbox" checked={soloSinStock} onChange={(e) => setSoloSinStock(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Solo sin stock
        </label>
        <button onClick={() => void cargar()} className="inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition hover:bg-[var(--brand-50)]" style={{ borderColor: `${TEAL}55`, color: TEAL }}>
          <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} /> Actualizar
        </button>
      </div>

      {/* Tabla */}
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}33` }}>
        <div className="flex items-center gap-2 border-b px-5 py-3.5" style={{ borderColor: `${TEAL}22`, background: `linear-gradient(to right, ${TEAL}0d, transparent)` }}>
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-semibold">Producto</th>
                  <th className="px-3 py-3 font-semibold">Categoría</th>
                  <th className="px-3 py-3 text-right font-semibold">Stock actual</th>
                  <th className="px-3 py-3 text-right font-semibold">Mínimo</th>
                  <th className="px-3 py-3 text-right font-semibold">Faltante</th>
                  <th className="px-3 py-3 text-right font-semibold" title="Unidades vendidas en los últimos 30 días">Vendido 30 días</th>
                  <th className="px-4 py-3 text-right font-semibold">Costo reposición</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((r) => (
                  <tr key={r.id} onClick={() => abrir(r.id)} title="Editar el producto (mínimo, stock, costo)" className="cursor-pointer transition-colors hover:bg-[var(--brand-50)]">
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
                          {r.imagen_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.imagen_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            r.nombre.charAt(0).toUpperCase()
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-800">{r.nombre}</p>
                          <p className="font-mono text-[11px] text-slate-400">{r.sku}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{r.categoria || "—"}</td>
                    <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${Number(r.stock_actual) <= 0 ? "text-red-700" : "text-red-600"}`}>
                      {num(r.stock_actual)}
                      {Number(r.stock_actual) <= 0 ? <span className="ml-1.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">Sin stock</span> : null}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{num(r.stock_minimo)}</td>
                    <td className="px-3 py-2.5 text-right font-bold tabular-nums text-amber-700">
                      {num(r.faltante)} <span className="text-[10px] font-normal text-slate-400">{r.unidad_medida}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{num(r.vendido_30d)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                      {Number(r.costo) ? gs(r.costo_reposicion) : <span className="text-xs text-amber-600">sin costo</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

function Cifra({ label, value, hint, accent, valueClass }: { label: string; value: string; hint?: string; accent?: boolean; valueClass?: string }) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm" style={accent ? { borderColor: `${TEAL}55`, backgroundColor: "var(--brand-50)" } : { borderColor: "#e2e8f0" }}>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${valueClass ?? "text-slate-900"}`} style={accent && !valueClass ? { color: TEAL } : undefined}>{value}</p>
      {hint ? <p className="mt-0.5 truncate text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}
