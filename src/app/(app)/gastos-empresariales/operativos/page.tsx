"use client";

/**
 * /gastos-empresariales/operativos — Gastos operativos (antes /gastos, "Gastos y Servicios"):
 * alquiler, servicios, sueldos, impuestos… con o sin comprobante fiscal.
 * Filtros en una fila (período —mes actual por defecto—, sucursal, categoría (rubro o
 * subcategoría), proveedor, tipo fijo/variable, IVA deducible, origen) + búsqueda; contadores por
 * estado; lista paginada por SQL con el total confirmado (Gs.) y el IVA crédito fiscal de la vista.
 * Los filtros iniciales se pueden pasar por URL (los usan los gráficos del Resumen) y
 * ?ver=<id> abre el detalle; ?nuevo=1 abre el alta.
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Ban, CalendarClock, Eye, FolderCog, Paperclip, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchCache } from "@/lib/api/cache-cliente";
import { hoyPY } from "@/lib/fecha/paraguay";
import { Select } from "@/components/Select";
import { AccionesPagina, BarraFiltros, EncabezadoPagina } from "@/components/EncabezadoPagina";
import { TablaTarjetas, type ColumnaTabla } from "@/components/TablaResponsive";
import { cargarProveedores } from "@/modules/proveedores/cache";
import { nombreProveedor, type ProveedorMin } from "@/modules/proveedores/tipos";
import { FormGasto } from "@/modules/gastos/FormGasto";
import { ConfirmarAccionGasto, DetalleGasto } from "@/modules/gastos/DetalleGasto";
import { CatalogosGastos } from "@/modules/gastos/Catalogos";
import {
  ESTADO_GASTO, URL_CATALOGOS, fechaCorta, gs, monto, nombreMedioGasto,
  type Catalogos, type FilaGasto, type ListaGastos,
} from "@/modules/gastos/tipos";
import { SelectorFecha } from "@/components/SelectorFecha";

const POR_PAGINA = 50;
const INPUT = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";
const primeroDelMes = () => `${hoyPY().slice(0, 8)}01`;
/** Fin del mes actual: incluye los borradores programados de los próximos días. */
const finDelMes = () => { const [y, m] = hoyPY().split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const UUID = /^[0-9a-f-]{36}$/i;

type Filtros = { desde: string; hasta: string; estado: string; sucursal: string; categoria: string; proveedor: string; tipo_costo: string; deducible: string; origen: string };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <GastosOperativos />
    </Suspense>
  );
}

function filtrosDeUrl(sp: URLSearchParams): Filtros {
  const v = (k: string) => sp.get(k) ?? "";
  const tieneFechas = sp.has("desde") || sp.has("hasta");
  return {
    desde: tieneFechas ? v("desde") : primeroDelMes(),
    hasta: tieneFechas ? v("hasta") : finDelMes(),
    estado: v("estado"),
    sucursal: UUID.test(v("sucursal")) ? v("sucursal") : "",
    categoria: UUID.test(v("categoria")) ? v("categoria") : "",
    proveedor: UUID.test(v("proveedor")) ? v("proveedor") : "",
    tipo_costo: v("tipo_costo"),
    deducible: v("deducible"),
    origen: v("origen"),
  };
}

function GastosOperativos() {
  const router = useRouter();
  const sp = useSearchParams();
  const ver = sp.get("ver");
  const [f, setF] = useState<Filtros>(() => filtrosDeUrl(new URLSearchParams(sp.toString())));
  const [borrador, setBorrador] = useState("");
  const [q, setQ] = useState("");
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<ListaGastos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [form, setForm] = useState<{ id: string | null } | null>(() => (sp.get("nuevo") === "1" ? { id: null } : null));
  const [detalle, setDetalle] = useState<string | null>(null);
  const [accion, setAccion] = useState<{ modo: "anular" | "eliminar"; gasto: { id: string; numero: string | null } } | null>(null);
  const [catalogos, setCatalogos] = useState(false);
  const [cat, setCat] = useState<Catalogos | null>(null);
  const [proveedores, setProveedores] = useState<ProveedorMin[]>([]);

  useEffect(() => {
    apiFetchCache<Catalogos>(URL_CATALOGOS).then(setCat).catch(() => setCat(null));
    void cargarProveedores().then(setProveedores);
  }, [recarga]);
  useEffect(() => { if (ver && UUID.test(ver)) setDetalle(ver); }, [ver]);
  useEffect(() => {
    const t = setTimeout(() => setQ(borrador.trim()), 300);
    return () => clearTimeout(t);
  }, [borrador]);
  useEffect(() => { setPagina(1); }, [q, f]);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    const p = new URLSearchParams({ pagina: String(pagina), por_pagina: String(POR_PAGINA) });
    if (q) p.set("q", q);
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    apiFetch<ListaGastos>(`/api/gastos?${p}`)
      .then((r) => { if (vivo) { setDatos(r); setError(null); } })
      .catch((e) => { if (vivo) setError((e as Error).message); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [q, f, pagina, recarga]);

  const refrescar = useCallback(() => setRecarga((k) => k + 1), []);
  const cerrarDetalle = () => {
    setDetalle(null);
    if (ver) router.replace("/gastos-empresariales/operativos", { scroll: false });
  };
  const setFiltro = (k: keyof Filtros, v: string) => setF((x) => ({ ...x, [k]: v }));

  const opcionesCategoria = useMemo<[string, string][]>(() => [
    ["", "Todas las categorías"],
    ...(cat?.rubros ?? []).flatMap((r): [string, string][] => [[r.id, `${r.nombre} (todo el rubro)`], ...r.subcategorias.map((s): [string, string] => [s.id, `   ${r.nombre} › ${s.nombre}`])]),
  ], [cat]);
  const opcionesProveedor = useMemo<[string, string][]>(() => [["", "Todos los proveedores"], ...proveedores.map((p): [string, string] => [p.id, nombreProveedor(p)])], [proveedores]);
  // Los handlers sólo usan setters de estado (estables): columnas memorizadas = filas memorizadas.
  const columnas = useMemo(() => columnasGastos({
    onVer: (g) => setDetalle(g.id),
    onEditar: (g) => setForm({ id: g.id }),
    onEliminar: (g) => setAccion({ modo: "eliminar", gasto: { id: g.id, numero: g.numero } }),
    onAnular: (g) => setAccion({ modo: "anular", gasto: { id: g.id, numero: g.numero } }),
  }), []);
  const filtrosActivos =[f.sucursal, f.categoria, f.proveedor, f.tipo_costo, f.deducible, f.origen].filter(Boolean).length;
  const limpiarFiltros = () => setF((x) => ({ ...x, sucursal: "", categoria: "", proveedor: "", tipo_costo: "", deducible: "", origen: "" }));

  const r = datos?.resumen;
  const filas = datos?.rows ?? [];
  const total = datos?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div className="space-y-5 pb-10">
      <EncabezadoPagina
        titulo="Gastos operativos"
        subtitulo="Alquiler, servicios, sueldos, impuestos y todo lo que no es mercadería, con o sin comprobante fiscal."
        acciones={<AccionesPagina acciones={[
          { etiqueta: "Catálogos", icono: <FolderCog />, onClick: () => setCatalogos(true) },
          { etiqueta: "Nuevo gasto", icono: <Plus />, onClick: () => setForm({ id: null }), primaria: true },
        ]} />} />

      {/* Contadores por estado (filtran): 4 en fila desde sm, 2 × 2 en celular */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {[
          { l: "Todos", v: r?.total, e: "" },
          { l: "Borradores", v: r?.borrador, e: "borrador" },
          { l: "Confirmados", v: r?.confirmado, e: "confirmado" },
          { l: "Anulados", v: r?.anulado, e: "anulado" },
        ].map((k) => (
          <button key={k.l} onClick={() => setFiltro("estado", k.e)} aria-pressed={f.estado === k.e}
            className={`rounded-xl border px-3 py-2 text-left transition sm:px-4 sm:py-3 ${f.estado === k.e ? "border-[#4FAEB2] bg-[#4FAEB2]/5 ring-2 ring-[#4FAEB2]/15" : "border-slate-100 bg-slate-50 hover:border-slate-200"}`}>
            <p className="text-xs text-slate-400">{k.l}</p>
            <p className="text-lg font-bold tabular-nums text-slate-800">{k.v ?? "—"}</p>
          </button>
        ))}
      </div>

      {/* Búsqueda siempre visible; período y filtros en línea (≥ 768) o en una hoja (celular) */}
      <BarraFiltros
        activos={filtrosActivos}
        onLimpiar={limpiarFiltros}
        busqueda={
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input type="search" enterKeyHint="search" value={borrador} onChange={(e) => setBorrador(e.target.value)}
              placeholder="Buscar por número, proveedor, comprobante, empleado…" aria-label="Buscar gastos" className={`${INPUT} w-full pl-9 max-sm:min-h-11`} />
          </div>
        }>
        <div className="flex flex-wrap items-center gap-2 max-md:grid max-md:grid-cols-2">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 max-md:flex-col max-md:items-stretch max-md:gap-1">Desde
            <SelectorFecha compacto etiqueta="Desde" value={f.desde} onChange={(v) => setFiltro("desde", v)} claseBoton="rounded-xl px-3 py-2 text-slate-800" className="min-w-0 max-md:w-full md:w-[150px]" />
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 max-md:flex-col max-md:items-stretch max-md:gap-1">Hasta
            <SelectorFecha compacto etiqueta="Hasta" value={f.hasta} onChange={(v) => setFiltro("hasta", v)} claseBoton="rounded-xl px-3 py-2 text-slate-800" className="min-w-0 max-md:w-full md:w-[150px]" />
          </div>
          {f.desde || f.hasta ? (
            <button onClick={() => setF((x) => ({ ...x, desde: "", hasta: "" }))} className="text-xs font-semibold text-[#3F8E91] underline-offset-2 hover:underline max-md:col-span-2 max-md:min-h-11 max-md:rounded-lg max-md:border max-md:border-slate-200 max-md:no-underline">Todas las fechas</button>
          ) : (
            <button onClick={() => setF((x) => ({ ...x, desde: primeroDelMes(), hasta: finDelMes() }))} className="text-xs font-semibold text-[#3F8E91] underline-offset-2 hover:underline max-md:col-span-2 max-md:min-h-11 max-md:rounded-lg max-md:border max-md:border-slate-200 max-md:no-underline">Este mes</button>
          )}
        </div>
        <Select value={f.sucursal} onChange={(v) => setFiltro("sucursal", v)} minWidth={170} etiqueta="Sucursal"
          options={[["", "Todas las sucursales"], ...(cat?.sucursales ?? []).map((s): [string, string] => [s.id, s.nombre])]} />
        <Select value={f.categoria} onChange={(v) => setFiltro("categoria", v)} minWidth={220} etiqueta="Categoría" options={opcionesCategoria} />
        <Select value={f.proveedor} onChange={(v) => setFiltro("proveedor", v)} minWidth={190} etiqueta="Proveedor" options={opcionesProveedor} />
        <Select value={f.tipo_costo} onChange={(v) => setFiltro("tipo_costo", v)} minWidth={140} etiqueta="Fijo o variable" options={[["", "Fijo y variable"], ["fijo", "Solo fijos"], ["variable", "Solo variables"]]} />
        <Select value={f.deducible} onChange={(v) => setFiltro("deducible", v)} minWidth={160} etiqueta="IVA" options={[["", "Deducible o no"], ["1", "IVA deducible"], ["0", "No deducible"]]} />
        <Select value={f.origen} onChange={(v) => setFiltro("origen", v)} minWidth={170} etiqueta="Origen"
          options={[["", "Todo origen"], ["recurrente", "De recurrentes"], ["personal", "De personal"], ["sin_comprobante", "Sin comprobante"]]} />
      </BarraFiltros>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <TablaTarjetas
          filas={cargando && !datos ? [] : filas}
          claveFila={(g) => g.id}
          onFila={(g) => setDetalle(g.id)}
          cargando={cargando && !!datos}
          minAncho={980}
          claseThead="border-b border-slate-200 bg-slate-50"
          thBase="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
          tdBase="px-3 py-2"
          claseFila={(g) => `border-b border-slate-100 last:border-0 ${g.estado === "anulado" ? "opacity-60" : ""}`}
          vacio={<p className="px-3 py-10 text-center text-sm text-slate-400">{cargando && !datos ? "Cargando…" : "No hay gastos que coincidan."}</p>}
          columnas={columnas}
        />
        {filas.length > 0 ? (
          <div className="flex items-start justify-between gap-3 border-t-2 border-slate-100 bg-slate-50/80 px-3.5 py-3 sm:px-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-700">Total confirmado de la vista</p>
              <p className="text-[11px] text-slate-500 sm:text-[10px]">
                {total} {total === 1 ? "documento" : "documentos"} · IVA crédito fiscal {gs(datos?.total_iva)}
                {Number(datos?.total_borradores) > 0 ? ` · en borrador ${gs(datos?.total_borradores)}` : ""}
              </p>
            </div>
            <p className="shrink-0 whitespace-nowrap text-right text-base font-bold tabular-nums text-slate-900 sm:text-sm">{gs(datos?.total_monto)}</p>
          </div>
        ) : null}
        {total > POR_PAGINA ? (
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3.5 py-3 text-xs text-slate-500 sm:px-5">
            <span>Página {pagina} de {totalPaginas}</span>
            <div className="flex gap-2">
              <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 max-sm:min-h-11 max-sm:px-4">Anterior</button>
              <button disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 max-sm:min-h-11 max-sm:px-4">Siguiente</button>
            </div>
          </div>
        ) : null}
      </div>

      {form ? <FormGasto gastoId={form.id} onClose={() => setForm(null)} onHecho={refrescar} /> : null}
      {detalle ? (
        <DetalleGasto id={detalle} onClose={cerrarDetalle} onCambio={refrescar}
          onEditar={(id) => { cerrarDetalle(); setForm({ id }); }}
          onEliminar={(gasto) => setAccion({ modo: "eliminar", gasto })}
          onAnular={(gasto) => setAccion({ modo: "anular", gasto })} />
      ) : null}
      {accion ? (
        <ConfirmarAccionGasto modo={accion.modo} gasto={accion.gasto} onClose={() => setAccion(null)}
          onHecho={() => { if (accion.modo === "eliminar") cerrarDetalle(); refrescar(); }} />
      ) : null}
      {catalogos ? <CatalogosGastos onClose={() => setCatalogos(false)} onCambio={refrescar} /> : null}
    </div>
  );
}

const condicionDe = (g: FilaGasto) => g.tipo_pago === "credito"
  ? g.cxp ? (Number(g.cxp.saldo) > 0 ? `Crédito · saldo ${monto(g.cxp.saldo, g.moneda)}` : "Crédito · pagado") : `Crédito${g.fecha_vencimiento ? ` · vence ${fechaCorta(g.fecha_vencimiento)}` : ""}`
  : g.tipo_pago === "contado" ? `Contado · ${nombreMedioGasto(g.medio_pago)}` : null;

const numeroConIconos = (g: FilaGasto) => (
  <>
    <span className="whitespace-nowrap font-mono font-semibold">{g.numero ?? "—"}</span>
    {g.adjuntos > 0 ? <Paperclip className="ml-1 inline h-3 w-3 text-slate-400" aria-label={`${g.adjuntos} adjuntos`} /> : null}
    {g.recurrente_id ? <CalendarClock className="ml-1 inline h-3 w-3 text-[#4FAEB2]" aria-label="De una plantilla recurrente" /> : null}
  </>
);

/**
 * Columnas de la lista: tabla en ≥ 768 px y, en celular, tarjeta con proveedor/concepto
 * (título), número + categorías (subtítulo), total (valor), estado (chip), fecha / comprobante
 * / sucursal (datos) y las acciones al pie. Tocar la fila (o la tarjeta) abre el detalle.
 */
function columnasGastos(h: { onVer: (g: FilaGasto) => void; onEditar: (g: FilaGasto) => void; onEliminar: (g: FilaGasto) => void; onAnular: (g: FilaGasto) => void }): ColumnaTabla<FilaGasto>[] {
  return [
    {
      key: "numero", titulo: "Número", claseTh: "pl-4", claseTd: "whitespace-nowrap pl-4 text-xs text-slate-700 group-hover:text-[#3F8E91]",
      celda: numeroConIconos,
      movil: "subtitulo",
      celdaMovil: (g) => (
        <>
          {numeroConIconos(g)}
          {g.categorias ? <span className="text-slate-400"> · {g.categorias}</span> : null}
        </>
      ),
    },
    {
      key: "proveedor", titulo: "Proveedor / concepto", movil: "titulo",
      celda: (g) => (
        <>
          <p className="text-slate-800">{g.proveedor_nombre ?? <span className="text-slate-500">{g.descripcion ?? "Sin proveedor"}</span>}</p>
          {g.categorias || (g.proveedor_nombre && g.descripcion) ? (
            <p className="max-w-[16rem] truncate text-[11px] text-slate-400 xl:max-w-[20rem]">{[g.categorias, g.proveedor_nombre ? g.descripcion : null].filter(Boolean).join(" · ")}</p>
          ) : null}
        </>
      ),
      celdaMovil: (g) => g.proveedor_nombre
        ? <>{g.proveedor_nombre}{g.descripcion ? <span className="block text-[13px] font-normal text-slate-500">{g.descripcion}</span> : null}</>
        : (g.descripcion ?? "Sin proveedor"),
    },
    {
      key: "comprobante", titulo: "Comprobante", claseTd: "text-xs text-slate-500", movil: "dato",
      celda: (g) => {
        const condicion = condicionDe(g);
        return (
          <>
            {g.con_comprobante ? (g.numero_comprobante ? <><span className="text-slate-400">{g.tipo_comprobante} </span><span className="whitespace-nowrap font-mono">{g.numero_comprobante}</span></> : g.tipo_comprobante ?? "—") : <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Sin comprobante</span>}
            {condicion ? <span className="block text-[11px] text-slate-400">{condicion}</span> : null}
          </>
        );
      },
    },
    // En tablet (768–1023) la sucursal se omite para que la tabla entre mejor (se ve en el detalle).
    { key: "sucursal", titulo: "Sucursal", claseTh: "max-lg:hidden", claseTd: "text-xs text-slate-500 max-lg:hidden", movil: "dato", celda: (g) => g.sucursal_nombre ?? "—" },
    {
      key: "fecha", titulo: "Fecha", claseTd: "whitespace-nowrap text-xs text-slate-500", movil: "dato",
      celda: (g) => (
        <>
          {fechaCorta(g.fecha)}
          {g.estado === "borrador" && g.fecha_programada ? <span className="block text-[11px] text-amber-600">programado</span> : null}
        </>
      ),
    },
    {
      key: "total", titulo: "Total", claseTh: "text-right", claseTd: "whitespace-nowrap text-right tabular-nums", movil: "valor",
      celda: (g) => (
        <>
          <span className="font-semibold text-slate-800">{monto(g.total, g.moneda)}</span>
          {g.moneda === "USD" ? <span className="block text-[11px] font-normal text-slate-400">{gs(g.total_gs)}</span> : null}
        </>
      ),
    },
    {
      key: "estado", titulo: "Estado", claseTh: "text-center", claseTd: "text-center", movil: "chip",
      celda: (g) => {
        const est = ESTADO_GASTO[g.estado];
        return (
          <>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${est.c}`}>{est.t}</span>
            {g.estado === "anulado" && g.anulado_motivo ? <span className="mt-0.5 block max-w-[8rem] truncate text-[10px] text-rose-500" title={g.anulado_motivo}>{g.anulado_motivo}</span> : null}
          </>
        );
      },
      celdaMovil: (g) => {
        const est = ESTADO_GASTO[g.estado];
        return (
          <span className="inline-flex max-w-full flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${est.c}`}>{est.t}</span>
            {!g.con_comprobante ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Sin comprobante</span> : null}
            {g.estado === "anulado" && g.anulado_motivo ? <span className="min-w-0 truncate text-[11px] text-rose-500">{g.anulado_motivo}</span> : null}
          </span>
        );
      },
    },
    {
      key: "acciones", titulo: "Acciones", claseTh: "pr-4 text-right", claseTd: "pr-4", movil: "acciones",
      celda: (g) => (
        // No abre la fila: las acciones tienen su propio click.
        <div className="flex items-center justify-end gap-1.5 text-xs max-md:text-[13px]" onClick={(e) => e.stopPropagation()}>
          {g.estado === "borrador" ? (
            <>
              <button onClick={() => h.onEditar(g)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 font-semibold text-white hover:bg-emerald-700 max-md:px-3"><Pencil className="h-3 w-3" /> Abrir y confirmar</button>
              <button onClick={() => h.onEliminar(g)} aria-label="Eliminar borrador" className="inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1 text-rose-600 hover:bg-rose-50"><Trash2 className="h-3 w-3 max-md:h-4 max-md:w-4" /></button>
            </>
          ) : (
            <>
              <button onClick={() => h.onVer(g)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50 max-md:px-3"><Eye className="h-3 w-3" /> Ver</button>
              {g.estado === "confirmado" ? (
                <button onClick={() => h.onAnular(g)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-rose-600 hover:bg-rose-50 max-md:px-3"><Ban className="h-3 w-3" /> Anular</button>
              ) : null}
            </>
          )}
        </div>
      ),
    },
  ];
}
