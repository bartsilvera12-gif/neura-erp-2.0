"use client";

/**
 * /inventario/movimientos — Kardex. Cada movimiento nace de un DOCUMENTO con número
 * (compra = recarga de stock, venta, traslado salida/entrada, ajuste, pérdida, anulación):
 * acá no se carga nada a mano. Pestañas por tipo de documento, filtros por depósito /
 * sucursal, producto, tipo, fechas y búsqueda; Exportar Excel. Con ?producto=<id> es el
 * historial de UN producto con el saldo después de cada movimiento (en el depósito elegido
 * o el total).
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine, ArrowLeft, ArrowLeftRight, ArrowUpFromLine, Calendar, ChevronLeft, ChevronRight,
  ClipboardCheck, Download, History, Loader2, Package, Search, X,
} from "lucide-react";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { descargarArchivo } from "@/lib/api/client-blob";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { precargarLista, useListaCacheada } from "@/modules/inventario/lista-cache";
import { GRUPOS_ORIGEN, ORIGEN_LABEL, hrefDocumento, type Movimiento, type TipoMovimiento } from "@/modules/inventario/kardex";
import { hayVariosDepositos, opcionesAlcance, partesAlcance, useDepositos } from "@/modules/inventario/depositos";

const TEAL = clienteConfig.color;
const TZ = "America/Asuncion";
const POR_PAGINA = 25;

const TIPO_ICONO = { ENTRADA: ArrowDownToLine, SALIDA: ArrowUpFromLine } as const;
const ORIGEN_BADGE: Record<string, string> = {
  compra: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  venta: "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  traslado_salida: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  traslado_entrada: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  ajuste: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
  inventario_inicial: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  perdida: "bg-red-50 text-red-700 ring-1 ring-red-200",
  apertura: "bg-slate-50 text-slate-500 ring-1 ring-slate-200",
};
const BADGE_ANULACION = "bg-rose-50 text-rose-700 ring-1 ring-rose-200";

const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const cantidad = (n: number) => Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });
const fecha = (iso: string) =>
  new Date(iso).toLocaleString("es-PY", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", " ·");

type ProductoFiltro = { id: string; nombre: string; sku: string; stock_actual: number; unidad_medida: string; stock_deposito?: number };
type PaginaMov = { rows: Movimiento[]; total: number; producto: ProductoFiltro | null };

export default function MovimientosPage() {
  return (
    <Suspense fallback={null}>
      <Movimientos />
    </Suspense>
  );
}

function Movimientos() {
  const router = useRouter();
  const sp = useSearchParams();
  const productoId = sp.get("producto") ?? "";
  const esAdmin = useUsuario()?.rol === "ADMIN";
  const deps = useDepositos();

  const [exportando, setExportando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [grupo, setGrupo] = useState(sp.get("grupo") ?? "");
  const [tipo, setTipo] = useState("");
  const [alcance, setAlcance] = useState(sp.get("deposito") ? `d:${sp.get("deposito")}` : "");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  useEffect(() => {
    const texto = busqueda.trim();
    if (texto === q) return;
    const t = setTimeout(() => setQ(texto), 350);
    return () => clearTimeout(t);
  }, [busqueda, q]);

  const filtros = useMemo(() => {
    const p = new URLSearchParams();
    const { deposito, sucursal } = partesAlcance(alcance);
    const origenes = GRUPOS_ORIGEN.find((g) => g.id === grupo)?.origenes ?? [];
    if (q) p.set("q", q);
    if (tipo) p.set("tipo", tipo);
    if (origenes.length) p.set("origen", origenes.join(","));
    if (deposito) p.set("deposito", deposito);
    if (sucursal) p.set("sucursal", sucursal);
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    if (productoId) p.set("producto", productoId);
    return p;
  }, [q, tipo, grupo, alcance, desde, hasta, productoId]);

  // La página vuelve a 1 al cambiar un filtro sin un request intermedio con la página vieja.
  const claveFiltros = filtros.toString();
  const [pag, setPag] = useState({ de: claveFiltros, n: 1 });
  const pagina = pag.de === claveFiltros ? pag.n : 1;
  const setPagina = (f: (p: number) => number) =>
    setPag((x) => ({ de: claveFiltros, n: f(x.de === claveFiltros ? x.n : 1) }));

  const urlDe = (n: number) => {
    const p = new URLSearchParams(filtros);
    p.set("pagina", String(n));
    p.set("por_pagina", String(POR_PAGINA));
    return `/api/inventario/movimientos?${p}`;
  };
  const lista = useListaCacheada<PaginaMov>(urlDe(pagina));
  const { cargando } = lista;
  const items = useMemo(() => (lista.error ? [] : lista.datos?.rows ?? []), [lista.datos, lista.error]);
  const total = lista.error ? 0 : lista.datos?.total ?? 0;
  const producto = lista.datos?.producto ?? null;
  const conSaldo = !!productoId;

  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const urlSiguiente = !cargando && !lista.error && pagina < totalPaginas ? urlDe(pagina + 1) : null;
  useEffect(() => {
    if (!urlSiguiente) return;
    const t = setTimeout(() => precargarLista(urlSiguiente), 300);
    return () => clearTimeout(t);
  }, [urlSiguiente]);
  const de = total === 0 ? 0 : (pagina - 1) * POR_PAGINA + 1;
  const a = Math.min(pagina * POR_PAGINA, total);
  const varios = hayVariosDepositos(deps.datos);
  const opcAlcance = opcionesAlcance(deps.datos);
  const nombreAlcance = opcAlcance.find(([v]) => v === alcance)?.[1];

  const filas = useMemo(() => (
    items.map((m) => {
      const Icono = TIPO_ICONO[m.tipo as TipoMovimiento] ?? ArrowDownToLine;
      const entrada = m.tipo === "ENTRADA";
      const href = hrefDocumento(m);
      const badge = m.origen.startsWith("anulacion") ? BADGE_ANULACION : ORIGEN_BADGE[m.origen] ?? ORIGEN_BADGE.ajuste;
      const traslado = m.origen.startsWith("traslado") || m.origen === "anulacion_traslado";
      return (
        <tr key={m.id} className={`align-top transition-colors hover:bg-[var(--brand-50)] ${cargando ? "opacity-60" : ""}`}>
          <td className="whitespace-nowrap px-5 py-3 text-xs tabular-nums text-slate-500">{fecha(m.fecha)}</td>
          <td className="max-w-[240px] px-3 py-3">
            <Link href={`/inventario/movimientos?producto=${m.producto_id}`} className="block truncate font-semibold text-slate-800 hover:text-[var(--brand)] hover:underline" title="Ver el historial de este producto">
              {m.producto_nombre ?? "—"}
            </Link>
            <span className="font-mono text-[11px] text-slate-400">{m.producto_sku}</span>
          </td>
          <td className="px-3 py-3">
            <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold ${badge}`}>{ORIGEN_LABEL[m.origen] ?? m.origen}</span>
            <span className="mt-1 block text-[11px]">
              {m.documento_numero ? (
                href ? <Link href={href} className="font-mono font-semibold text-[var(--brand)] hover:underline">{m.documento_numero}</Link>
                : <span className="font-mono font-semibold text-slate-600">{m.documento_numero}</span>
              ) : <span className="text-slate-300">sin documento</span>}
            </span>
          </td>
          <td className="max-w-[200px] px-3 py-3 text-xs">
            <span className="block truncate font-medium text-slate-700">{m.deposito_nombre ?? "—"}</span>
            {traslado && m.contraparte_nombre ? (
              <span className="flex items-center gap-1 truncate text-[11px] text-indigo-600">
                <ArrowLeftRight className="h-3 w-3 shrink-0" /> {entrada ? "desde" : "hacia"} {m.contraparte_nombre}
              </span>
            ) : varios && m.sucursal_nombre ? <span className="block truncate text-[11px] text-slate-400">{m.sucursal_nombre}</span> : null}
          </td>
          <td className={`whitespace-nowrap px-3 py-3 text-right font-bold tabular-nums ${entrada ? "text-emerald-700" : "text-red-600"}`}>
            <span className="inline-flex items-center gap-1"><Icono className="h-3 w-3" strokeWidth={2.5} />{entrada ? "+" : "−"}{cantidad(Math.abs(m.cantidad))}</span>
          </td>
          {conSaldo ? (
            <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-semibold tabular-nums text-slate-900">{m.saldo == null ? <span className="text-slate-300">—</span> : cantidad(m.saldo)}</td>
          ) : null}
          <td className="whitespace-nowrap px-3 py-3 text-right text-xs tabular-nums text-slate-600">{gs(m.costo_unitario)}</td>
          <td className="max-w-[220px] px-3 py-3 text-xs text-slate-500" title={[m.referencia, m.proveedor, m.numero_factura && `Fact. ${m.numero_factura}`].filter(Boolean).join(" · ")}>
            <span className="block truncate">{m.referencia ?? "—"}</span>
            {m.proveedor || m.numero_factura ? (
              <span className="block truncate text-[11px] text-slate-400">{[m.proveedor, m.numero_factura && `Fact. ${m.numero_factura}`].filter(Boolean).join(" · ")}</span>
            ) : null}
            <span className="block truncate text-[11px] text-slate-400">{m.usuario_nombre ?? ""}</span>
          </td>
        </tr>
      );
    })
  ), [items, cargando, conSaldo, varios]);
  const hayFiltros = !!(busqueda || tipo || grupo || alcance || desde || hasta || productoId);

  function limpiar() {
    setBusqueda("");
    setTipo("");
    setGrupo("");
    setAlcance("");
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
  const nCols = conSaldo ? 8 : 7;

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Inventario · Kardex</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Movimientos de inventario</h1>
          <p className="mt-1 text-sm text-slate-500">Cada entrada y salida, con su documento, depósito y usuario</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {esAdmin ? (
            <>
              <Link href="/inventario/traslados/nuevo" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-[var(--brand)] hover:text-[var(--brand)]">
                <ArrowLeftRight className="h-4 w-4" /> Nuevo traslado
              </Link>
              <Link href="/inventario/ajustes/nuevo?tipo=ajuste" className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95" style={{ backgroundColor: TEAL }}>
                <ClipboardCheck className="h-4 w-4" /> Nuevo ajuste
              </Link>
            </>
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

      {producto ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white px-5 py-4 shadow-sm" style={{ borderColor: `${TEAL}33` }}>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: `${TEAL}1a`, color: TEAL }}>
              <History className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Kardex del producto{alcance ? ` · ${nombreAlcance}` : ""}</p>
              <p className="font-semibold text-slate-900">{producto.nombre} <span className="font-mono text-xs font-normal text-slate-400">{producto.sku}</span></p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{alcance.startsWith("d:") ? "Stock en el depósito" : "Stock total"}</p>
              <p className="text-lg font-semibold tabular-nums text-slate-900">
                {cantidad(producto.stock_deposito ?? producto.stock_actual)}{" "}
                <span className="text-xs font-normal text-slate-400">{producto.unidad_medida}</span>
              </p>
            </div>
            <button onClick={() => router.replace("/inventario/movimientos")} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800">
              <X className="h-3.5 w-3.5" /> Ver todos
            </button>
          </div>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}33` }}>
        {/* Pestañas por tipo de documento */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3" style={{ borderColor: `${TEAL}22`, background: `linear-gradient(to right, ${TEAL}0d, transparent)` }}>
          <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100/80 p-1" role="tablist">
            {GRUPOS_ORIGEN.map((g) => {
              const sel = grupo === g.id;
              return (
                <button key={g.id} role="tab" aria-selected={sel} onClick={() => setGrupo(g.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${sel ? "bg-white text-[var(--brand)] shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
                  {g.label}
                </button>
              );
            })}
          </div>
          <span className="inline-flex h-[22px] items-center justify-center rounded-full px-2 text-[11px] font-bold tabular-nums text-white" style={{ backgroundColor: TEAL }}>
            {total.toLocaleString("es-PY")} {total === 1 ? "movimiento" : "movimientos"}
          </span>
        </div>

        {/* Filtros */}
        <div className="border-b border-slate-100 bg-slate-50/40 px-5 py-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="relative md:col-span-5">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input placeholder="Buscar por producto, SKU, documento, referencia o proveedor..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className={`${input} w-full pl-9 pr-9`} />
              {busqueda ? (
                <button onClick={() => setBusqueda("")} aria-label="Limpiar búsqueda" className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <div className={varios ? "md:col-span-4" : "hidden"}>
              <Select value={alcance} onChange={setAlcance} block options={opcAlcance} />
            </div>
            <div className={varios ? "md:col-span-3" : "md:col-span-3"}>
              <Select value={tipo} onChange={setTipo} block options={[["", "Entradas y salidas"], ["ENTRADA", "Solo entradas"], ["SALIDA", "Solo salidas"]]} />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 items-center gap-3 md:grid-cols-12">
            <div className="flex items-center gap-2 md:col-span-4">
              <Calendar className="h-4 w-4 shrink-0 text-slate-400" />
              <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} max={hasta || undefined} className={`${input} w-full`} aria-label="Desde" />
            </div>
            <span className="hidden justify-center text-xs font-medium text-slate-400 md:col-span-1 md:flex">hasta</span>
            <div className="flex items-center gap-2 md:col-span-4">
              <Calendar className="h-4 w-4 shrink-0 text-slate-400 md:hidden" />
              <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} min={desde || undefined} className={`${input} w-full`} aria-label="Hasta" />
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

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-slate-50/70 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Fecha</th>
                <th className="px-3 py-3 font-semibold">Producto</th>
                <th className="px-3 py-3 font-semibold">Documento</th>
                <th className="px-3 py-3 font-semibold">Depósito</th>
                <th className="px-3 py-3 text-right font-semibold">Cantidad</th>
                {conSaldo ? <th className="px-3 py-3 text-right font-semibold" title="Stock después del movimiento">Saldo</th> : null}
                <th className="px-3 py-3 text-right font-semibold">Costo unit.</th>
                <th className="px-3 py-3 font-semibold">Detalle · usuario</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando && items.length === 0 ? (
                <tr><td colSpan={nCols} className="py-12 text-center text-sm text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={nCols} className="py-16 text-center">
                    <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl border" style={{ backgroundColor: `${TEAL}14`, borderColor: `${TEAL}33` }}>
                      <Package className="h-6 w-6" style={{ color: TEAL }} />
                    </div>
                    <p className="text-sm font-semibold text-slate-700">{hayFiltros ? "Ningún movimiento coincide con los filtros" : "Todavía no hay movimientos"}</p>
                    <p className="mt-1 text-xs text-slate-500">Se generan solos con compras, ventas, traslados, ajustes y pérdidas.</p>
                    {hayFiltros ? <button onClick={limpiar} className="mt-2 text-xs font-semibold hover:underline" style={{ color: TEAL }}>Limpiar filtros</button> : null}
                  </td>
                </tr>
              ) : (
                filas
              )}
            </tbody>
          </table>
        </div>

        {total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/40 px-5 py-3.5">
            <p className="text-xs text-slate-500">
              Mostrando <span className="font-semibold text-slate-700">{de.toLocaleString("es-PY")}</span>–<span className="font-semibold text-slate-700">{a.toLocaleString("es-PY")}</span> de{" "}
              <span className="font-semibold text-slate-700">{total.toLocaleString("es-PY")}</span>
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
    </div>
  );
}
