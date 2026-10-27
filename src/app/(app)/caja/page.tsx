"use client";

/**
 * Caja › Órdenes de venta: las ventas (contado y crédito) con filtros por sucursal, caja,
 * forma de pago, condición, IVA, estado y fechas (el producto se busca con el buscador).
 * Arriba, las cajas abiertas
 * (cada una lleva a Apertura y cierre).
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clock, Plus, Search, SlidersHorizontal, Wallet, X } from "lucide-react";
import { AccionesPagina, EncabezadoPagina } from "@/components/EncabezadoPagina";
import { ScrollHorizontal } from "@/components/ScrollHorizontal";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { VentaDetalle } from "@/modules/caja/VentaDetalle";
import { HojaInferior } from "@/components/HojaInferior";
import { TablaTarjetas } from "@/components/TablaResponsive";
import { useMediaQuery } from "@/lib/ui/responsive";
import { formatGs } from "@/modules/caja/lib";
import { desdeTurno, etiquetaCaja, haceDias, metodoLabel, turnoViejo, METODOS_VENTA, useEstadoCajas, type EstadoCajas } from "@/modules/caja/turno";
import { SelectorFecha } from "@/components/SelectorFecha";

const TEAL = clienteConfig.color;
const fechaVenta = (iso: string) => new Date(iso).toLocaleString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

type VentaItem = { producto_nombre: string; sku?: string | null; cantidad: number; tipo_iva: string };
type Venta = {
  id: string;
  numero_control: string;
  fecha: string;
  total: number;
  tipo_venta: string;
  estado: string;
  metodo_pago: string | null;
  ventas_items: VentaItem[];
  pagos: { metodo_pago: string; monto: number }[] | null;
  punto: { nombre: string } | null;
  sucursal: { nombre: string } | null;
};

export default function CajaDashboard() {
  const { datos } = useEstadoCajas();
  return (
    <div className="space-y-4 pb-10 sm:space-y-6">
      {/* Encabezado: en celular "Nueva venta" a la vista y el resto en "⋯". */}
      <EncabezadoPagina volver={{ href: "/caja/panel", label: "Caja" }} kicker="Caja" titulo="Órdenes de venta" subtitulo="Todas las ventas de las cajas, con su forma de pago"
        acciones={<AccionesPagina acciones={[
          { etiqueta: "Nueva venta", icono: <Plus />, href: "/caja/nueva", primaria: true },
          { etiqueta: "Apertura y cierre", icono: <Wallet />, href: "/caja/turnos" },
          { etiqueta: "Ventas a crédito", icono: <Clock />, href: "/reportes/ventas-credito" },
        ]} />} />

      <CajasAbiertas estado={datos} />

      <Ordenes cajas={datos} />
    </div>
  );
}

// ── Cajas abiertas (tira) ───────────────────────────────────────────────────
function CajasAbiertas({ estado }: { estado: EstadoCajas | null }) {
  if (!estado) return null;
  const abiertas = estado.sucursales.flatMap((s) => s.cajas.filter((c) => c.turno).map((c) => ({ c, s })));
  return (
    // Celular / tablet: tira con scroll horizontal (nunca empuja el ancho de la página).
    <ScrollHorizontal claseFila="items-stretch gap-3" className="-mx-3 px-3 py-0.5 sm:mx-0 sm:px-0">
      {abiertas.length === 0 ? (
        <Link href="/caja/turnos" className="flex min-h-11 shrink-0 items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-500 transition hover:border-[var(--brand)] hover:text-[var(--brand)]">
          <Wallet className="h-4 w-4" /> No hay cajas abiertas · Abrir caja
        </Link>
      ) : abiertas.map(({ c, s }) => {
        const viejo = turnoViejo(c.turno!.fecha_apertura);
        return (
        <Link key={c.id} href="/caja/turnos" className={`w-[240px] shrink-0 rounded-2xl border bg-white px-4 py-3 shadow-sm transition hover:shadow ${viejo ? "border-amber-200 hover:border-amber-300" : "border-emerald-100 hover:border-emerald-200"}`}>
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> {etiquetaCaja({ punto_nombre: c.nombre, sucursal_nombre: s.nombre })}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">Turno N° {c.turno!.numero_caja} · {c.turno!.abierta_por_nombre ?? "—"} · desde {desdeTurno(c.turno!.fecha_apertura)}</p>
          {/* Lo vendido es del turno (puede abarcar varios días), no "de hoy". */}
          <p className="mt-1.5 flex items-baseline justify-between gap-3 text-xs">
            <span className="text-slate-500">Ventas del turno · {c.turno!.ventas_cantidad}</span>
            <span className="font-bold tabular-nums text-slate-900">{formatGs(c.turno!.ventas_total)}</span>
          </p>
          {viejo ? <p className="mt-1.5 rounded-md bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800">Abierto {haceDias(viejo.dias)}: cerralo y abrí uno nuevo.</p> : null}
        </Link>
        );
      })}
    </ScrollHorizontal>
  );
}

// ── Órdenes de venta ──────────────────────────────────────────────────────────

function Ordenes({ cajas }: { cajas: EstadoCajas | null }) {
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [total, setTotal] = useState(0); // ventas que cumplen los filtros
  const [totalGeneral, setTotalGeneral] = useState(0); // ventas sin filtrar
  const [buscando, setBuscando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState(""); // búsqueda con debounce (la que va al servidor)
  const [tipo, setTipo] = useState("");
  const [iva, setIva] = useState("");
  const [estado, setEstado] = useState("");
  const [sucursal, setSucursal] = useState("");
  const [punto, setPunto] = useState("");
  const [metodo, setMetodo] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const angosta = useMediaQuery("(max-width: 767.98px)");
  const [viendo, setViendo] = useState<string | null>(null);
  // Paginado EN EL SERVIDOR: solo viaja la página visible (antes se bajaba todo el historial).
  const [porPagina, setPorPagina] = useState(25);
  const [pagina, setPagina] = useState(1);
  const pedido = useRef(0); // descarta respuestas viejas si el usuario sigue tipeando/filtrando
  // Filtros de la última respuesta con totales: si solo cambia la página, no se recuenta.
  const contados = useRef<string | null>(null);

  // Al cambiar lo que se filtra o el tamaño de página se vuelve a la primera EN EL MISMO
  // cambio de estado (antes un efecto aparte lo hacía después → dos pedidos al servidor).
  const conPagina1 = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPagina(1); };

  // Debounce de la búsqueda: no pegarle al servidor en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => {
      const nueva = busqueda.trim();
      if (nueva !== q) { setQ(nueva); setPagina(1); }
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda, q]);

  const cargar = useCallback((recontar = false) => {
    const sp = new URLSearchParams({ pagina: String(pagina), por_pagina: String(porPagina) });
    if (q) sp.set("q", q);
    if (tipo) sp.set("tipo", tipo);
    if (iva) sp.set("iva", iva);
    if (estado) sp.set("estado", estado);
    if (sucursal) sp.set("sucursal", sucursal);
    if (punto) sp.set("punto", punto);
    if (metodo) sp.set("metodo", metodo);
    if (desde) sp.set("desde", desde);
    if (hasta) sp.set("hasta", hasta);
    const firma = JSON.stringify([porPagina, q, tipo, iva, estado, desde, hasta, sucursal, punto, metodo]);
    if (!recontar && contados.current === firma) sp.set("contar", "0");
    const n = ++pedido.current;
    setBuscando(true);
    apiFetch<{ rows: Venta[]; total: number | null; total_general: number | null }>(`/api/ventas?${sp}`)
      .then((r) => {
        if (n !== pedido.current) return;
        setVentas(r.rows);
        if (r.total != null) {
          setTotal(r.total);
          setTotalGeneral(r.total_general ?? r.total);
          contados.current = firma;
        }
      })
      .catch(() => { if (n === pedido.current) { setVentas([]); setTotal(0); contados.current = null; } })
      .finally(() => { if (n === pedido.current) setBuscando(false); });
  }, [pagina, porPagina, q, tipo, iva, estado, desde, hasta, sucursal, punto, metodo]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const filtrosActivos = (tipo ? 1 : 0) + (iva ? 1 : 0) + (estado ? 1 : 0) + (desde ? 1 : 0) + (hasta ? 1 : 0) +
    (sucursal ? 1 : 0) + (punto ? 1 : 0) + (metodo ? 1 : 0);
  // Opciones de sucursal y caja (las que ve el usuario).
  const sucursalesOpts = useMemo<[string, string][]>(
    () => [["", "Todas las sucursales"], ...(cajas?.sucursales ?? []).map((s): [string, string] => [s.id, s.nombre])],
    [cajas],
  );
  const cajasOpts = useMemo<[string, string][]>(
    () => [["", "Todas las cajas"], ...(cajas?.sucursales ?? [])
      .filter((s) => !sucursal || s.id === sucursal)
      .flatMap((s) => s.cajas.map((c): [string, string] => [c.id, `${c.nombre} · ${s.nombre}`]))],
    [cajas, sucursal],
  );

  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const paginaActual = Math.min(pagina, totalPaginas);
  const inicio = (paginaActual - 1) * porPagina;
  const visibles = ventas;

  const filtros = (
    <>

            {sucursalesOpts.length > 2 ? (
              <Select value={sucursal} onChange={conPagina1((v: string) => { setSucursal(v); setPunto(""); })} options={sucursalesOpts} minWidth={180} etiqueta="Sucursal" />
            ) : null}
            <Select value={punto} onChange={conPagina1(setPunto)} options={cajasOpts} minWidth={190} etiqueta="Caja" />
            <Select value={tipo} onChange={conPagina1(setTipo)} options={[["", "Contado y crédito"], ["CONTADO", "Contado"], ["CREDITO", "Crédito"]]} minWidth={150} etiqueta="Condición" />
            <Select value={metodo} onChange={conPagina1(setMetodo)} minWidth={180} etiqueta="Forma de pago"
              options={[["", "Todas las formas de pago"], ...METODOS_VENTA.map((m): [string, string] => [m.value, m.label]), ["mixto", "Pago mixto"]]} />
            <Select value={iva} onChange={conPagina1(setIva)} options={[["", "Todos los IVA"], ["10%", "IVA 10%"], ["5%", "IVA 5%"], ["EXENTA", "Exenta"]]} minWidth={140} etiqueta="IVA" />
            <Select value={estado} onChange={conPagina1(setEstado)} options={[["", "Todos los estados"], ["completada", "Completada"], ["anulada", "Anulada"]]} minWidth={160} etiqueta="Estado" />
            <div className="flex flex-col gap-1">
              <span className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Desde</span>
              <SelectorFecha compacto etiqueta="Desde" value={desde} onChange={(v) => { setDesde(v); setPagina(1); }} className="w-[150px] max-sm:w-full" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Hasta</span>
              <SelectorFecha compacto etiqueta="Hasta" value={hasta} onChange={(v) => { setHasta(v); setPagina(1); }} className="w-[150px] max-sm:w-full" />
            </div>
            {filtrosActivos ? (
              <button
                type="button"
                onClick={() => { setTipo(""); setIva(""); setEstado(""); setDesde(""); setHasta(""); setSucursal(""); setPunto(""); setMetodo(""); setPagina(1); }}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:text-rose-600"
              >
                <X className="h-3.5 w-3.5" /> Limpiar
              </button>
            ) : null}
    </>
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 sm:mb-5">
        <div className="flex items-center gap-2">
          <span className="block h-5 w-1 rounded-full" style={{ backgroundColor: TEAL }} />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">Ventas</h2>
        </div>
      </div>

      <div className="mb-3 border-b border-slate-100 pb-3 sm:mb-5 sm:pb-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-0 flex-1 sm:w-full sm:min-w-56 sm:max-w-md">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar número, producto, SKU, monto…"
              type="search" enterKeyHint="search" aria-label="Buscar ventas"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-11 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]"
            />
          </div>
          <button
            type="button"
            onClick={() => setFiltrosAbiertos((v) => !v)}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors sm:min-h-0 sm:px-4"
            style={filtrosActivos || filtrosAbiertos ? { borderColor: TEAL, color: TEAL, backgroundColor: "var(--brand-50)" } : { borderColor: "#e2e8f0", color: "#475569" }}
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span className="max-[380px]:sr-only">Filtros</span>
            {filtrosActivos ? (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold text-white" style={{ backgroundColor: TEAL }}>{filtrosActivos}</span>
            ) : null}
          </button>
          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Filas</span>
            <Select value={String(porPagina)} onChange={conPagina1((v: string) => setPorPagina(Number(v)))} options={[["25", "25"], ["50", "50"], ["100", "100"]]} minWidth={84} />
          </div>
          <span className={`text-sm text-slate-400 transition-opacity max-sm:w-full max-sm:text-xs sm:ml-auto ${buscando ? "opacity-50" : ""}`}>{total.toLocaleString("es-PY")} de {totalGeneral.toLocaleString("es-PY")} ventas</span>
        </div>

        {filtrosAbiertos && !angosta ? (
          <div className="mt-3 flex flex-wrap items-end gap-2.5 rounded-xl bg-slate-50 p-3" style={{ animation: "rb-pop 0.15s cubic-bezier(0.16,1,0.3,1)" }}>
            {filtros}
          </div>
        ) : null}
      </div>

      {/* Celular: cada venta es una tarjeta (producto, número y fecha, total; condición y caja). */}
      <TablaTarjetas
        filas={visibles}
        claveFila={(v) => v.id}
        onFila={(v) => setViendo(v.id)}
        claseFila={(v) => (v.estado === "anulada" ? "opacity-50" : "")}
        claseTabla="w-full text-left text-sm"
        claseThead="bg-slate-50"
        thBase="whitespace-nowrap px-4 py-3 text-xs font-semibold text-slate-500"
        tdBase="px-4 py-4"
        vacio={<p className="py-12 text-center text-sm text-slate-400">{buscando ? "Buscando…" : totalGeneral === 0 ? "No hay ventas registradas" : "Ninguna venta coincide con los filtros"}</p>}
        columnas={[
          { key: "num", titulo: "Número", claseTd: "font-mono text-xs text-slate-500", movil: "subtitulo",
            celda: (v) => v.numero_control,
            celdaMovil: (v) => <span className="font-mono text-xs">{v.numero_control} · {fechaVenta(v.fecha)}</span> },
          { key: "prod", titulo: "Productos", movil: "titulo",
            celda: (v) => {
              const items = v.ventas_items ?? [];
              const primero = items[0];
              return (
                <>
                  <span className="block truncate font-normal text-slate-800 max-md:whitespace-normal max-md:font-semibold">{primero?.producto_nombre ?? "—"}</span>
                  <span className="text-xs font-normal text-slate-400">{primero?.sku ?? ""}{items.length > 1 ? `${primero?.sku ? " · " : ""}+${items.length - 1} más` : ""}</span>
                </>
              );
            },
            celdaMovil: (v) => {
              const items = v.ventas_items ?? [];
              return (
                <>
                  <span className="block">{items[0]?.producto_nombre ?? "—"}{items.length > 1 ? <span className="font-normal text-slate-400"> +{items.length - 1} más</span> : null}</span>
                  <span className="block text-xs font-normal text-slate-400">{items.length} ítem{items.length === 1 ? "" : "s"} · {items.reduce((a, i) => a + Number(i.cantidad), 0)} u</span>
                </>
              );
            } },
          { key: "items", titulo: "Ítems", claseTh: "text-center", claseTd: "text-center", movil: "oculto",
            celda: (v) => <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{(v.ventas_items ?? []).length}</span>,
            celdaMovil: (v) => { const it = v.ventas_items ?? []; return `${it.length} · ${it.reduce((a, i) => a + Number(i.cantidad), 0)} u`; } },
          { key: "cant", titulo: "Cant. total", claseTh: "text-right", claseTd: "text-right tabular-nums text-slate-700", movil: "oculto",
            celda: (v) => (v.ventas_items ?? []).reduce((a, i) => a + Number(i.cantidad), 0) },
          { key: "iva", titulo: "IVA", movil: "detalle",
            celda: (v) => { const ivas = [...new Set((v.ventas_items ?? []).map((i) => i.tipo_iva))]; return <span className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">{ivas.length === 1 ? `IVA ${ivas[0]}` : "Varios"}</span>; } },
          { key: "total", titulo: "Total", claseTh: "text-right", claseTd: "text-right font-semibold tabular-nums text-slate-800", movil: "valor", celda: (v) => formatGs(v.total) },
          { key: "cond", titulo: "Condición / pago", movil: "chip",
            celda: (v) => (
              <span className="inline-flex flex-col items-start">
                <span className="rounded-full px-2 py-1 text-xs font-semibold" style={v.tipo_venta === "CREDITO" ? { backgroundColor: "#fff7ed", color: "#ea580c" } : { backgroundColor: "#f1f5f9", color: "#475569" }}>
                  {v.tipo_venta === "CREDITO" ? "Crédito" : "Contado"}{v.estado === "anulada" ? " · anulada" : ""}
                </span>
                {v.tipo_venta !== "CREDITO" ? (
                  <span className="mt-1 block max-w-[180px] truncate text-[11px] text-slate-500 max-md:max-w-full" title={(v.pagos ?? []).map((pg) => `${metodoLabel(pg.metodo_pago)} ${formatGs(pg.monto)}`).join(" + ")}>
                    {(v.pagos ?? []).length ? [...new Set((v.pagos ?? []).map((pg) => metodoLabel(pg.metodo_pago)))].join(" + ") : metodoLabel(v.metodo_pago)}
                  </span>
                ) : null}
              </span>
            ) },
          { key: "caja", titulo: "Caja", claseTd: "text-xs text-slate-600", movil: "dato",
            celda: (v) => <>{v.punto?.nombre ?? "—"}{v.sucursal?.nombre ? <span className="block text-[11px] text-slate-400">{v.sucursal.nombre}</span> : null}</> },
          { key: "fecha", titulo: "Fecha", claseTd: "text-xs tabular-nums text-slate-500", movil: "oculto", celda: (v) => fechaVenta(v.fecha) },
        ]}
      />

      {/* Paginado */}
      {total > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <span className="text-sm text-slate-500">
            Mostrando <strong className="font-semibold text-slate-700">{inicio + 1}–{Math.min(inicio + porPagina, total)}</strong> de{" "}
            <strong className="font-semibold text-slate-700">{total.toLocaleString("es-PY")}</strong>
          </span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
                disabled={paginaActual <= 1}
                aria-label="Página anterior"
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[110px] text-center text-sm tabular-nums text-slate-600">
                Página <strong className="font-semibold text-slate-800">{paginaActual}</strong> de {totalPaginas}
              </span>
              <button
                type="button"
                onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                disabled={paginaActual >= totalPaginas}
                aria-label="Página siguiente"
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Celular: los filtros en una hoja inferior, uno debajo del otro. */}
      {filtrosAbiertos && angosta ? (
        <HojaInferior titulo="Filtros" onClose={() => setFiltrosAbiertos(false)}
          pie={<button type="button" onClick={() => setFiltrosAbiertos(false)} className="min-h-11 flex-1 rounded-xl px-4 text-sm font-semibold text-white" style={{ backgroundColor: TEAL }}>Ver {total.toLocaleString("es-PY")} ventas</button>}>
          <div className="flex flex-col gap-3 [&>*]:!w-full [&>*]:!min-w-0 [&_input]:w-full">{filtros}</div>
        </HojaInferior>
      ) : null}

      {viendo ? (
        <VentaDetalle ventaId={viendo} onClose={() => setViendo(null)} onAnulada={() => { setViendo(null); cargar(true); }} />
      ) : null}
    </section>
  );
}

