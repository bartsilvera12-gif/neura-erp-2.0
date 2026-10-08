"use client";

/**
 * /inventario/movimientos — Movimientos de inventario (kardex), portado de Ferretería
 * República: historial de entradas y salidas con filtros por producto/SKU/referencia,
 * tipo, origen y fechas; paginado en el servidor. Suma: Exportar Excel y el historial de
 * UN producto (?producto=<id>, enlace desde el panel del producto).
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Calendar, ChevronLeft, ChevronRight,
  Download, History, Loader2, Package, Plus, Search, X,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { NuevoMovimiento } from "@/modules/inventario/NuevoMovimiento";
import { ORIGEN_LABEL, type Movimiento, type OrigenMovimiento, type TipoMovimiento } from "@/modules/inventario/kardex";

const TEAL = clienteConfig.color;
const TZ = "America/Asuncion";
const POR_PAGINA = 25;

const TIPO_BADGE: Record<TipoMovimiento, string> = {
  ENTRADA: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  SALIDA: "bg-red-50 text-red-700 border border-red-200",
};
const TIPO_ICONO = { ENTRADA: ArrowDownToLine, SALIDA: ArrowUpFromLine } as const;
const ORIGEN_BADGE: Record<OrigenMovimiento, string> = {
  compra: "bg-sky-50 text-sky-700 border border-sky-200",
  venta: "bg-violet-50 text-violet-700 border border-violet-200",
  anulacion_venta: "bg-rose-50 text-rose-700 border border-rose-200",
  anulacion_compra: "bg-rose-50 text-rose-700 border border-rose-200",
  ajuste_manual: "bg-slate-100 text-slate-600 border border-slate-200",
  inventario_inicial: "bg-orange-50 text-orange-700 border border-orange-200",
};

const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const cantidad = (n: number) => Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });
const fecha = (iso: string) =>
  new Date(iso).toLocaleString("es-PY", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", " ·");

type ProductoFiltro = { id: string; nombre: string; sku: string; stock_actual: number; unidad_medida: string };

export default function MovimientosPage() {
  return (
    <Suspense fallback={null}>
      <Movimientos />
    </Suspense>
  );
}

function Movimientos() {
  const router = useRouter();
  const productoId = useSearchParams().get("producto") ?? "";

  const [items, setItems] = useState<Movimiento[]>([]);
  const [total, setTotal] = useState(0);
  const [producto, setProducto] = useState<ProductoFiltro | null>(null);
  const [cargando, setCargando] = useState(true);
  const [exportando, setExportando] = useState(false);
  const [esAdmin, setEsAdmin] = useState(false);
  const [nuevo, setNuevo] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    apiFetch<{ rol: string }>("/api/me").then((m) => setEsAdmin(m.rol === "ADMIN")).catch(() => {});
  }, []);

  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState("");
  const [origen, setOrigen] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [pagina, setPagina] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setQ(busqueda.trim()), 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  useEffect(() => { setPagina(1); }, [q, tipo, origen, desde, hasta, productoId]);

  const filtros = useMemo(() => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (tipo) sp.set("tipo", tipo);
    if (origen) sp.set("origen", origen);
    if (desde) sp.set("desde", desde);
    if (hasta) sp.set("hasta", hasta);
    if (productoId) sp.set("producto", productoId);
    return sp;
  }, [q, tipo, origen, desde, hasta, productoId]);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    const sp = new URLSearchParams(filtros);
    sp.set("pagina", String(pagina));
    sp.set("por_pagina", String(POR_PAGINA));
    apiFetch<{ rows: Movimiento[]; total: number; producto: ProductoFiltro | null }>(`/api/inventario/movimientos?${sp}`)
      .then((r) => { if (!cancel) { setItems(r.rows); setTotal(r.total); setProducto(r.producto); } })
      .catch(() => { if (!cancel) { setItems([]); setTotal(0); } })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [filtros, pagina, recarga]);

  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const de = total === 0 ? 0 : (pagina - 1) * POR_PAGINA + 1;
  const a = Math.min(pagina * POR_PAGINA, total);
  const hayFiltros = !!(busqueda || tipo || origen || desde || hasta || productoId);

  function limpiar() {
    setBusqueda("");
    setTipo("");
    setOrigen("");
    setDesde("");
    setHasta("");
    if (productoId) router.replace("/inventario/movimientos");
  }

  async function exportar() {
    setExportando(true);
    try {
      await descargarArchivo(`/api/inventario/movimientos/export?${filtros}`, "movimientos.xlsx");
    } catch {
      /* best-effort */
    } finally {
      setExportando(false);
    }
  }

  const input = "h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";

  return (
    <div className="space-y-6 pb-10">
      {/* Encabezado */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Inventario · Historial</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Movimientos de inventario</h1>
          <p className="mt-1 text-sm text-slate-500">Registro de entradas y salidas de stock</p>
        </div>
        <div className="flex items-center gap-2">
          {esAdmin ? (
            <button onClick={() => setNuevo(true)} className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95" style={{ backgroundColor: TEAL }}>
              <Plus className="h-4 w-4" strokeWidth={2.5} /> Nuevo movimiento
            </button>
          ) : null}
          <button onClick={exportar} disabled={exportando || total === 0} className="inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-semibold transition hover:bg-[var(--brand-50)] disabled:opacity-50" style={{ borderColor: `${TEAL}55`, color: TEAL }}>
            {exportando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exportando ? "Generando..." : "Exportar Excel"}
          </button>
          <Link href="/inventario" className="group inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-[var(--brand)] hover:text-[var(--brand)]">
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" /> Inventario
          </Link>
        </div>
      </header>

      {/* Historial de un producto */}
      {producto ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white px-5 py-4 shadow-sm" style={{ borderColor: `${TEAL}33` }}>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: `${TEAL}1a`, color: TEAL }}>
              <History className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Historial del producto</p>
              <p className="font-semibold text-slate-900">{producto.nombre} <span className="font-mono text-xs font-normal text-slate-400">{producto.sku}</span></p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Stock actual</p>
              <p className="text-lg font-semibold tabular-nums text-slate-900">{cantidad(producto.stock_actual)} <span className="text-xs font-normal text-slate-400">{producto.unidad_medida}</span></p>
            </div>
            <button onClick={() => router.replace("/inventario/movimientos")} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800">
              <X className="h-3.5 w-3.5" /> Ver todos
            </button>
          </div>
        </div>
      ) : null}

      {/* Tarjeta principal */}
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}33` }}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: `${TEAL}22`, background: `linear-gradient(to right, ${TEAL}0d, transparent)` }}>
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-bold leading-none text-slate-800">Historial</h2>
            <span className="inline-flex h-[22px] items-center justify-center rounded-full px-2 text-[11px] font-bold tabular-nums text-white" style={{ backgroundColor: TEAL }}>
              {total.toLocaleString("es-PY")} {total === 1 ? "registro" : "registros"}
            </span>
          </div>
          <p className="text-[11.5px] text-slate-500">
            Se generan solos desde la <span className="font-semibold" style={{ color: TEAL }}>Caja</span> y las <span className="font-semibold" style={{ color: TEAL }}>importaciones</span>, o a mano con <span className="font-semibold" style={{ color: TEAL }}>Nuevo movimiento</span>.
          </p>
        </div>

        {/* Filtros */}
        <div className="border-b border-slate-100 bg-slate-50/40 px-5 py-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="relative md:col-span-6">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                placeholder="Buscar por producto, SKU, referencia, proveedor o factura..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className={`${input} w-full pl-9 pr-9`}
              />
              {busqueda ? (
                <button onClick={() => setBusqueda("")} aria-label="Limpiar búsqueda" className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <div className="md:col-span-3">
              <Select value={tipo} onChange={setTipo} block options={[["", "Todos los tipos"], ["ENTRADA", "Entradas"], ["SALIDA", "Salidas"]]} />
            </div>
            <div className="md:col-span-3">
              <Select value={origen} onChange={setOrigen} block options={[["", "Todos los orígenes"], ...Object.entries(ORIGEN_LABEL).map(([k, v]): [string, string] => [k, v])]} />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 items-center gap-3 md:grid-cols-12">
            <div className="flex items-center gap-2 md:col-span-4">
              <Calendar className="h-4 w-4 shrink-0 text-slate-400" />
              <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} max={hasta || undefined} className={`${input} w-full`} />
            </div>
            <span className="hidden justify-center text-xs font-medium text-slate-400 md:col-span-1 md:flex">hasta</span>
            <div className="flex items-center gap-2 md:col-span-4">
              <Calendar className="h-4 w-4 shrink-0 text-slate-400 md:hidden" />
              <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} min={desde || undefined} className={`${input} w-full`} />
            </div>
            <div className="flex justify-end md:col-span-3">
              {hayFiltros ? (
                <button onClick={limpiar} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 transition hover:bg-[var(--brand-50)] hover:text-[var(--brand)]">
                  <X className="h-3.5 w-3.5" /> Limpiar filtros
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* Tabla */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-slate-50/70 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Producto</th>
                <th className="px-3 py-3 font-semibold">SKU</th>
                <th className="px-3 py-3 font-semibold">Tipo</th>
                <th className="px-3 py-3 text-right font-semibold">Cantidad</th>
                <th className="px-3 py-3 text-right font-semibold">Costo unit.</th>
                <th className="px-3 py-3 font-semibold">Origen</th>
                <th className="px-3 py-3 font-semibold">Referencia</th>
                <th className="px-3 py-3 font-semibold">Usuario</th>
                <th className="px-3 py-3 font-semibold">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando && items.length === 0 ? (
                <tr><td colSpan={9} className="py-12 text-center text-sm text-slate-400">Cargando...</td></tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center">
                    <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl border" style={{ backgroundColor: `${TEAL}14`, borderColor: `${TEAL}33` }}>
                      <Package className="h-6 w-6" style={{ color: TEAL }} />
                    </div>
                    <p className="text-sm font-semibold text-slate-700">{hayFiltros ? "Ningún movimiento coincide con los filtros" : "No hay movimientos registrados"}</p>
                    {hayFiltros ? <button onClick={limpiar} className="mt-2 text-xs font-semibold hover:underline" style={{ color: TEAL }}>Limpiar filtros</button> : null}
                  </td>
                </tr>
              ) : (
                items.map((m) => {
                  const Icono = TIPO_ICONO[m.tipo] ?? ArrowDownToLine;
                  const entrada = m.tipo === "ENTRADA";
                  return (
                    <tr key={m.id} className={`transition-colors hover:bg-[var(--brand-50)] ${cargando ? "opacity-60" : ""}`}>
                      <td className="px-5 py-3">
                        <Link href={`/inventario/movimientos?producto=${m.producto_id}`} className="font-semibold text-slate-800 hover:text-[var(--brand)] hover:underline" title="Ver el historial de este producto">
                          {m.producto_nombre ?? "—"}
                        </Link>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-slate-500">{m.producto_sku}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold ${TIPO_BADGE[m.tipo]}`}>
                          <Icono className="h-3 w-3" strokeWidth={2.5} /> {m.tipo}
                        </span>
                      </td>
                      <td className={`px-3 py-3 text-right font-bold tabular-nums ${entrada ? "text-emerald-700" : "text-red-600"}`}>
                        {entrada ? "+" : "−"}{cantidad(Math.abs(m.cantidad))}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right text-xs tabular-nums text-slate-700">{gs(m.costo_unitario)}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold ${ORIGEN_BADGE[m.origen] ?? ORIGEN_BADGE.ajuste_manual}`}>
                          {ORIGEN_LABEL[m.origen] ?? m.origen}
                        </span>
                      </td>
                      <td className="max-w-[220px] px-3 py-3 text-xs text-slate-500" title={[m.referencia, m.proveedor, m.numero_factura && `Fact. ${m.numero_factura}`].filter(Boolean).join(" · ")}>
                        <span className="block truncate">{m.referencia ?? "—"}</span>
                        {m.proveedor || m.numero_factura ? (
                          <span className="block truncate text-[11px] text-slate-400">{[m.proveedor, m.numero_factura && `Fact. ${m.numero_factura}`].filter(Boolean).join(" · ")}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600">{m.usuario_nombre ?? <span className="text-slate-300">—</span>}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs tabular-nums text-slate-500">{fecha(m.fecha)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginado */}
        {total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/40 px-5 py-3.5">
            <p className="text-xs text-slate-500">
              Mostrando <span className="font-semibold text-slate-700">{de.toLocaleString("es-PY")}</span>–<span className="font-semibold text-slate-700">{a.toLocaleString("es-PY")}</span> de{" "}
              <span className="font-semibold text-slate-700">{total.toLocaleString("es-PY")}</span> {total === 1 ? "movimiento" : "movimientos"}
            </p>
            <div className="flex items-center gap-1.5">
              <button disabled={pagina <= 1 || cargando} onClick={() => setPagina((p) => Math.max(1, p - 1))} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-40">
                <ChevronLeft className="h-3.5 w-3.5" /> Anterior
              </button>
              <span className="px-3 py-1.5 text-xs font-semibold tabular-nums text-slate-700">{pagina} / {totalPaginas}</span>
              <button disabled={pagina >= totalPaginas || cargando} onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-40">
                Siguiente <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {nuevo ? (
        <NuevoMovimiento
          productoInicial={productoId || undefined}
          onClose={() => setNuevo(false)}
          onGuardado={() => { setNuevo(false); setPagina(1); setRecarga((k) => k + 1); }}
        />
      ) : null}
    </div>
  );
}
