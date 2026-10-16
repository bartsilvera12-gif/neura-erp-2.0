"use client";

/**
 * /compras — facturas de compra (Fase 2). Lista paginada en el servidor con búsqueda
 * inteligente (número, proveedor, factura, timbrado, productos), filtros por fecha,
 * condición y estado (el proveedor se busca con el buscador). Al tocar una compra se
 * abre el detalle, desde donde se puede anular (revierte stock y costos).
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Ban, Banknote, Loader2, Plus, Printer, Search, ShoppingCart, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { Drawer } from "@/components/Drawer";
import { AccionesPagina, BarraFiltros, EncabezadoPagina } from "@/components/EncabezadoPagina";
import { TablaTarjetas, type ColumnaTabla } from "@/components/TablaResponsive";
import { TZ_PY } from "@/lib/fecha/paraguay";
import type { Compra } from "@/modules/compras/tipos";
import { ComprobantesCompra } from "@/modules/compras/Comprobantes";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { ESTADO_CXP, dinero, nombreMetodoPago } from "@/modules/compras/pagos";
import { RegistrarPagoProveedor, imprimirOrdenPago, useAvisoPago } from "@/modules/compras/RegistrarPagoProveedor";
import { SelectorFecha } from "@/components/SelectorFecha";

const TEAL = clienteConfig.color;
const POR_PAGINA = 25;
const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "short", year: "numeric" });
const fechaDia = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("es-PY", { day: "2-digit", month: "short", year: "numeric" });
const TH = "whitespace-nowrap px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[var(--brand)]";

export default function ComprasPage() {
  const [rows, setRows] = useState<Compra[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [borrador, setBorrador] = useState("");
  const [q, setQ] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [tipoPago, setTipoPago] = useState("");
  const [estado, setEstado] = useState("");
  const [viendo, setViendo] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    // /compras?ver=<id> (desde Pagos a proveedores): abre el detalle de esa compra.
    const ver = new URLSearchParams(window.location.search).get("ver");
    if (ver && /^[0-9a-f-]{36}$/i.test(ver)) { setViendo(ver); window.history.replaceState(null, "", "/compras"); }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { setQ(borrador.trim()); setPagina(1); }, 350);
    return () => clearTimeout(t);
  }, [borrador]);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    const sp = new URLSearchParams({ pagina: String(pagina), por_pagina: String(POR_PAGINA) });
    if (q) sp.set("q", q);
    if (desde) sp.set("desde", desde);
    if (hasta) sp.set("hasta", hasta);
    if (tipoPago) sp.set("tipo_pago", tipoPago);
    if (estado) sp.set("estado", estado);
    apiFetch<{ rows: Compra[]; total: number }>(`/api/compras?${sp}`)
      .then((r) => { if (!cancel) { setRows(r.rows); setTotal(r.total); } })
      .catch(() => { if (!cancel) { setRows([]); setTotal(0); } })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [pagina, q, desde, hasta, tipoPago, estado, recarga]);

  const refrescar = useCallback(() => setRecarga((k) => k + 1), []);
  const hayFiltros = !!(q || desde || hasta || tipoPago || estado);
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  const filtrosActivos = [desde, hasta, tipoPago, estado].filter(Boolean).length;
  const limpiar = () => { setBorrador(""); setQ(""); setDesde(""); setHasta(""); setTipoPago(""); setEstado(""); setPagina(1); };

  // Tabla en ≥ 768 px; en celular cada compra es una tarjeta (proveedor, número · fecha, total y condición).
  const columnas: ColumnaTabla<Compra>[] = [
    {
      key: "numero", titulo: "Número", movil: "subtitulo", claseTh: "pl-5", claseTd: "whitespace-nowrap pl-5",
      celda: (c) => {
        const anulada = c.estado === "anulada";
        return (
          <>
            <p className={`font-mono text-xs font-semibold ${anulada ? "text-slate-400 line-through" : "text-slate-800"}`}>{c.numero_control}</p>
            {anulada ? <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">Anulada</span> : null}
            {c.oc?.numero_oc ? <p className="mt-0.5 font-mono text-[10px] text-sky-700" title="Recepción de una orden de compra">{c.oc.numero_oc}</p> : null}
          </>
        );
      },
      celdaMovil: (c) => (
        <span className={c.estado === "anulada" ? "line-through" : ""}>
          <span className="font-mono text-xs">{c.numero_control}</span> · {fecha(c.fecha)}
        </span>
      ),
    },
    { key: "fecha", titulo: "Fecha", movil: "oculto", claseTd: "whitespace-nowrap text-xs text-slate-600", celda: (c) => fecha(c.fecha) },
    { key: "proveedor", titulo: "Proveedor", movil: "titulo", claseTd: "font-semibold text-slate-800", celda: (c) => c.proveedor_nombre },
    { key: "factura", titulo: "Factura", movil: "dato", claseTd: "whitespace-nowrap font-mono text-xs text-slate-600", celda: (c) => c.numero_factura, celdaMovil: (c) => <span className="font-mono">{c.numero_factura}</span> },
    { key: "productos", titulo: "Productos", movil: "dato", claseTh: "text-center", claseTd: "text-center text-slate-600", celda: (c) => c.cantidad_items },
    {
      key: "condicion", titulo: "Condición", movil: "chip",
      celda: (c) => {
        const anulada = c.estado === "anulada";
        return (
          <>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.tipo_pago === "credito" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
              {c.tipo_pago === "credito" ? "Crédito" : "Contado"}
            </span>
            {c.tipo_pago === "credito" && !anulada && c.deuda ? (
              c.deuda.estado === "pagada"
                ? <p className="mt-0.5 text-[11px] font-semibold text-emerald-600">Pagada</p>
                : <p className="mt-0.5 text-[11px] text-slate-500">debés {dinero(c.deuda.saldo, c.deuda.moneda)}{c.vencimiento ? ` · vence ${fechaDia(c.vencimiento)}` : ""}</p>
            ) : c.tipo_pago === "credito" && c.vencimiento ? <p className="mt-0.5 text-[11px] text-slate-400">vence {fechaDia(c.vencimiento)}</p> : null}
            {c.tipo_pago === "contado" && c.medio_pago ? <p className="mt-0.5 text-[11px] text-slate-400">{nombreMetodoPago(c.medio_pago)}</p> : null}
          </>
        );
      },
      // Tarjeta: solo los chips (el detalle de la deuda va en "Pago").
      celdaMovil: (c) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.tipo_pago === "credito" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
            {c.tipo_pago === "credito" ? "Crédito" : "Contado"}
          </span>
          {c.estado === "anulada" ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-600">Anulada</span> : null}
          {c.oc?.numero_oc ? <span className="rounded-full bg-sky-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-sky-700">{c.oc.numero_oc}</span> : null}
        </span>
      ),
    },
    {
      // Solo en la tarjeta: cómo está el pago (en la tabla ya va dentro de "Condición").
      key: "pago", titulo: "Pago", movil: "dato", claseTh: "hidden", claseTd: "hidden",
      celda: (c) => c.estado === "anulada" ? "—"
        : c.tipo_pago === "credito"
          ? c.deuda ? (c.deuda.estado === "pagada" ? <span className="font-semibold text-emerald-600">Pagada</span> : <>Debés {dinero(c.deuda.saldo, c.deuda.moneda)}{c.vencimiento ? ` · vence ${fechaDia(c.vencimiento)}` : ""}</>)
            : c.vencimiento ? `Vence ${fechaDia(c.vencimiento)}` : "A crédito"
          : c.medio_pago ? nombreMetodoPago(c.medio_pago) : "Contado",
    },
    {
      key: "total", titulo: "Total", movil: "valor", claseTh: "pr-5 text-right",
      claseTd: "whitespace-nowrap pr-5 text-right font-bold tabular-nums",
      celda: (c) => <span className={c.estado === "anulada" ? "text-slate-400 line-through" : "text-slate-900"}>{gs(c.total)}</span>,
    },
  ];

  return (
    <div className="space-y-5 pb-10 sm:space-y-6">
      <EncabezadoPagina
        titulo="Compras"
        subtitulo="Las facturas de tus proveedores: cada una suma stock y actualiza los costos."
        acciones={<AccionesPagina acciones={[{ etiqueta: "Nueva compra", icono: <Plus />, href: "/compras/nueva", primaria: true }]} />}
      />

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-3 py-3 sm:px-5">
          <BarraFiltros
            plano
            activos={filtrosActivos}
            onLimpiar={limpiar}
            busqueda={
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input type="search" value={borrador} onChange={(e) => setBorrador(e.target.value)} placeholder="Buscar por número, proveedor, factura o producto…"
                  aria-label="Buscar compras" enterKeyHint="search"
                  className="h-11 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)] md:h-auto md:py-2.5" />
              </div>
            }
          >
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600 md:hidden">Desde</span>
              <SelectorFecha compacto etiqueta="Desde" value={desde} onChange={(v) => { setDesde(v); setPagina(1); }} claseBoton="h-11 rounded-xl px-3 text-slate-600 md:h-[38px]" className="w-full md:w-[150px]" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600 md:hidden">Hasta</span>
              <SelectorFecha compacto etiqueta="Hasta" value={hasta} onChange={(v) => { setHasta(v); setPagina(1); }} claseBoton="h-11 rounded-xl px-3 text-slate-600 md:h-[38px]" className="w-full md:w-[150px]" />
            </div>
            <Select value={tipoPago} onChange={(v) => { setTipoPago(v); setPagina(1); }} minWidth={140} etiqueta="Condición" options={[["", "Contado y crédito"], ["contado", "Contado"], ["credito", "Crédito"]]} />
            <Select value={estado} onChange={(v) => { setEstado(v); setPagina(1); }} minWidth={140} etiqueta="Estado" options={[["", "Todas"], ["registrada", "Registradas"], ["anulada", "Anuladas"]]} />
            {hayFiltros && !filtrosActivos ? (
              <button onClick={limpiar} className="text-xs text-slate-400 underline-offset-2 hover:text-slate-700 hover:underline max-md:hidden">Limpiar</button>
            ) : null}
          </BarraFiltros>
        </div>

        {cargando && rows.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-400">Cargando…</p>
        ) : rows.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <ShoppingCart className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-700">{hayFiltros ? "Ninguna compra coincide con los filtros" : "Todavía no cargaste compras"}</p>
            {!hayFiltros ? (
              <Link href="/compras/nueva" className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white sm:min-h-0" style={{ backgroundColor: TEAL }}>
                <Plus className="h-4 w-4" /> Cargar la primera
              </Link>
            ) : null}
          </div>
        ) : (
          <TablaTarjetas
            filas={rows}
            columnas={columnas}
            claveFila={(c) => c.id}
            onFila={(c) => setViendo(c.id)}
            cargando={cargando}
            minAncho={860}
            claseTabla="w-full text-left text-sm"
            claseThead="border-b-2 border-[var(--brand)]/15 bg-[var(--brand)]/5"
            thBase={TH}
            tdBase="px-3 py-3"
          />
        )}

        {total > POR_PAGINA ? (
          <div className="flex flex-col gap-2 border-t border-slate-100 px-3 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <span className="text-center sm:text-left">Página {pagina} de {totalPaginas} · {total} compras</span>
            <div className="flex gap-2">
              <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 max-sm:min-h-11 max-sm:flex-1 max-sm:text-sm">Anterior</button>
              <button disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 max-sm:min-h-11 max-sm:flex-1 max-sm:text-sm">Siguiente</button>
            </div>
          </div>
        ) : null}
      </section>

      {viendo ? <DetalleCompra id={viendo} onClose={() => setViendo(null)} onAnulada={() => { refrescar(); }} /> : null}
    </div>
  );
}

function DetalleCompra({ id, onClose, onAnulada }: { id: string; onClose: () => void; onAnulada: () => void }) {
  const [c, setC] = useState<Compra | null>(null);
  const [pagando, setPagando] = useState(false);
  const { nodo: aviso, avisar } = useAvisoPago();
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esAdmin = useUsuario()?.rol === "ADMIN";

  const cargar = useCallback(() => {
    apiFetch<Compra>(`/api/compras/${id}`).then(setC).catch((e) => setError((e as Error).message));
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  async function anular() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/compras/${id}/anular`, { method: "POST", body: JSON.stringify({ motivo }) });
      setAnulando(false);
      cargar();
      onAnulada();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const anulada = c?.estado === "anulada";
  const cxp = c?.cuenta_pagar ?? null;
  return (
    <>
    <Drawer
      titulo={c ? `Compra ${c.numero_control}` : "Compra"}
      subtitulo={c ? `${c.proveedor_nombre} · factura ${c.numero_factura}` : undefined}
      onClose={onClose}
      footer={c && !anulada ? (
        anulando ? (
          <>
            <button onClick={() => setAnulando(false)} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 max-sm:flex-1">Volver</button>
            <button onClick={anular} disabled={busy || !motivo.trim()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-40 max-sm:flex-[2] max-sm:px-3">
              {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Ban className="h-4 w-4 shrink-0" />} Confirmar anulación
            </button>
          </>
        ) : (
          <button onClick={() => setAnulando(true)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 max-sm:flex-1">
            <Ban className="h-4 w-4" /> Anular compra
          </button>
        )
      ) : undefined}
    >
      {!c ? (
        error ? <p className="text-sm text-rose-600">{error}</p> : <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : (
        <div className="space-y-5">
          {anulada ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <p className="font-semibold">Compra anulada</p>
              <p className="text-xs">{c.anulada_motivo}{c.anulada_por ? ` · ${c.anulada_por}` : ""}{c.anulada_at ? ` · ${fecha(c.anulada_at)}` : ""}</p>
            </div>
          ) : null}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Dato l="Cargada" v={`${fecha(c.fecha)}${c.usuario_nombre ? ` · ${c.usuario_nombre}` : ""}`} />
            <Dato l="Fecha de la factura" v={c.fecha_factura ? fechaDia(c.fecha_factura) : "—"} />
            <Dato l="Timbrado" v={c.nro_timbrado ?? "—"} mono />
            {c.deposito?.nombre ? <Dato l="Entró al depósito" v={c.deposito.nombre} /> : null}
            <Dato l="Condición" v={c.tipo_pago === "credito"
              ? `Crédito${c.plazo_dias ? ` ${c.plazo_dias} días` : ""}${c.vencimiento ? ` · vence ${fechaDia(c.vencimiento)}` : ""}`
              : `Contado${c.medio_pago ? ` · ${nombreMetodoPago(c.medio_pago)}${c.medio_pago === "efectivo" ? " (salió de la caja)" : ""}` : ""}${c.referencia_pago ? ` · ${c.referencia_pago}` : ""}`} />
            {c.moneda === "USD" ? <Dato l="Moneda" v={`Dólares · 1 US$ = ${gs(c.tipo_cambio)}`} /> : null}
            {c.orden_compra_id ? (
              <div>
                <dt className="text-[11px] text-slate-500">Orden de compra</dt>
                <dd><Link href={`/compras/ordenes?ver=${c.orden_compra_id}`} className="inline-flex items-center font-mono text-sm font-semibold text-sky-700 hover:underline max-sm:min-h-11">{c.oc?.numero_oc ?? "Ver la orden"}</Link></dd>
              </div>
            ) : null}
          </dl>

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Productos</p>
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
              {(c.items ?? []).map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 max-sm:line-clamp-2 max-sm:[overflow-wrap:anywhere] sm:truncate">{i.producto_nombre}</p>
                    <p className="text-[11px] text-slate-500">
                      {Number(i.cantidad).toLocaleString("es-PY")} × {c.moneda === "USD" ? `US$ ${Number(i.costo_unitario_original).toLocaleString("es-PY")}` : gs(i.costo_unitario)}
                      {i.precio_venta_nuevo ? ` · precio de venta → ${gs(i.precio_venta_nuevo)}` : ""}
                      {i.lote_numero ? <> · lote <span className="font-mono font-semibold text-slate-600">{i.lote_numero}</span>{i.lote_vencimiento ? ` vence ${i.lote_vencimiento.slice(8, 10)}/${i.lote_vencimiento.slice(5, 7)}/${i.lote_vencimiento.slice(0, 4)}` : ""}</> : null}
                    </p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-slate-900">{gs(i.total)}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-1 rounded-xl bg-slate-50 p-4 text-sm">
            <div className="flex justify-between text-slate-600"><span>Subtotal sin IVA</span><span className="tabular-nums">{gs(c.subtotal)}</span></div>
            <div className="flex justify-between text-slate-600"><span>IVA contenido</span><span className="tabular-nums">{gs(c.monto_iva)}</span></div>
            <div className="flex justify-between border-t border-slate-200 pt-1.5 font-bold text-slate-900"><span>Total</span><span className="tabular-nums">{gs(c.total)}</span></div>
          </div>

          {c.observacion ? <p className="rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-600">{c.observacion}</p> : null}

          {c.tipo_pago === "credito" && cxp ? <CuentaPagarBloque c={c} puedePagar={esAdmin && !anulada} onPagar={() => setPagando(true)} /> : null}

          <ComprobantesCompra compraId={c.id} esAdmin={esAdmin} />

          {anulando ? (
            <div className="rounded-xl border border-rose-200 p-4">
              <p className="text-sm font-semibold text-slate-800">¿Por qué la anulás?</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Se descuenta del stock lo que entró con esta compra y se recalcula el costo promedio. Queda registrado en el kardex.
                {c.orden_compra_id ? ` Lo recibido vuelve a quedar pendiente en la ${c.oc?.numero_oc ?? "orden de compra"}.` : ""}
                {c.tipo_pago === "contado" && c.medio_pago === "efectivo" ? " El egreso de caja se anula (solo si esa caja sigue abierta)." : ""}
                {c.tipo_pago === "credito" ? " Su cuenta a pagar se anula." : ""}
              </p>
              {cxp && Number(cxp.pagado) > 0 ? (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Esta compra ya tiene pagos al proveedor ({dinero(cxp.pagado, cxp.moneda)}): para anularla primero anulá esas órdenes de pago.</p>
              ) : null}
              <textarea autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500} enterKeyHint="done" placeholder="Ej: se cargó con el proveedor equivocado"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-rose-400 focus:ring-4 focus:ring-rose-100" />
            </div>
          ) : null}
          {error ? (
            <div className="flex items-start justify-between gap-2 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">
              <span className="min-w-0 [overflow-wrap:anywhere]">{error}</span><button onClick={() => setError(null)} aria-label="Cerrar" className="inline-flex shrink-0 items-center justify-center max-sm:-m-2 max-sm:h-9 max-sm:w-9"><X className="h-3.5 w-3.5" /></button>
            </div>
          ) : null}
        </div>
      )}
    </Drawer>
    {pagando && c && cxp ? (
      <RegistrarPagoProveedor proveedorId={c.proveedor_id} proveedorNombre={c.proveedor_nombre} moneda={cxp.moneda} cxpInicial={cxp.id}
        onClose={() => setPagando(false)} onHecho={(p) => { avisar(p); cargar(); }} />
    ) : null}
    {aviso}
    </>
  );
}

/** Compra a crédito: cómo está su cuenta a pagar (saldo, pagado, vencimiento y pagos aplicados). */
function CuentaPagarBloque({ c, puedePagar, onPagar }: { c: Compra; puedePagar: boolean; onPagar: () => void }) {
  const x = c.cuenta_pagar!;
  const din = (v: number) => dinero(v, x.moneda);
  const abierta = x.estado === "pendiente" || x.estado === "parcial";
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: TZ_PY });
  const atraso = abierta && x.vencimiento < hoy ? Math.round((Date.parse(hoy) - Date.parse(x.vencimiento)) / 86400000) : 0;
  const est = atraso > 0 ? { t: `Vencida · ${atraso} días de atraso`, c: "bg-rose-50 text-rose-700" } : ESTADO_CXP[x.estado] ?? ESTADO_CXP.pendiente;
  return (
    <div className="rounded-xl border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Cuenta a pagar</p>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${est.c}`}>{est.t}</span>
      </div>
      <dl className="grid grid-cols-2 gap-3 px-4 py-3 text-sm sm:grid-cols-3">
        <div className="min-w-0"><dt className="text-[11px] text-slate-500">Saldo</dt><dd className="font-bold tabular-nums text-slate-900 [overflow-wrap:anywhere]">{din(x.saldo)}</dd></div>
        <div className="min-w-0"><dt className="text-[11px] text-slate-500">Pagado</dt><dd className="font-semibold tabular-nums text-emerald-700 [overflow-wrap:anywhere]">{din(x.pagado)}</dd></div>
        <div className="col-span-2 sm:col-span-1"><dt className="text-[11px] text-slate-500">Vence</dt><dd className={`font-medium ${atraso > 0 ? "text-rose-600" : "text-slate-800"}`}>{fechaDia(x.vencimiento)}</dd></div>
      </dl>
      {x.pagos.length ? (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {x.pagos.map((p) => (
            <li key={p.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs ${p.anulado_at ? "opacity-60" : ""}`}>
              <span className={`font-mono font-semibold text-slate-800 ${p.anulado_at ? "line-through" : ""}`}>{p.numero}</span>
              <span className="text-slate-500 max-sm:order-last max-sm:-mt-1.5 max-sm:basis-full">{fecha(p.fecha)}</span>
              {p.anulado_at ? <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">Anulada</span> : null}
              <span className={`ml-auto font-semibold tabular-nums ${p.anulado_at ? "text-slate-400 line-through" : "text-emerald-700"}`}>{din(p.monto)}</span>
              <button onClick={() => imprimirOrdenPago(p.id, p.numero).catch(() => {})} title="Orden de pago en PDF" aria-label={`Orden de pago ${p.numero} en PDF`} className="inline-flex items-center justify-center rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 max-sm:-my-2 max-sm:-mr-2 max-sm:h-11 max-sm:w-11"><Printer className="h-4 w-4 sm:h-3.5 sm:w-3.5" /></button>
            </li>
          ))}
        </ul>
      ) : null}
      {puedePagar && abierta && Number(x.saldo) > 0 ? (
        <div className="border-t border-slate-100 px-4 py-3">
          <button onClick={onPagar} className="inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white hover:brightness-95 max-sm:min-h-11 max-sm:w-full" style={{ backgroundColor: TEAL }}>
            <Banknote className="h-4 w-4" /> Pagar {din(x.saldo)}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Dato({ l, v, mono }: { l: string; v: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-slate-500">{l}</dt>
      <dd className={`text-sm font-medium text-slate-800 [overflow-wrap:anywhere] ${mono ? "font-mono" : ""}`}>{v}</dd>
    </div>
  );
}
