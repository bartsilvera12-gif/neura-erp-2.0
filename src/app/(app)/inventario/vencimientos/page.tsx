"use client";

/**
 * /inventario/vencimientos — lotes vencidos y por vencer en los próximos N días
 * (7 / 15 / 30 / 60; se recuerda en esta computadora, por defecto 30). Lista sin
 * gráficos: producto, lote, vence, días, unidades y valor al costo; filtros de búsqueda
 * y estado; Exportar Excel. Arriba, una franja de cifras en una línea. Desde cada fila
 * (ADMIN) se puede dar de baja el lote. Sin productos con lotes: estado vacío explicativo.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarClock, Download, Loader2, Search, X } from "lucide-react";
import { invalidarLista, useListaCacheada } from "@/modules/inventario/lista-cache";
import { descargarArchivo } from "@/lib/api/client-blob";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { DarDeBajaLote } from "@/modules/inventario/LotesProducto";
import {
  OPCIONES_DIAS, diasAlerta, fechaCorta, guardarDiasAlerta, textoDias,
  type FilaVencimiento, type ReporteVencimientos,
} from "@/modules/inventario/vencimientos";

const TEAL = clienteConfig.color;
const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const cant = (n: number) => Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });

export default function VencimientosPage() {
  const esAdmin = useUsuario()?.rol === "ADMIN";
  const [dias, setDias] = useState<number | null>(null); // null hasta leer la preferencia
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("");
  const [exportando, setExportando] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const [baja, setBaja] = useState<FilaVencimiento | null>(null);

  useEffect(() => setDias(diasAlerta()), []);
  // Debounce de la búsqueda; no dispara si el texto no cambió (al montar).
  useEffect(() => {
    const texto = busqueda.trim();
    if (texto === q) return;
    const t = setTimeout(() => setQ(texto), 300);
    return () => clearTimeout(t);
  }, [busqueda, q]);

  const filtros = useMemo(() => {
    const sp = new URLSearchParams({ dias: String(dias ?? 30) });
    if (q) sp.set("q", q);
    if (estado) sp.set("estado", estado);
    return sp;
  }, [dias, q, estado]);

  // Un request por combinación de filtros, cacheado (volver a la pantalla pinta al
  // instante y se refresca en segundo plano); mientras llega, queda la lista anterior.
  const lista = useListaCacheada<ReporteVencimientos>(dias == null ? null : `/api/inventario/vencimientos?${filtros}`, recarga);
  const { datos, error } = lista;
  const cargando = lista.cargando || dias == null;

  function cambiarDias(v: string) {
    const n = Number(v);
    setDias(n);
    guardarDiasAlerta(n);
  }

  async function exportar() {
    setExportando(true);
    try {
      await descargarArchivo(`/api/inventario/vencimientos/export?${filtros}`, "vencimientos.xlsx");
    } catch {
      /* best-effort */
    } finally {
      setExportando(false);
    }
  }

  const t = datos?.totales;
  const items = useMemo(() => datos?.items ?? [], [datos]);
  const sinLotes = datos && !datos.hay_productos_con_lotes;
  // Filas memorizadas: con miles de lotes, escribir en el buscador no re-renderiza la tabla
  // en cada tecla (solo cuando cambian los datos).
  const filas = useMemo(() => (
    items.map((f) => {
      const vencido = f.estado === "vencido";
      return (
        <tr key={f.lote_id} className={`transition-colors hover:bg-[var(--brand-50)] ${cargando ? "opacity-60" : ""}`}>
          <td className="px-5 py-3">
            <p className="font-semibold text-slate-900">{f.producto}</p>
            <p className="font-mono text-[11px] text-slate-500">{f.sku}</p>
          </td>
          <td className="px-3 py-3 font-mono text-xs font-semibold text-slate-700">{f.numero}</td>
          <td className="whitespace-nowrap px-3 py-3 text-slate-700">{fechaCorta(f.vencimiento)}</td>
          <td className="whitespace-nowrap px-3 py-3">
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${vencido ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200" : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"}`}>
              {vencido ? `Vencido ${textoDias(f.dias)}` : `Vence ${textoDias(f.dias)}`}
            </span>
          </td>
          <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-slate-900">{cant(f.cantidad)} <span className="text-[10px] font-normal text-slate-400">{f.unidad_medida === "Unidad" ? "u." : f.unidad_medida}</span></td>
          <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-slate-700">{gs(f.valor)}</td>
          {esAdmin ? (
            <td className="px-5 py-3 text-right">
              <button onClick={() => setBaja(f)} className="whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700">
                Dar de baja
              </button>
            </td>
          ) : null}
        </tr>
      );
    })
  ), [items, cargando, esAdmin]);
  const hayFiltros = !!(busqueda || estado);
  const input = "h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Inventario · Lotes</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Vencimientos</h1>
          <p className="mt-1 text-sm text-slate-500">Lotes vencidos y los que vencen pronto, para venderlos o darlos de baja a tiempo</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportar} disabled={exportando || items.length === 0} className="inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-semibold transition hover:bg-[var(--brand-50)] disabled:opacity-50" style={{ borderColor: `${TEAL}55`, color: TEAL }}>
            {exportando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exportando ? "Generando..." : "Exportar Excel"}
          </button>
          <Link href="/inventario" className="group inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-[var(--brand)] hover:text-[var(--brand)]">
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" /> Inventario
          </Link>
        </div>
      </header>

      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}33` }}>
        {/* Franja de cifras (una línea) */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b px-5 py-3 text-sm" style={{ borderColor: `${TEAL}22`, background: `linear-gradient(to right, ${TEAL}0d, transparent)` }}>
          <span className="text-slate-600">
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-rose-500 align-middle" />
            Vencidos: <strong className="tabular-nums text-rose-700">{t ? cant(t.vencidos_unidades) : "—"} unid.</strong>
            <span className="text-slate-400"> · </span><strong className="tabular-nums text-slate-800">{t ? gs(t.vencidos_valor) : "—"}</strong>
          </span>
          <span className="text-slate-600">
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle" />
            Vencen en {dias ?? 30} días: <strong className="tabular-nums text-amber-700">{t ? cant(t.por_vencer_unidades) : "—"} unid.</strong>
            <span className="text-slate-400"> · </span><strong className="tabular-nums text-slate-800">{t ? gs(t.por_vencer_valor) : "—"}</strong>
          </span>
          <span className="ml-auto text-[11px] text-slate-400">Valor al costo de cada lote</span>
        </div>

        {/* Filtros */}
        <div className="border-b border-slate-100 bg-slate-50/40 px-5 py-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="relative md:col-span-6">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input placeholder="Buscar por producto, SKU o lote..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className={`${input} w-full pl-9 pr-9`} />
              {busqueda ? (
                <button onClick={() => setBusqueda("")} aria-label="Limpiar búsqueda" className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <div className="md:col-span-3">
              <Select value={estado} onChange={setEstado} block options={[["", "Vencidos y por vencer"], ["vencido", "Solo vencidos"], ["por_vencer", "Solo por vencer"]]} />
            </div>
            <div className="md:col-span-3">
              <Select value={String(dias ?? 30)} onChange={cambiarDias} block options={OPCIONES_DIAS.map((n): [string, string] => [String(n), `Próximos ${n} días`])} />
            </div>
          </div>
          {hayFiltros ? (
            <div className="mt-2 flex justify-end">
              <button onClick={() => { setBusqueda(""); setEstado(""); }} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-[var(--brand-50)] hover:text-[var(--brand)]">
                <X className="h-3.5 w-3.5" /> Limpiar filtros
              </button>
            </div>
          ) : null}
        </div>

        {/* Lista */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-slate-50/70 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Producto</th>
                <th className="px-3 py-3 font-semibold">Lote</th>
                <th className="px-3 py-3 font-semibold">Vence</th>
                <th className="px-3 py-3 font-semibold">Días</th>
                <th className="px-3 py-3 text-right font-semibold">Unidades</th>
                <th className="px-3 py-3 text-right font-semibold">Valor al costo</th>
                {esAdmin ? <th className="w-px px-5 py-3" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando && !datos ? (
                <tr><td colSpan={7} className="px-5 py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /></td></tr>
              ) : error ? (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-rose-600">No se pudieron cargar los vencimientos. Probá de nuevo.</td></tr>
              ) : sinLotes ? (
                <tr>
                  <td colSpan={7} className="px-5 py-14 text-center">
                    <CalendarClock className="mx-auto h-8 w-8 text-slate-300" />
                    <p className="mt-3 text-sm font-medium text-slate-700">Todavía no hay productos con lotes</p>
                    <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
                      Para perecibles (alimentos, medicamentos, veterinaria), abrí el producto en <Link href="/inventario" className="font-semibold text-[var(--brand)] hover:underline">Inventario</Link> y
                      activá <strong>Controla lotes y vencimiento</strong>. Desde ahí cada compra pide lote y vencimiento, la caja vende primero el que vence antes y acá vas a ver lo que vence.
                    </p>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-14 text-center">
                    <CalendarClock className="mx-auto h-8 w-8 text-slate-300" />
                    <p className="mt-3 text-sm font-medium text-slate-700">{hayFiltros ? "Ningún lote coincide con los filtros" : `Nada vencido ni por vencer en los próximos ${dias} días`}</p>
                    <p className="mt-1 text-xs text-slate-500">{hayFiltros ? "Probá con otra búsqueda o cambiá el estado." : "Probá con un rango de días más largo."}</p>
                  </td>
                </tr>
              ) : (
                filas
              )}
            </tbody>
          </table>
        </div>
        {items.length ? (
          <p className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-slate-500">
            {items.length} {items.length === 1 ? "lote" : "lotes"}. La caja no vende los vencidos: dalos de baja (o devolvelos al proveedor) para que el stock quede al día.
          </p>
        ) : null}
      </section>

      {baja ? (
        <DarDeBajaLote
          lote={{ id: baja.lote_id, numero: baja.numero, vencimiento: baja.vencimiento, cantidad: baja.cantidad, producto: baja.producto }}
          unidad={baja.unidad_medida === "Unidad" ? "u." : baja.unidad_medida}
          onClose={() => setBaja(null)}
          onHecho={() => { setBaja(null); invalidarLista("/api/productos"); invalidarLista("/api/inventario/movimientos"); setRecarga((k) => k + 1); }}
        />
      ) : null}
    </div>
  );
}
