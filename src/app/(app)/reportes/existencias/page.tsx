"use client";

/**
 * /reportes/existencias — Existencias por depósito (receta 80). Foto de HOY del stock: una fila
 * por producto y una columna por depósito activo (ordenados por sucursal; encabezado con la
 * sucursal arriba y el depósito abajo), Total y Valor del stock por capas de costo PEPS (solo
 * con "ver costos"). Pie con totales por depósito y general.
 * Filtros: sucursal, depósito, categoría, tipo (solo con Recetas), "Solo con stock" (prendido
 * por defecto), "Bajo el mínimo" y buscador inteligente (nombre, SKU, código de barras).
 * Celdas: ámbar bajo el mínimo, gris tenue en 0, rojo si es negativo. Tocar una celda abre el
 * detalle de ese producto en ese depósito (capas vigentes y lotes con vencimiento).
 * Escritorio/tablet: tabla con la 1.ª columna fija y scroll horizontal (TablaScroll, auto-scroll
 * en los bordes). Celular: una tarjeta por producto con sus depósitos. Excel y PDF apaisado.
 */
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Layers, Loader2, RefreshCw, Search, Warehouse, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { Select } from "@/components/Select";
import { BarraFiltros } from "@/components/EncabezadoPagina";
import { TablaScroll, useVistaTarjetas } from "@/components/TablaResponsive";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { Descargas, EncabezadoReporte, EstadoCarga, FilaKpis, Kpi, Nota, useReporte } from "@/modules/reportes/ui";
import { Paginador } from "@/modules/inventario/ui";
import { opcionesFiltroCategoria, type Categoria } from "@/modules/inventario/categorias";
import { origenTexto } from "@/modules/inventario/CostoPorCompra";
import { fechaCorta, textoDias } from "@/modules/inventario/vencimientos";
import {
  buscarExistencias, textoGenerado, totalesExistencias,
  type DepositoExistencias, type DetalleCelda, type ItemExistencias, type ReporteExistencias,
} from "@/modules/reportes/existencias";

const POR_PAGINA = 50;
const gs = (v: number | null | undefined) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const num = (v: number | null | undefined) => Number(v || 0).toLocaleString("es-PY", { maximumFractionDigits: 3 });
const uni = (u: string) => (u === "Unidad" ? "u." : u);

type Orden = { campo: "nombre" | "total" | "valor"; dir: "asc" | "desc" };

/** Color de una cantidad: negativo rojo, 0 gris tenue, bajo el mínimo ámbar. */
function tonoCantidad(q: number, minimo: number) {
  if (q < 0) return "font-semibold text-rose-600";
  if (q === 0) return "text-slate-300";
  if (minimo > 0 && q < minimo) return "font-semibold text-amber-700";
  return "text-slate-700";
}
const fondoCantidad = (q: number, minimo: number) => (q < 0 ? "bg-rose-50" : q > 0 && minimo > 0 && q < minimo ? "bg-amber-50" : "");

const CHIP_TOGGLE = (on: boolean) =>
  `flex h-[38px] cursor-pointer select-none items-center gap-2 whitespace-nowrap rounded-xl border px-3 text-[13px] transition max-md:h-12 max-md:text-sm ${on ? "border-[color-mix(in_srgb,var(--brand)_38%,white)] bg-[var(--brand-50)] font-semibold text-[var(--brand)]" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`;

export default function ReporteExistenciasPage() {
  const [sucursal, setSucursal] = useState("");
  const [deposito, setDeposito] = useState("");
  const [categoria, setCategoria] = useState("");
  const [tipo, setTipo] = useState("");
  const [soloStock, setSoloStock] = useState(true);
  const [bajo, setBajo] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [orden, setOrden] = useState<Orden>({ campo: "nombre", dir: "asc" });
  const [pagina, setPagina] = useState(1);
  const [celda, setCelda] = useState<{ item: ItemExistencias; dep: DepositoExistencias } | null>(null);
  const tarjetas = useVistaTarjetas();

  const filtros = useMemo(() => {
    const sp = new URLSearchParams();
    if (sucursal) sp.set("sucursal", sucursal);
    if (deposito) sp.set("deposito", deposito);
    if (categoria) sp.set("categoria", categoria);
    if (tipo) sp.set("tipo", tipo);
    if (!soloStock) sp.set("todos", "1");
    if (bajo) sp.set("bajo", "1");
    return sp.toString();
  }, [sucursal, deposito, categoria, tipo, soloStock, bajo]);

  const { data: d, error, cargando, recargar } = useReporte<ReporteExistencias>(`/api/reportes/existencias?${filtros}`);
  useEffect(() => {
    apiFetch<{ categorias: Categoria[] }>("/api/inventario/categorias").then((r) => setCategorias(r.categorias)).catch(() => {});
  }, []);

  const q = useDeferredValue(busqueda);
  const filtradas = useMemo(() => buscarExistencias(d?.items ?? [], q), [d, q]);
  const ordenadas = useMemo(() => {
    // Con búsqueda y orden por producto, queda el orden de relevancia del buscador.
    if (orden.campo === "nombre" && q.trim()) return orden.dir === "asc" ? filtradas : [...filtradas].reverse();
    const s = orden.dir === "asc" ? 1 : -1;
    return [...filtradas].sort((a, b) =>
      orden.campo === "nombre" ? s * a.nombre.localeCompare(b.nombre, "es")
        : orden.campo === "total" ? s * (Number(a.total) - Number(b.total)) || a.nombre.localeCompare(b.nombre, "es")
          : s * (Number(a.valor ?? 0) - Number(b.valor ?? 0)) || a.nombre.localeCompare(b.nombre, "es"));
  }, [filtradas, orden, q]);
  useEffect(() => setPagina(1), [filtros, q, orden]);
  const visibles = ordenadas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const t = useMemo(() => (d ? totalesExistencias(d, filtradas) : null), [d, filtradas]);
  const costos = !!d?.ver_costos;
  const deps = d?.depositos ?? [];

  const exportQs = `${filtros}${busqueda.trim() ? `${filtros ? "&" : ""}q=${encodeURIComponent(busqueda.trim())}` : ""}`;
  const activos = [sucursal, deposito, categoria, tipo].filter(Boolean).length + (soloStock ? 0 : 1) + (bajo ? 1 : 0);
  const limpiar = () => { setSucursal(""); setDeposito(""); setCategoria(""); setTipo(""); setSoloStock(true); setBajo(false); };
  const ordenar = (campo: Orden["campo"]) =>
    setOrden((o) => (o.campo === campo ? { campo, dir: o.dir === "asc" ? "desc" : "asc" } : { campo, dir: campo === "nombre" ? "asc" : "desc" }));

  const sucursales = d?.sucursales ?? [];
  const opcionesDep = d?.opciones_depositos ?? [];

  return (
    <div className="space-y-6 pb-10">
      <EncabezadoReporte kicker="Reportes · Inventario" titulo="Existencias por depósito"
        subtitulo={<>Cuánto hay de cada producto en cada depósito{costos ? ", y cuánto vale según lo que costó cada compra" : ""}.{d ? <> <span className="whitespace-nowrap font-medium text-slate-600">Existencias al {textoGenerado(d.generado)}</span></> : null}</>}>
        <Descargas excel={`/api/reportes/existencias/export?${exportQs}`} pdf={`/api/reportes/existencias/pdf?${exportQs}`} deshabilitado={!filtradas.length} />
      </EncabezadoReporte>

      <FilaKpis n={costos ? 4 : 3}>
        <Kpi acento label="Productos" valor={t ? num(t.productos) : "—"} hint={soloStock ? "con stock" : "incluye sin stock"} />
        <Kpi label="Unidades" valor={t ? num(t.unidades) : "—"} hint={`en ${deps.length} depósito${deps.length === 1 ? "" : "s"}`} />
        {costos ? <Kpi label="Valor del stock" valor={t ? gs(t.valor) : "—"} hint="costo de cada compra (PEPS)" /> : null}
        <Kpi label="Bajo el mínimo" valor={t ? num(t.bajo) : "—"} hint="total menor al stock mínimo" tono={t?.bajo ? "alerta" : undefined} onClick={!bajo && t?.bajo ? () => setBajo(true) : undefined} />
      </FilaKpis>

      <BarraFiltros
        activos={activos}
        onLimpiar={limpiar}
        busqueda={
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar producto o código…" type="search" enterKeyHint="search"
              aria-label="Buscar producto"
              className="h-[38px] w-full rounded-xl border border-slate-200 bg-white pl-9 pr-9 text-[13px] outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)] max-md:h-11 max-md:text-sm [&::-webkit-search-cancel-button]:hidden" />
            {busqueda ? (
              <button onClick={() => setBusqueda("")} aria-label="Limpiar búsqueda" className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"><X className="h-3.5 w-3.5" /></button>
            ) : null}
          </div>
        }
        extra={
          <button onClick={recargar} aria-label="Actualizar" className="inline-flex h-[38px] shrink-0 items-center gap-2 rounded-xl border border-[var(--brand-100)] px-3 text-[13px] font-semibold text-[var(--brand)] transition hover:bg-[var(--brand-50)] max-md:h-11 max-md:w-11 max-md:justify-center max-md:px-0">
            <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin motion-reduce:animate-none" : ""}`} /> <span className="max-lg:hidden">Actualizar</span>
          </button>
        }>
        {sucursales.length > 1 ? (
          <Select chip prefijo="Sucursal" textoVacio="Todas" value={sucursal} onChange={(v) => { setSucursal(v); setDeposito(""); }} minWidth={200} etiqueta="Sucursal"
            options={[["", "Todas las sucursales"], ...sucursales.map((s): [string, string] => [s.id, s.nombre])]} />
        ) : null}
        {opcionesDep.length > 1 || deposito ? (
          <Select chip prefijo="Depósito" textoVacio="Todos" value={deposito} onChange={setDeposito} minWidth={220} etiqueta="Depósito"
            options={[["", "Todos los depósitos"], ...opcionesDep.map((o): [string, string] => [o.id, sucursales.length > 1 && !sucursal ? `${o.sucursal} › ${o.nombre}` : o.nombre])]} />
        ) : null}
        <Select chip prefijo="Categoría" textoVacio="Todas" value={categoria} onChange={setCategoria} minWidth={220} etiqueta="Categoría" className="max-w-[260px] max-md:max-w-none"
          options={[["", "Todas las categorías"], ["__sin__", "— Sin categoría —"], ...opcionesFiltroCategoria(categorias)]} />
        {d?.recetas ? (
          <Select chip prefijo="Tipo" textoVacio="Todos" value={tipo} onChange={setTipo} minWidth={200} etiqueta="Tipo de producto"
            options={[["", "Reventa, fabricados y materias primas"], ["reventa", "Reventa"], ["fabricado", "Fabricados"], ["materia_prima", "Materias primas"]]} />
        ) : null}
        <label className={CHIP_TOGGLE(soloStock)}>
          <input type="checkbox" checked={soloStock} onChange={(e) => setSoloStock(e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-[var(--brand)]" />
          Solo con stock
        </label>
        <label className={CHIP_TOGGLE(bajo)}>
          <input type="checkbox" checked={bajo} onChange={(e) => setBajo(e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-[var(--brand)]" />
          Bajo el mínimo
        </label>
      </BarraFiltros>

      {error && !d ? <EstadoCarga error={error} /> : !d ? <EstadoCarga /> : (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-100 px-3.5 py-3 sm:px-5">
            <Warehouse className="h-4 w-4 text-[var(--brand)]" aria-hidden />
            <h2 className="text-[15px] font-bold text-slate-800">Stock por depósito</h2>
            {cargando ? <Loader2 className="h-4 w-4 animate-spin text-[var(--brand)] motion-reduce:animate-none" /> : <span className="text-xs text-slate-400">{num(filtradas.length)} producto{filtradas.length === 1 ? "" : "s"}</span>}
            <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 max-sm:w-full">
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-100 ring-1 ring-amber-300" /> Bajo el mínimo</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-slate-100 ring-1 ring-slate-200" /> Sin stock</span>
              <span className="max-md:hidden">Tocá una cantidad para ver su detalle</span>
            </span>
          </div>

          {filtradas.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm text-slate-500">{d.items.length === 0 ? "No hay productos con estos filtros." : "Ningún producto coincide con la búsqueda."}</p>
              {deps.length === 0 ? <p className="mt-1 text-xs text-slate-400">No hay depósitos activos en esta sucursal.</p> : null}
            </div>
          ) : tarjetas ? (
            <Tarjetas filas={visibles} deps={deps} costos={costos} onCelda={(item, dep) => setCelda({ item, dep })} t={t!} />
          ) : (
            <TablaExistencias filas={visibles} deps={deps} costos={costos} orden={orden} onOrdenar={ordenar} onCelda={(item, dep) => setCelda({ item, dep })} t={t!} />
          )}
          <Paginador pagina={pagina} porPagina={POR_PAGINA} total={ordenadas.length} onCambiar={(n) => { setPagina(n); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
        </section>
      )}

      {d ? (
        <Nota>
          Existencias al {textoGenerado(d.generado)} (no depende de fechas). El total es la suma de los depósitos que se muestran.
          {costos ? " Valor = lo que costó cada compra que sigue en stock (capas PEPS y, si el producto controla lotes, el costo de cada lote); lo que no tiene una compra registrada se valoriza al costo promedio." : ""}
          {d.recetas ? " Incluye materias primas; los platos del Menú no tienen stock propio." : ""}
        </Nota>
      ) : null}

      {celda ? <DetalleCeldaModal item={celda.item} dep={celda.dep} onClose={() => setCelda(null)} /> : null}
    </div>
  );
}

// ── Escritorio / tablet: tabla con la 1.ª columna fija ─────────────────────────
function TablaExistencias({ filas, deps, costos, orden, onOrdenar, onCelda, t }: {
  filas: ItemExistencias[]; deps: DepositoExistencias[]; costos: boolean; orden: Orden;
  onOrdenar: (c: Orden["campo"]) => void; onCelda: (i: ItemExistencias, d: DepositoExistencias) => void;
  t: ReturnType<typeof totalesExistencias>;
}) {
  const variasSuc = new Set(deps.map((x) => x.sucursal_id)).size > 1;
  // Separador más marcado donde empieza otra sucursal.
  const corte = (i: number) => i > 0 && deps[i].sucursal_id !== deps[i - 1].sucursal_id;
  const th = "whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500";
  return (
    <TablaScroll primeraFija>
      <table className="w-full text-sm" style={{ minWidth: 300 + deps.length * 120 + (costos ? 260 : 120) }}>
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th className={`${th} text-left`} scope="col" aria-sort={orden.campo === "nombre" ? (orden.dir === "asc" ? "ascending" : "descending") : undefined}>
              <BotonOrden activo={orden.campo === "nombre"} dir={orden.dir} onClick={() => onOrdenar("nombre")}>Producto</BotonOrden>
            </th>
            {deps.map((x, i) => (
              <th key={x.id} scope="col" className={`${th} text-right normal-case tracking-normal ${corte(i) ? "border-l border-slate-200" : ""}`}>
                {variasSuc ? <span className="block text-[10px] font-medium uppercase tracking-wide text-slate-400">{x.sucursal}</span> : null}
                <span className="block text-xs font-semibold text-slate-600">{x.nombre}</span>
              </th>
            ))}
            <th scope="col" className={`${th} border-l border-slate-200 text-right`} aria-sort={orden.campo === "total" ? (orden.dir === "asc" ? "ascending" : "descending") : undefined}>
              <BotonOrden der activo={orden.campo === "total"} dir={orden.dir} onClick={() => onOrdenar("total")}>Total</BotonOrden>
            </th>
            {costos ? (
              <th scope="col" className={`${th} pr-5 text-right`} aria-sort={orden.campo === "valor" ? (orden.dir === "asc" ? "ascending" : "descending") : undefined}>
                <BotonOrden der activo={orden.campo === "valor"} dir={orden.dir} onClick={() => onOrdenar("valor")}>Valor</BotonOrden>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {filas.map((r) => {
            const min = Number(r.stock_minimo) || 0;
            const total = Number(r.total);
            return (
              <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70 hover:[--tabla-fondo:#f8fafc]">
                <td className="px-3 py-2 pl-4">
                  <div className="flex max-w-[300px] items-center gap-2.5">
                    <Avatar r={r} />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800" title={r.nombre}>{r.nombre}</p>
                      <p className="truncate text-[11px] text-slate-400">
                        <span className="font-mono">{r.sku ?? "—"}</span>{r.categoria ? ` · ${r.categoria}` : ""}{min > 0 ? ` · mín. ${num(min)}` : ""}
                      </p>
                    </div>
                  </div>
                </td>
                {deps.map((x, i) => {
                  const qd = Number(r.c[x.id] ?? 0);
                  return (
                    <td key={x.id} className={`p-0 text-right tabular-nums ${corte(i) ? "border-l border-slate-100" : ""}`}>
                      <button type="button" onClick={() => onCelda(r, x)}
                        aria-label={`${r.nombre} en ${x.nombre}: ${num(qd)}. Ver detalle`}
                        title={costos && qd ? gs(r.v?.[x.id]) : undefined}
                        className={`block h-full w-full px-3 py-2.5 text-right outline-none transition-colors hover:bg-[var(--brand-50)] focus-visible:bg-[var(--brand-50)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand)] ${fondoCantidad(qd, min)} ${tonoCantidad(qd, min)}`}>
                        {num(qd)}
                      </button>
                    </td>
                  );
                })}
                <td className={`border-l border-slate-100 px-3 py-2.5 text-right font-bold tabular-nums ${fondoCantidad(total, min)} ${total === 0 ? "text-slate-300" : total < 0 ? "text-rose-600" : min > 0 && total < min ? "text-amber-700" : "text-slate-900"}`}>
                  {num(total)} <span className="text-[10px] font-normal text-slate-400">{uni(r.unidad_medida)}</span>
                </td>
                {costos ? <td className="whitespace-nowrap px-3 py-2.5 pr-5 text-right tabular-nums text-slate-700">{gs(r.valor)}</td> : null}
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t-2 border-slate-200 bg-slate-50/80 [--tabla-fondo:#f8fafc]">
          <tr className="font-semibold text-slate-900">
            <td className="px-3 py-2.5 pl-4 text-[11px] uppercase tracking-wide text-slate-500">Total · {num(t.productos)} productos</td>
            {deps.map((x, i) => (
              <td key={x.id} className={`whitespace-nowrap px-3 py-2.5 text-right tabular-nums ${corte(i) ? "border-l border-slate-200" : ""}`}>
                {num(t.porDep[x.id]?.unidades)}
                {costos ? <span className="block text-[11px] font-medium text-slate-500">{gs(t.porDep[x.id]?.valor)}</span> : null}
              </td>
            ))}
            <td className="whitespace-nowrap border-l border-slate-200 px-3 py-2.5 text-right tabular-nums">{num(t.unidades)}</td>
            {costos ? <td className="whitespace-nowrap px-3 py-2.5 pr-5 text-right tabular-nums text-[var(--brand)]">{gs(t.valor)}</td> : null}
          </tr>
        </tfoot>
      </table>
    </TablaScroll>
  );
}

function BotonOrden({ activo, dir, der, onClick, children }: { activo: boolean; dir: "asc" | "desc"; der?: boolean; onClick: () => void; children: React.ReactNode }) {
  const Icono = !activo ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md uppercase outline-none transition-colors hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-[var(--brand)] ${der ? "flex-row-reverse" : ""} ${activo ? "text-[var(--brand)]" : ""}`}>
      {children}
      <Icono className={`h-3 w-3 ${activo ? "" : "text-slate-300"}`} aria-hidden />
    </button>
  );
}

function Avatar({ r }: { r: ItemExistencias }) {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
      {r.imagen_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.imagen_url} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : r.nombre.charAt(0).toUpperCase()}
    </div>
  );
}

// ── Celular: una tarjeta por producto ────────────────────────────────────────
function Tarjetas({ filas, deps, costos, onCelda, t }: {
  filas: ItemExistencias[]; deps: DepositoExistencias[]; costos: boolean;
  onCelda: (i: ItemExistencias, d: DepositoExistencias) => void; t: ReturnType<typeof totalesExistencias>;
}) {
  const variasSuc = new Set(deps.map((x) => x.sucursal_id)).size > 1;
  return (
    <>
      <ul className="divide-y divide-slate-100">
        {filas.map((r) => {
          const min = Number(r.stock_minimo) || 0;
          const total = Number(r.total);
          return (
            <li key={r.id} className="px-3.5 py-3">
              <div className="flex items-start gap-3">
                <Avatar r={r} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug text-slate-800 [overflow-wrap:anywhere]">{r.nombre}</p>
                  <p className="text-[11.5px] text-slate-400 [overflow-wrap:anywhere]">
                    <span className="font-mono">{r.sku ?? "—"}</span>{r.categoria ? ` · ${r.categoria}` : ""}{min > 0 ? ` · mín. ${num(min)}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-base font-bold tabular-nums ${total === 0 ? "text-slate-400" : total < 0 ? "text-rose-600" : min > 0 && total < min ? "text-amber-700" : "text-slate-900"}`}>
                    {num(total)} <span className="text-[11px] font-normal text-slate-400">{uni(r.unidad_medida)}</span>
                  </p>
                  {costos ? <p className="text-xs tabular-nums text-slate-500">{gs(r.valor)}</p> : null}
                </div>
              </div>
              <ul className="mt-2 overflow-hidden rounded-xl border border-slate-100">
                {deps.map((x) => {
                  const qd = Number(r.c[x.id] ?? 0);
                  return (
                    <li key={x.id} className="border-b border-slate-100 last:border-0">
                      <button type="button" onClick={() => onCelda(r, x)}
                        className={`flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm transition-colors active:bg-[var(--brand-50)] ${fondoCantidad(qd, min)}`}>
                        <span className="min-w-0 py-1.5 leading-tight [overflow-wrap:anywhere]">
                          {variasSuc ? <span className="block text-[11px] text-slate-400">{x.sucursal}</span> : null}
                          <span className="text-slate-700">{x.nombre}</span>
                        </span>
                        <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                          {costos && qd ? <span className="text-[11px] text-slate-400">{gs(r.v?.[x.id])}</span> : null}
                          <span className={tonoCantidad(qd, min)}>{num(qd)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
      <div className="border-t-2 border-slate-200 bg-slate-50/80 px-3.5 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total · {num(t.productos)} productos</p>
          <p className="text-right font-bold tabular-nums text-slate-900">{num(t.unidades)}{costos ? <span className="block text-xs font-semibold text-[var(--brand)]">{gs(t.valor)}</span> : null}</p>
        </div>
        <ul className="mt-2 space-y-1">
          {deps.map((x) => (
            <li key={x.id} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="min-w-0 text-slate-500 [overflow-wrap:anywhere]">{variasSuc ? `${x.sucursal} › ` : ""}{x.nombre}</span>
              <span className="shrink-0 tabular-nums text-slate-700">{num(t.porDep[x.id]?.unidades)}{costos ? <span className="text-slate-400"> · {gs(t.porDep[x.id]?.valor)}</span> : null}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

// ── Detalle de una celda (producto + depósito) ───────────────────────────────
function DetalleCeldaModal({ item, dep, onClose }: { item: ItemExistencias; dep: DepositoExistencias; onClose: () => void }) {
  const [det, setDet] = useState<DetalleCelda | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    apiFetch<DetalleCelda>(`/api/reportes/existencias/detalle?producto=${item.id}&deposito=${dep.id}`, { signal: ctrl.signal })
      .then(setDet)
      .catch((e) => { if (!ctrl.signal.aborted) setError((e as Error).message); });
    return () => ctrl.abort();
  }, [item.id, dep.id]);
  const u = uni(item.unidad_medida);
  const min = Number(item.stock_minimo) || 0;
  const cant = det ? Number(det.cantidad) : Number(item.c[dep.id] ?? 0);

  return (
    <CapaModal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="det-celda-titulo"
        className={`flex w-full max-w-2xl ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5`}
        style={{ animation: "rb-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-start gap-3 border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-50)] text-[var(--brand)]"><Layers className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1">
            <h3 id="det-celda-titulo" className="text-base font-semibold leading-snug text-slate-900 [overflow-wrap:anywhere]">{item.nombre}</h3>
            <p className="text-xs text-slate-500 [overflow-wrap:anywhere]">{dep.sucursal} › <span className="font-semibold text-slate-700">{dep.nombre}</span>{item.sku ? <> · <span className="font-mono">{item.sku}</span></> : null}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          <div className={`grid gap-2 ${det?.ver_costos ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2"}`}>
            <Cifra etiqueta="Cantidad" valor={`${num(cant)} ${u}`} tono={tonoCantidad(cant, min)} />
            {det?.ver_costos ? <Cifra etiqueta="Valor" valor={gs(det.valor)} detalle={cant ? `${gs(Number(det.valor) / cant)} promedio c/${u}` : undefined} /> : null}
            <Cifra etiqueta="Stock mínimo" valor={min > 0 ? `${num(min)} ${u}` : "—"} detalle={min > 0 && Number(item.total) < min ? "el total está bajo el mínimo" : undefined}
              clase={det?.ver_costos ? "max-sm:col-span-2" : ""} />
          </div>

          {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">No se pudo cargar el detalle: {error}</p> : !det ? (
            <p className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando detalle…</p>
          ) : (
            <>
              {det.ver_costos ? (
                <section className="space-y-2">
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Capas de costo vigentes</h4>
                  {det.capas.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-200 px-3 py-2.5 text-xs text-slate-500">
                      {det.controla_lotes ? "Todas las unidades están en lotes (abajo)." : cant ? "Sin compras registradas en este depósito: se valoriza al costo promedio." : "No hay unidades en este depósito."}
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                      {det.capas.map((c) => {
                        const o = origenTexto(c);
                        return (
                          <li key={c.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-xs">
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-800 [overflow-wrap:anywhere]">
                                {o.titulo}
                                {c.orden === 1 ? <span className="ml-1 rounded bg-[var(--brand-50)] px-1.5 py-0.5 align-middle text-[10px] font-semibold text-[var(--brand)]">Próxima</span> : null}
                              </p>
                              <p className="text-[11px] text-slate-400 [overflow-wrap:anywhere]">{[fechaCorta(c.fecha), o.detalle].filter(Boolean).join(" · ")}</p>
                              <p className="mt-0.5 tabular-nums text-slate-600">{gs(c.costo_unitario)} c/{u}</p>
                            </div>
                            <div className="shrink-0 text-right tabular-nums">
                              <p className="text-sm font-bold text-slate-900">{num(c.quedan)} <span className="text-[11px] font-normal text-slate-400">de {num(c.compradas)}</span></p>
                              <p className="text-[11px] text-slate-500">{gs(c.valor)}</p>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              ) : null}

              {det.controla_lotes ? (
                <section className="space-y-2">
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Lotes en este depósito</h4>
                  {det.lotes.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-200 px-3 py-2.5 text-xs text-slate-500">No hay lotes con unidades en este depósito.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                      {det.lotes.map((l) => (
                        <li key={l.id} className={`flex items-start justify-between gap-3 px-3 py-2.5 text-xs ${l.vencido ? "bg-rose-50/50" : ""}`}>
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-800">Lote <span className="font-mono">{l.numero}</span>
                              {l.vencido ? <span className="ml-1 rounded bg-rose-50 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-rose-700 ring-1 ring-rose-200">Vencido</span>
                                : l.dias <= 30 ? <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">Vence pronto</span> : null}
                            </p>
                            <p className="text-[11px] text-slate-500">Vence {fechaCorta(l.vencimiento)} · {textoDias(l.dias)}</p>
                            {det.ver_costos && l.costo_unitario != null ? <p className="mt-0.5 tabular-nums text-slate-600">{gs(l.costo_unitario)} c/{u}</p> : null}
                          </div>
                          <div className="shrink-0 text-right tabular-nums">
                            <p className="text-sm font-bold text-slate-900">{num(l.cantidad)} <span className="text-[11px] font-normal text-slate-400">{u}</span></p>
                            {det.ver_costos ? <p className="text-[11px] text-slate-500">{gs(l.valor)}</p> : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}

              {!det.ver_costos && !det.controla_lotes ? (
                <p className="text-xs text-slate-500">El detalle de costos lo ve quien tiene el permiso “Ver costos y márgenes”.</p>
              ) : null}
            </>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-4 py-3 sm:px-5">
          <button type="button" onClick={onClose} className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 max-sm:flex-1">Cerrar</button>
        </div>
      </div>
    </CapaModal>
  );
}

function Cifra({ etiqueta, valor, detalle, clase = "", tono = "text-slate-900" }: { etiqueta: string; valor: string; detalle?: string; clase?: string; tono?: string }) {
  return (
    <div className={`min-w-0 rounded-xl bg-slate-50 px-3 py-2.5 ${clase}`}>
      <p className="text-[11px] text-slate-500">{etiqueta}</p>
      <p className={`text-sm font-bold tabular-nums [overflow-wrap:anywhere] ${tono}`}>{valor}</p>
      {detalle ? <p className="text-[11px] text-slate-400">{detalle}</p> : null}
    </div>
  );
}
