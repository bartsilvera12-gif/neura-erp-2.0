"use client";

/**
 * /inventario — Inventario igual al de Ferretería República (sin rangos ABC):
 * exportar / importación inicial / importar Excel, filtros por categoría e inactivos,
 * paginado EN EL SERVIDOR con "Ir a", acciones editar · desactivar · eliminar.
 * Crear y editar siguen en el panel lateral del 2.0 (el listado queda visible atrás).
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, Eye, EyeOff, Loader2,
  Package, Pencil, Plus, RotateCcw, Search, Trash2, Upload, X,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { ProductoForm } from "@/modules/inventario/ProductoForm";
import { ExcelImportWizard } from "@/modules/inventario/ExcelImportWizard";
import { colorCategoria, coloresPorCategoria, opcionesFiltroCategoria, partesCategoria, rutaCategoria, type Categoria } from "@/modules/inventario/categorias";
import type { ProductoInventario } from "@/modules/inventario/tipos";

const TEAL = clienteConfig.color;
const POR_PAGINA = [25, 50, 100, 200] as const;

const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const margenVenta = (costo: number, precio: number) => (precio ? ((precio - costo) / precio) * 100 : 0);
const margenColor = (m: number) => (m >= 40 ? "text-green-600" : m >= 20 ? "text-yellow-600" : "text-red-600");
const formatStock = (n: number) => Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });

export default function InventarioPage() {
  const [esAdmin, setEsAdmin] = useState(false);
  const [productos, setProductos] = useState<ProductoInventario[]>([]);
  const [total, setTotal] = useState(0);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [recarga, setRecarga] = useState(0);

  // Filtros / paginado
  const [busquedaBorrador, setBusquedaBorrador] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [verInactivos, setVerInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState<number>(25);

  // Panel lateral (crear / editar) y modales
  const [form, setForm] = useState<{ open: boolean; prod: ProductoInventario | null }>({ open: false, prod: null });
  const [importando, setImportando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [eliminando, setEliminando] = useState<ProductoInventario | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ rol: string }>("/api/me").then((m) => setEsAdmin(m.rol === "ADMIN")).catch(() => {});
    apiFetch<{ categorias: Categoria[] }>("/api/inventario/categorias")
      .then((r) => setCategorias([...r.categorias].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))))
      .catch(() => {});
  }, [recarga]);

  // Debounce de la búsqueda (350 ms, como Ferretería).
  useEffect(() => {
    const t = setTimeout(() => {
      setBusqueda(busquedaBorrador.trim());
      setPagina(1);
    }, 350);
    return () => clearTimeout(t);
  }, [busquedaBorrador]);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    const sp = new URLSearchParams({ paginado: "1", pagina: String(pagina), por_pagina: String(porPagina) });
    if (busqueda) sp.set("q", busqueda);
    if (categoriaId) sp.set("categoria", categoriaId);
    if (verInactivos) sp.set("inactivos", "1");
    apiFetch<{ rows: ProductoInventario[]; total: number }>(`/api/productos?${sp}`)
      .then((r) => { if (!cancel) { setProductos(r.rows); setTotal(r.total); } })
      .catch(() => { if (!cancel) { setProductos([]); setTotal(0); } })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [pagina, porPagina, busqueda, categoriaId, verInactivos, recarga]);

  const refrescar = useCallback(() => setRecarga((k) => k + 1), []);

  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const desdeIdx = total === 0 ? 0 : (paginaSegura - 1) * porPagina + 1;
  const hastaIdx = Math.min(paginaSegura * porPagina, total);
  const categoriaPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);
  const colores = useMemo(() => coloresPorCategoria(categorias), [categorias]);
  const hayFiltros = !!busqueda || !!categoriaId;

  async function toggleActivo(p: ProductoInventario) {
    if (togglingId) return;
    setTogglingId(p.id);
    try {
      await apiFetch(`/api/productos/${p.id}`, { method: "PATCH", body: JSON.stringify({ activo: p.activo === false }) });
      refrescar();
    } catch {
      /* la fila queda igual; se puede reintentar */
    } finally {
      setTogglingId(null);
    }
  }

  async function exportar() {
    setExportando(true);
    try {
      await descargarArchivo("/api/inventario/productos/export", "productos.xlsx");
    } catch {
      /* best-effort */
    } finally {
      setExportando(false);
    }
  }

  function limpiarFiltros() {
    setBusquedaBorrador("");
    setBusqueda("");
    setCategoriaId("");
    setPagina(1);
  }

  const opcionesCategoria: [string, string][] = [
    ["", "Todas las categorías"],
    ["__sin__", "— Sin categoría —"],
    ...opcionesFiltroCategoria(categorias),
  ];

  return (
    <div className="space-y-6 pb-10">
      {/* Encabezado */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Operaciones · Stock</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Inventario</h1>
          <p className="mt-1 text-sm text-slate-500">Gestión de productos y control de stock</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={exportar} disabled={exportando} className="inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-semibold transition hover:bg-[var(--brand-50)] disabled:opacity-60" style={{ borderColor: `${TEAL}55`, color: TEAL }}>
            {exportando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exportando ? "Generando..." : "Exportar Excel"}
          </button>
          {esAdmin ? (
            <>
              <Link href="/inventario/import-inicial" className="rounded-xl border-2 px-3 py-2 text-xs font-semibold transition hover:text-white" style={{ borderColor: `${TEAL}66`, backgroundColor: "var(--brand-50)", color: TEAL }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = TEAL; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--brand-50)"; }}>
                Importación inicial
              </Link>
              <button onClick={() => setImportando(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                <Upload className="h-4 w-4" /> Importar Excel
              </button>
            </>
          ) : null}
        </div>
      </header>

      {/* Tarjeta principal */}
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}33` }}>
        <div className="flex flex-col gap-3 border-b p-4 sm:p-5" style={{ borderColor: `${TEAL}22`, background: `linear-gradient(to right, ${TEAL}0d, transparent)` }}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: `${TEAL}1a`, color: TEAL }}>
                <Package className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-900">Productos</h2>
                <p className="text-[11px] text-slate-500">
                  {cargando ? "Cargando..." : total === 0 ? "Sin resultados" : `Mostrando ${desdeIdx.toLocaleString("es-PY")}–${hastaIdx.toLocaleString("es-PY")} de ${total.toLocaleString("es-PY")}`}
                </p>
              </div>
            </div>
            <div className="ml-auto">
              <button onClick={() => setForm({ open: true, prod: null })} className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:brightness-95 active:scale-95" style={{ backgroundColor: TEAL }}>
                <Plus className="h-3.5 w-3.5" /> Nuevo producto
              </button>
            </div>
          </div>

          {/* Filtros */}
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
            <div className="relative lg:min-w-[240px] lg:flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={busquedaBorrador}
                onChange={(e) => setBusquedaBorrador(e.target.value)}
                placeholder="Buscar por nombre, SKU o código de barras..."
                className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-9 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]"
              />
              {busquedaBorrador ? (
                <button onClick={() => setBusquedaBorrador("")} aria-label="Limpiar búsqueda" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={categoriaId} onChange={(v) => { setCategoriaId(v); setPagina(1); }} options={opcionesCategoria} minWidth={190} />
              <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-600" title="Mostrar también los productos inactivos (para reactivarlos)">
                <input type="checkbox" checked={verInactivos} onChange={(e) => { setVerInactivos(e.target.checked); setPagina(1); }} className="h-4 w-4 rounded border-slate-300" />
                Ver inactivos
              </label>
              <Select value={String(porPagina)} onChange={(v) => { setPorPagina(Number(v)); setPagina(1); }} options={POR_PAGINA.map((n): [string, string] => [String(n), `${n} / pág`])} minWidth={110} />
            </div>
          </div>

          {hayFiltros ? (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Filtros activos:</span>
              {busqueda ? <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium" style={{ backgroundColor: `${TEAL}1a`, color: TEAL }}>Búsqueda: &quot;{busqueda}&quot;</span> : null}
              {categoriaId ? (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium" style={{ backgroundColor: `${TEAL}1a`, color: TEAL }}>
                  {categoriaId === "__sin__" ? "Sin categoría" : rutaCategoria(categoriaId, categoriaPorId) ?? "Categoría"}
                </span>
              ) : null}
              <button onClick={limpiarFiltros} className="ml-auto rounded text-slate-400 underline-offset-2 hover:text-slate-700 hover:underline">Limpiar</button>
            </div>
          ) : null}
        </div>

        {/* Tabla */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b-2 text-[11px] font-bold uppercase tracking-wider" style={{ borderColor: `${TEAL}26`, backgroundColor: `${TEAL}0d`, color: TEAL }}>
                <th className="px-5 py-3">Producto</th>
                <th className="hidden px-3 py-3 lg:table-cell">SKU</th>
                <th className="hidden px-3 py-3 md:table-cell">Categoría</th>
                <th className="px-3 py-3 text-right">Costo</th>
                <th className="px-3 py-3 text-right">Precio</th>
                <th className="px-3 py-3 text-center">Stock</th>
                <th className="hidden px-3 py-3 text-right lg:table-cell" title="Qué parte del precio de venta es ganancia: (precio − costo) ÷ precio">Margen</th>
                <th className="w-px px-5 py-3 text-center">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando && productos.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
                    <p className="mt-2 text-xs text-slate-500">Cargando productos...</p>
                  </td>
                </tr>
              ) : productos.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center">
                    <Package className="mx-auto h-8 w-8 text-slate-300" />
                    <p className="mt-3 text-sm font-medium text-slate-700">No se encontraron productos</p>
                    <p className="mt-1 text-xs text-slate-500">{hayFiltros ? "Probá con otra búsqueda o cambiá los filtros." : "Aún no cargaste productos. Empezá creando uno nuevo."}</p>
                  </td>
                </tr>
              ) : (
                productos.map((p) => {
                  const costo = Number(p.costo_promedio) || 0;
                  // Misma regla que el reporte de Stock mínimo: mínimo cargado y stock por debajo.
                  const stockBajo = Number(p.stock_minimo) > 0 && Number(p.stock_actual) < Number(p.stock_minimo);
                  const margen = margenVenta(costo, Number(p.precio_venta));
                  const sinControl = p.controla_stock === false;
                  const { madre: catMadre, sub: catSub } = partesCategoria(p.categoria_principal_id, categoriaPorId);
                  const inactivo = p.activo === false;
                  return (
                    <tr key={p.id} className={`transition-colors hover:bg-[var(--brand-50)] ${cargando ? "opacity-60" : ""}`}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
                            {p.imagen_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.imagen_url} alt="" className="h-full w-full object-cover" />
                            ) : (
                              p.nombre.charAt(0).toUpperCase()
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-bold text-slate-900">
                              {p.nombre}
                              {inactivo ? <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-amber-700">Inactivo</span> : null}
                            </p>
                            <p className="mt-0.5 font-mono text-[11px] text-slate-600 lg:hidden">{p.sku}</p>
                          </div>
                        </div>
                      </td>
                      <td className="hidden px-3 py-3 font-mono text-xs text-slate-600 lg:table-cell">{p.sku}</td>
                      <td className="hidden px-3 py-3 text-xs text-slate-600 md:table-cell">
                        {catMadre ? (
                          (() => {
                            const c = colores.get(catMadre.id) ?? colorCategoria(catMadre.nombre);
                            const ruta = catSub ? `${catMadre.nombre} › ${catSub.nombre}` : catMadre.nombre;
                            return (
                              <span className="inline-flex max-w-full items-center gap-1.5 truncate whitespace-nowrap rounded-md border border-slate-200/70 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" title={ruta}>
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c.dot, boxShadow: `0 0 0 3px ${c.bg}` }} />
                                <span className="truncate">
                                  {catMadre.nombre}
                                  {catSub ? <span className="font-medium text-slate-500"> › {catSub.nombre}</span> : null}
                                </span>
                              </span>
                            );
                          })()
                        ) : (
                          <span className="text-slate-400">— Sin categoría</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-slate-700">{gs(costo)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-slate-900">{gs(Number(p.precio_venta))}</td>
                      <td className="px-3 py-3 text-center">
                        {sinControl ? (
                          <span className="text-xs font-medium text-slate-500">— sin control</span>
                        ) : (
                          <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums ${stockBajo ? "bg-red-50 text-red-700 ring-1 ring-red-100" : Number(p.stock_actual) > 0 ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100" : "bg-slate-50 text-slate-500 ring-1 ring-slate-200"}`}>
                            {formatStock(Number(p.stock_actual))}
                            <span className="text-[10px] font-normal opacity-80">{p.unidad_medida}</span>
                          </span>
                        )}
                      </td>
                      <td className={`hidden px-3 py-3 text-right font-semibold tabular-nums lg:table-cell ${margenColor(margen)}`}>{margen.toFixed(1)}%</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => setForm({ open: true, prod: p })} title={inactivo ? "Ver producto (inactivo)" : "Editar producto"} aria-label={`${inactivo ? "Ver" : "Editar"} ${p.nombre}`} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-[var(--brand-50)] hover:text-[var(--brand)]">
                            {inactivo ? <Eye className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                          </button>
                          <button onClick={() => toggleActivo(p)} disabled={togglingId === p.id} title={inactivo ? "Reactivar producto" : "Desactivar producto (reversible)"} aria-label={`${inactivo ? "Reactivar" : "Desactivar"} ${p.nombre}`}
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition disabled:opacity-40 ${inactivo ? "text-emerald-600 hover:bg-emerald-50" : "text-slate-500 hover:bg-amber-50 hover:text-amber-600"}`}>
                            {togglingId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : inactivo ? <RotateCcw className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                          </button>
                          <button onClick={() => setEliminando(p)} title="Eliminar producto (permanente)" aria-label={`Eliminar ${p.nombre}`} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-red-50 hover:text-red-600">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginado */}
        {total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 px-4 py-3 sm:px-5" style={{ borderColor: `${TEAL}26`, background: `linear-gradient(to right, ${TEAL}0d, transparent)` }}>
            <p className="text-xs text-slate-500">
              Página <span className="font-semibold text-slate-900">{paginaSegura}</span> de <span className="font-semibold text-slate-900">{totalPaginas.toLocaleString("es-PY")}</span>
            </p>
            <div className="flex items-center gap-1">
              <BotonPag onClick={() => setPagina(1)} disabled={paginaSegura === 1} title="Primera página"><ChevronsLeft className="h-4 w-4" /></BotonPag>
              <BotonPag onClick={() => setPagina((x) => Math.max(1, x - 1))} disabled={paginaSegura === 1} title="Anterior"><ChevronLeft className="h-4 w-4" /></BotonPag>
              <div className="mx-1 flex items-center gap-1.5 text-xs text-slate-600">
                <span>Ir a</span>
                <input
                  type="number"
                  min={1}
                  max={totalPaginas}
                  value={paginaSegura}
                  onChange={(e) => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) setPagina(Math.max(1, Math.min(totalPaginas, n))); }}
                  className="h-8 w-16 rounded-md border border-slate-200 bg-white px-2 text-center text-xs outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-100)]"
                />
              </div>
              <BotonPag onClick={() => setPagina((x) => Math.min(totalPaginas, x + 1))} disabled={paginaSegura >= totalPaginas} title="Siguiente"><ChevronRight className="h-4 w-4" /></BotonPag>
              <BotonPag onClick={() => setPagina(totalPaginas)} disabled={paginaSegura >= totalPaginas} title="Última página"><ChevronsRight className="h-4 w-4" /></BotonPag>
            </div>
          </div>
        ) : null}
      </section>

      {form.open ? (
        <ProductoForm
          producto={form.prod}
          categorias={categorias}
          onClose={() => setForm({ open: false, prod: null })}
          onSaved={() => { setForm({ open: false, prod: null }); refrescar(); }}
        />
      ) : null}

      {importando ? (
        <ExcelImportWizard
          entidad="Productos"
          previewUrl="/api/inventario/productos/import/preview"
          commitUrl="/api/inventario/productos/import/commit"
          templateUrl="/api/inventario/productos/import/template"
          permiteCrearFaltantes
          onClose={() => setImportando(false)}
          onCompleted={refrescar}
        />
      ) : null}

      {eliminando ? <ConfirmarEliminar producto={eliminando} onClose={() => setEliminando(null)} onEliminado={() => { setEliminando(null); refrescar(); }} /> : null}
    </div>
  );
}

function BotonPag({ children, onClick, disabled, title }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-label={title}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300">
      {children}
    </button>
  );
}

function ConfirmarEliminar({ producto, onClose, onEliminado }: { producto: ProductoInventario; onClose: () => void; onEliminado: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function eliminar() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/productos/${producto.id}`, { method: "DELETE" });
      onEliminado();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[120] overflow-y-auto bg-slate-900/40 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5" onClick={(e) => e.stopPropagation()} style={{ animation: "rb-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
          <div className="flex flex-col items-center px-6 pb-2 pt-7">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 ring-4 ring-rose-50/60">
              <Trash2 className="h-5 w-5 text-rose-600" />
            </div>
            <h3 className="mt-4 text-center text-base font-semibold tracking-tight text-slate-900">¿Eliminar este producto?</h3>
            <p className="mt-1.5 text-center text-[13px] leading-relaxed text-slate-500">
              Se borra de la base de forma <strong>permanente</strong>. Esta acción no se puede deshacer. Si tiene ventas o movimientos de stock registrados, no se podrá eliminar: en ese caso, desactivalo.
            </p>
          </div>
          <div className="mx-6 mt-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
            <p className="truncate text-[13px] font-semibold text-slate-900">{producto.nombre}</p>
            {producto.sku ? <p className="mt-0.5 text-[11px] uppercase tracking-wider text-slate-400">SKU <span className="font-mono text-slate-500">{producto.sku}</span></p> : null}
          </div>
          {error ? <div className="mx-6 mt-3 rounded-lg border border-rose-100 bg-rose-50/70 px-3 py-2 text-[12px] text-rose-700">{error}</div> : null}
          <div className="mt-5 flex gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
            <button onClick={onClose} disabled={busy} className="flex-1 rounded-lg border-2 border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
            <button onClick={eliminar} disabled={busy} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 active:scale-[0.98] disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              {busy ? "Eliminando..." : "Eliminar"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
