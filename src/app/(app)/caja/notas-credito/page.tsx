"use client";

/**
 * /caja/notas-credito — Notas de crédito (receta 99): devoluciones de productos y descuentos
 * sobre ventas ya hechas. Cada una dice a qué venta corrige, el motivo, el total y a dónde fue
 * la plata (bajó la deuda, se devolvió desde la caja, quedó a favor del cliente).
 *   · Se emiten desde el detalle de la venta (Órdenes de venta › venta › "Nota de crédito").
 *   · ?ver=<id> abre el detalle (imprimir A4 / anular).
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, ReceiptText, Search } from "lucide-react";
import { BarraFiltros, EncabezadoPagina } from "@/components/EncabezadoPagina";
import { SelectorFecha } from "@/components/SelectorFecha";
import { TablaTarjetas, useVistaTarjetas, type ColumnaTabla } from "@/components/TablaResponsive";
import { invalidarLista, useListaCacheada } from "@/modules/inventario/lista-cache";
import { INPUT_FILTRO, Paginador, Pestanas, TEAL } from "@/modules/inventario/ui";
import { fechaHora } from "@/lib/fecha/paraguay";
import { formatGs } from "@/modules/caja/lib";
import { VentaDetalle } from "@/modules/caja/VentaDetalle";
import { NotaCreditoDetalle } from "@/modules/caja/NotaCreditoDetalle";
import { destinoTexto, tipoNotaLabel, type ListaNotas, type NotaCreditoFila } from "@/modules/caja/notas-credito";

const POR_PAGINA = 25; // por página

function ChipEstado({ e }: { e: NotaCreditoFila["estado"] }) {
  return e === "anulada"
    ? <span className="inline-flex whitespace-nowrap rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200">Anulada</span>
    : <span className="inline-flex whitespace-nowrap rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">Emitida</span>;
}

const Total = ({ f }: { f: NotaCreditoFila }) => (
  <span className={`font-semibold tabular-nums ${f.estado === "anulada" ? "text-slate-400 line-through" : "text-slate-900"}`}>{formatGs(f.total)}</span>
);

const columnasMovil: ColumnaTabla<NotaCreditoFila>[] = [
  { key: "cliente", titulo: "Cliente", movil: "titulo", celda: (f) => f.cliente_nombre },
  { key: "numero", titulo: "Nota", movil: "subtitulo", celda: (f) => <><span className="font-mono">{f.numero}</span> · {fechaHora(f.fecha)}</> },
  { key: "total", titulo: "Total", movil: "valor", celda: (f) => <Total f={f} /> },
  { key: "estado", titulo: "Estado", movil: "chip", celda: (f) => <ChipEstado e={f.estado} /> },
  { key: "venta", titulo: "Venta", movil: "dato", celda: (f) => <span className="font-mono">{f.venta_numero}</span> },
  { key: "tipo", titulo: "Tipo", movil: "dato", celda: (f) => tipoNotaLabel(f.tipo) },
  { key: "destino", titulo: "La plata", movil: "detalle", celda: (f) => destinoTexto(f, formatGs) || "—" },
  { key: "motivo", titulo: "Motivo", movil: "detalle", celda: (f) => f.motivo },
];

export default function NotasCreditoPage() {
  return (
    <Suspense fallback={null}>
      <NotasCredito />
    </Suspense>
  );
}

function NotasCredito() {
  const router = useRouter();
  const sp = useSearchParams();
  const ver = sp.get("ver");
  const [vista, setVista] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [pagina, setPagina] = useState(1);
  const [recarga, setRecarga] = useState(0);
  const [venta, setVenta] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setQ(busqueda.trim()); setPagina(1); }, 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  const url = useMemo(() => {
    const p = new URLSearchParams({ pagina: String(pagina), por_pagina: String(POR_PAGINA) });
    if (vista) p.set("estado", vista);
    if (q) p.set("q", q);
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    return `/api/notas-credito?${p}`;
  }, [pagina, vista, q, desde, hasta]);
  const lista = useListaCacheada<ListaNotas>(url, recarga);
  const rows = lista.error ? [] : lista.datos?.rows ?? [];
  const total = lista.error ? 0 : lista.datos?.total ?? 0;

  const abrir = (id: string | null) => router.replace(id ? `/caja/notas-credito?ver=${id}` : "/caja/notas-credito", { scroll: false });
  const cambio = () => {
    invalidarLista("/api/notas-credito");
    invalidarLista("/api/productos");
    invalidarLista("/api/inventario/movimientos");
    setRecarga((k) => k + 1);
  };

  const vistaTarjetas = useVistaTarjetas();
  const filtros = !!(q || vista || desde || hasta);
  const vacio = (
    <div className="px-4 py-14 text-center">
      {lista.cargando ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /> : (
        <>
          <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl border" style={{ backgroundColor: `${TEAL}14`, borderColor: `${TEAL}33` }}>
            <ReceiptText className="h-6 w-6" style={{ color: TEAL }} />
          </div>
          <p className="text-sm font-semibold text-slate-700">{filtros ? "Ninguna nota coincide con los filtros" : "Todavía no hay notas de crédito"}</p>
          {!filtros ? (
            <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">Se hacen desde la venta: en Órdenes de venta abrí la venta y tocá «Nota de crédito» para devolver productos o hacer un descuento.</p>
          ) : null}
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-4 pb-10 sm:space-y-6">
      <EncabezadoPagina volver={{ href: "/caja/panel", label: "Caja" }} kicker="Caja" titulo="Notas de crédito"
        subtitulo="Devoluciones y descuentos sobre ventas ya hechas: el stock que vuelve y a dónde va la plata" />

      {lista.datos ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
          <Cifra etiqueta="Notas emitidas" valor={String(lista.datos.totales.cantidad)} detalle="en el filtro (sin anuladas)" />
          <Cifra etiqueta="Total acreditado" valor={formatGs(lista.datos.totales.total)} detalle="devoluciones y descuentos" />
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}33` }}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-3 sm:px-5" style={{ borderColor: `${TEAL}22`, background: `linear-gradient(to right, ${TEAL}0d, transparent)` }}>
          <div className="min-w-0 max-md:w-full">
            <Pestanas valor={vista} onChange={(v) => { setVista(v); setPagina(1); }}
              opciones={[{ id: "", label: "Todas" }, { id: "emitida", label: "Emitidas" }, { id: "anulada", label: "Anuladas" }]} />
          </div>
          <BarraFiltros plano className="max-md:w-full" activos={(desde ? 1 : 0) + (hasta ? 1 : 0)}
            onLimpiar={() => { setDesde(""); setHasta(""); setPagina(1); }}
            busqueda={
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="N°, venta, cliente, motivo…" type="search" enterKeyHint="search" aria-label="Buscar notas de crédito"
                  className={`${INPUT_FILTRO} w-full pl-9 max-md:h-11 md:w-56`} />
              </div>
            }>
            <div className="flex flex-col gap-1 md:block">
              <span className="text-xs font-medium text-slate-600 md:sr-only">Desde</span>
              <SelectorFecha compacto etiqueta="Desde" value={desde} onChange={(v) => { setDesde(v); setPagina(1); }} max={hasta || undefined} claseBoton="h-10 rounded-xl px-3 text-slate-800 max-md:h-11" className="max-md:w-full md:w-[150px]" />
            </div>
            <div className="flex flex-col gap-1 md:block">
              <span className="text-xs font-medium text-slate-600 md:sr-only">Hasta</span>
              <SelectorFecha compacto etiqueta="Hasta" value={hasta} onChange={(v) => { setHasta(v); setPagina(1); }} min={desde || undefined} claseBoton="h-10 rounded-xl px-3 text-slate-800 max-md:h-11" className="max-md:w-full md:w-[150px]" />
            </div>
          </BarraFiltros>
        </div>

        {vistaTarjetas ? (
          <TablaTarjetas filas={rows} columnas={columnasMovil} claveFila={(f) => f.id} onFila={(f) => abrir(f.id)} cargando={lista.cargando} vacio={vacio} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-slate-50/70 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Nota</th>
                  <th className="px-3 py-3 font-semibold">Cliente</th>
                  <th className="px-3 py-3 font-semibold">Venta</th>
                  <th className="px-3 py-3 font-semibold">Motivo</th>
                  <th className="px-3 py-3 text-right font-semibold">Total</th>
                  <th className="px-3 py-3 font-semibold">Estado</th>
                  <th className="px-5 py-3 font-semibold">Emitió</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 ? (
                  <tr><td colSpan={7}>{vacio}</td></tr>
                ) : rows.map((f) => (
                  <tr key={f.id} onClick={() => abrir(f.id)} className={`cursor-pointer transition-colors hover:bg-[var(--brand-50)] ${lista.cargando ? "opacity-60" : ""}`}>
                    <td className="px-5 py-3">
                      <p className="font-mono text-sm font-semibold text-slate-900">{f.numero}</p>
                      <p className="text-[11px] text-slate-500">{tipoNotaLabel(f.tipo)}</p>
                    </td>
                    <td className="max-w-[220px] px-3 py-3"><p className="truncate font-medium text-slate-800" title={f.cliente_nombre}>{f.cliente_nombre}</p></td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-600">{f.venta_numero}</td>
                    <td className="max-w-[260px] px-3 py-3">
                      <p className="truncate text-slate-700" title={f.motivo}>{f.motivo}</p>
                      <p className="truncate text-[11px] text-slate-400">{destinoTexto(f, formatGs)}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right"><Total f={f} /></td>
                    <td className="px-3 py-3"><ChipEstado e={f.estado} /></td>
                    <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">
                      {fechaHora(f.fecha)}
                      <span className="block text-[11px] text-slate-400">{f.usuario_nombre}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Paginador pagina={pagina} porPagina={POR_PAGINA} total={total} cargando={lista.cargando} onCambiar={setPagina} />
      </section>

      {ver ? <NotaCreditoDetalle notaId={ver} onClose={() => abrir(null)} onCambio={cambio} onVerVenta={(id) => { abrir(null); setVenta(id); }} /> : null}
      {venta ? <VentaDetalle ventaId={venta} onClose={() => setVenta(null)} onAnulada={() => { setVenta(null); cambio(); }} onCambio={cambio} /> : null}
    </div>
  );
}

function Cifra({ etiqueta, valor, detalle }: { etiqueta: string; valor: string; detalle: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3.5 py-3 shadow-sm sm:px-5 sm:py-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{etiqueta}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 [overflow-wrap:anywhere] sm:text-xl">{valor}</p>
      <p className="text-[11px] text-slate-400">{detalle}</p>
    </div>
  );
}
