"use client";

/**
 * Caja › Órdenes de venta: las ventas (contado y crédito) con filtros por sucursal, caja,
 * forma de pago, condición, IVA, estado, producto y fechas. Arriba, las cajas abiertas
 * (cada una lleva a Apertura y cierre).
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, Wallet, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { VentaDetalle } from "@/modules/caja/VentaDetalle";
import { formatGs } from "@/modules/caja/lib";
import { etiquetaCaja, hora, metodoLabel, METODOS_VENTA, useEstadoCajas, type EstadoCajas } from "@/modules/caja/turno";

const TEAL = clienteConfig.color;

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
    <div className="space-y-6 pb-10">
      {/* Encabezado estilo dashboard */}
      <div>
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Finanzas · Caja</p>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Órdenes de venta</h1>
        <p className="mt-1 text-sm text-slate-500">Todas las ventas de las cajas, con su forma de pago</p>
      </div>

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
    <section className="flex flex-wrap items-stretch gap-3">
      {abiertas.length === 0 ? (
        <Link href="/caja/turnos" className="flex items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-500 transition hover:border-[var(--brand)] hover:text-[var(--brand)]">
          <Wallet className="h-4 w-4" /> No hay cajas abiertas · Abrir caja
        </Link>
      ) : abiertas.map(({ c, s }) => (
        <Link key={c.id} href="/caja/turnos" className="min-w-[220px] rounded-2xl border border-emerald-100 bg-white px-4 py-3 shadow-sm transition hover:border-emerald-200 hover:shadow">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> {etiquetaCaja({ punto_nombre: c.nombre, sucursal_nombre: s.nombre })}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">Turno N° {c.turno!.numero_caja} · {c.turno!.abierta_por_nombre ?? "—"} · desde {hora(c.turno!.fecha_apertura)}</p>
          <p className="mt-1.5 flex items-baseline justify-between gap-3 text-xs">
            <span className="text-slate-500">{c.turno!.ventas_cantidad} venta{c.turno!.ventas_cantidad === 1 ? "" : "s"}</span>
            <span className="font-bold tabular-nums text-slate-900">{formatGs(c.turno!.ventas_total)}</span>
          </p>
        </Link>
      ))}
      <div className="ml-auto flex items-center gap-2">
        <Link href="/caja/turnos" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50">Apertura y cierre</Link>
        <Link href="/caja/credito" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50">Ventas a crédito</Link>
        <Link href="/caja/nueva" className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:brightness-95" style={{ backgroundColor: TEAL }}>+ Nueva venta</Link>
      </div>
    </section>
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
  const [producto, setProducto] = useState("");
  const [sucursal, setSucursal] = useState("");
  const [punto, setPunto] = useState("");
  const [metodo, setMetodo] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [viendo, setViendo] = useState<string | null>(null);
  const [productosOpts, setProductosOpts] = useState<[string, string][]>([["", "Todos los productos"]]);
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
    if (producto) sp.set("producto", producto);
    if (sucursal) sp.set("sucursal", sucursal);
    if (punto) sp.set("punto", punto);
    if (metodo) sp.set("metodo", metodo);
    if (desde) sp.set("desde", desde);
    if (hasta) sp.set("hasta", hasta);
    const firma = JSON.stringify([porPagina, q, tipo, iva, estado, producto, desde, hasta, sucursal, punto, metodo]);
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
  }, [pagina, porPagina, q, tipo, iva, estado, producto, desde, hasta, sucursal, punto, metodo]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Opciones del filtro por producto: el catálogo (ya no se deducen de lo cargado). Solo
  // los nombres (antes se bajaba el catálogo entero con costos y stock para esto).
  useEffect(() => {
    apiFetch<{ nombre: string }[]>("/api/productos?pos=1&campos=nombre")
      .then((ps) => setProductosOpts([["", "Todos los productos"], ...[...new Set(ps.map((p) => p.nombre))].sort().map((n): [string, string] => [n, n])]))
      .catch(() => {});
  }, []);

  const filtrosActivos = (tipo ? 1 : 0) + (iva ? 1 : 0) + (estado ? 1 : 0) + (producto ? 1 : 0) + (desde ? 1 : 0) + (hasta ? 1 : 0) +
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

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="block h-5 w-1 rounded-full" style={{ backgroundColor: TEAL }} />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">Ventas</h2>
        </div>
      </div>

      <div className="mb-5 border-b border-slate-100 pb-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative w-full min-w-56 flex-1 sm:max-w-md">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar número, producto, SKU, monto…"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-11 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]"
            />
          </div>
          <button
            type="button"
            onClick={() => setFiltrosAbiertos((v) => !v)}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors"
            style={filtrosActivos || filtrosAbiertos ? { borderColor: TEAL, color: TEAL, backgroundColor: "var(--brand-50)" } : { borderColor: "#e2e8f0", color: "#475569" }}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filtros
            {filtrosActivos ? (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold text-white" style={{ backgroundColor: TEAL }}>{filtrosActivos}</span>
            ) : null}
          </button>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Filas</span>
            <Select value={String(porPagina)} onChange={conPagina1((v: string) => setPorPagina(Number(v)))} options={[["25", "25"], ["50", "50"], ["100", "100"]]} minWidth={84} />
          </div>
          <span className={`ml-auto text-sm text-slate-400 transition-opacity ${buscando ? "opacity-50" : ""}`}>{total.toLocaleString("es-PY")} de {totalGeneral.toLocaleString("es-PY")} ventas</span>
        </div>

        {filtrosAbiertos ? (
          <div className="mt-3 flex flex-wrap items-end gap-2.5 rounded-xl bg-slate-50 p-3" style={{ animation: "rb-pop 0.15s cubic-bezier(0.16,1,0.3,1)" }}>
            {sucursalesOpts.length > 2 ? (
              <Select value={sucursal} onChange={conPagina1((v: string) => { setSucursal(v); setPunto(""); })} options={sucursalesOpts} minWidth={180} />
            ) : null}
            <Select value={punto} onChange={conPagina1(setPunto)} options={cajasOpts} minWidth={190} />
            <Select value={tipo} onChange={conPagina1(setTipo)} options={[["", "Contado y crédito"], ["CONTADO", "Contado"], ["CREDITO", "Crédito"]]} minWidth={150} />
            <Select value={metodo} onChange={conPagina1(setMetodo)} minWidth={180}
              options={[["", "Todas las formas de pago"], ...METODOS_VENTA.map((m): [string, string] => [m.value, m.label]), ["mixto", "Pago mixto"]]} />
            <Select value={iva} onChange={conPagina1(setIva)} options={[["", "Todos los IVA"], ["10%", "IVA 10%"], ["5%", "IVA 5%"], ["EXENTA", "Exenta"]]} minWidth={140} />
            <Select value={estado} onChange={conPagina1(setEstado)} options={[["", "Todos los estados"], ["completada", "Completada"], ["anulada", "Anulada"]]} minWidth={160} />
            <Select value={producto} onChange={conPagina1(setProducto)} options={productosOpts} minWidth={190} />
            <label className="flex flex-col gap-1">
              <span className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Desde</span>
              <input type="date" value={desde} onChange={(e) => { setDesde(e.target.value); setPagina(1); }} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Hasta</span>
              <input type="date" value={hasta} onChange={(e) => { setHasta(e.target.value); setPagina(1); }} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]" />
            </label>
            {filtrosActivos ? (
              <button
                type="button"
                onClick={() => { setTipo(""); setIva(""); setEstado(""); setProducto(""); setDesde(""); setHasta(""); setSucursal(""); setPunto(""); setMetodo(""); setPagina(1); }}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:text-rose-600"
              >
                <X className="h-3.5 w-3.5" /> Limpiar
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-slate-50 text-xs font-semibold text-slate-500">
              <th className="rounded-l-lg px-4 py-3">Número</th>
              <th className="px-4 py-3">Productos</th>
              <th className="px-4 py-3 text-center">Ítems</th>
              <th className="px-4 py-3 text-right">Cant. total</th>
              <th className="px-4 py-3">IVA</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">Condición / pago</th>
              <th className="px-4 py-3">Caja</th>
              <th className="rounded-r-lg px-4 py-3">Fecha</th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 ? (
              <tr><td colSpan={9} className="py-12 text-center text-slate-400">{buscando ? "Buscando…" : totalGeneral === 0 ? "No hay ventas registradas" : "Ninguna venta coincide con los filtros"}</td></tr>
            ) : (
              visibles.map((v) => {
                const items = v.ventas_items ?? [];
                const cantTotal = items.reduce((s, i) => s + Number(i.cantidad), 0);
                const ivas = [...new Set(items.map((i) => i.tipo_iva))];
                const primero = items[0];
                const anulada = v.estado === "anulada";
                return (
                  <tr
                    key={v.id}
                    onClick={() => setViendo(v.id)}
                    title="Ver el detalle de la venta"
                    className={`cursor-pointer border-b border-slate-100 last:border-0 transition-colors hover:bg-slate-50 ${anulada ? "opacity-50" : ""}`}
                  >
                    <td className="px-4 py-4 font-mono text-xs text-slate-500">{v.numero_control}</td>
                    <td className="px-4 py-4">
                      <span className="block truncate text-slate-800">{primero?.producto_nombre ?? "—"}</span>
                      <span className="text-xs text-slate-400">
                        {primero?.sku ?? ""}{items.length > 1 ? `${primero?.sku ? " · " : ""}+${items.length - 1} más` : ""}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{items.length}</span>
                    </td>
                    <td className="px-4 py-4 text-right tabular-nums text-slate-700">{cantTotal}</td>
                    <td className="px-4 py-4"><span className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">{ivas.length === 1 ? `IVA ${ivas[0]}` : "Varios"}</span></td>
                    <td className="px-4 py-4 text-right font-semibold tabular-nums text-slate-800">{formatGs(v.total)}</td>
                    <td className="px-4 py-4">
                      <span className="rounded-full px-2 py-1 text-xs font-semibold" style={v.tipo_venta === "CREDITO" ? { backgroundColor: "#fff7ed", color: "#ea580c" } : { backgroundColor: "#f1f5f9", color: "#475569" }}>
                        {v.tipo_venta === "CREDITO" ? "Crédito" : "Contado"}
                      </span>
                      {v.tipo_venta !== "CREDITO" ? (
                        <span className="mt-1 block max-w-[180px] truncate text-[11px] text-slate-500" title={(v.pagos ?? []).map((p) => `${metodoLabel(p.metodo_pago)} ${formatGs(p.monto)}`).join(" + ")}>
                          {(v.pagos ?? []).length ? [...new Set((v.pagos ?? []).map((p) => metodoLabel(p.metodo_pago)))].join(" + ") : metodoLabel(v.metodo_pago)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-4 text-xs text-slate-600">
                      {v.punto?.nombre ?? "—"}
                      {v.sucursal?.nombre ? <span className="block text-[11px] text-slate-400">{v.sucursal.nombre}</span> : null}
                    </td>
                    <td className="px-4 py-4 text-xs tabular-nums text-slate-500">{new Date(v.fecha).toLocaleString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

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
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
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
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {viendo ? (
        <VentaDetalle ventaId={viendo} onClose={() => setViendo(null)} onAnulada={() => { setViendo(null); cargar(true); }} />
      ) : null}
    </section>
  );
}

