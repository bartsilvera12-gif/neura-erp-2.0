"use client";

/**
 * /compras — facturas de compra (Fase 2). Lista paginada en el servidor con búsqueda
 * inteligente (número, proveedor, factura, timbrado, productos), filtros por fecha,
 * proveedor, condición y estado. Al tocar una compra se abre el detalle, desde donde se
 * puede anular (revierte stock y costos).
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Ban, Loader2, Plus, Search, ShoppingCart, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { Drawer } from "@/components/Drawer";
import { TZ_PY } from "@/lib/fecha/paraguay";
import type { Compra } from "@/modules/compras/tipos";
import { nombreProveedor, type Proveedor } from "@/modules/proveedores/tipos";

const TEAL = clienteConfig.color;
const POR_PAGINA = 25;
const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "short", year: "numeric" });
const fechaDia = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("es-PY", { day: "2-digit", month: "short", year: "numeric" });
const INPUT_F = "h-[38px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";

export default function ComprasPage() {
  const [rows, setRows] = useState<Compra[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [borrador, setBorrador] = useState("");
  const [q, setQ] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [proveedor, setProveedor] = useState("");
  const [tipoPago, setTipoPago] = useState("");
  const [estado, setEstado] = useState("");
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [viendo, setViendo] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    apiFetch<{ proveedores: Proveedor[] }>("/api/proveedores").then((r) => setProveedores(r.proveedores)).catch(() => {});
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
    if (proveedor) sp.set("proveedor", proveedor);
    if (tipoPago) sp.set("tipo_pago", tipoPago);
    if (estado) sp.set("estado", estado);
    apiFetch<{ rows: Compra[]; total: number }>(`/api/compras?${sp}`)
      .then((r) => { if (!cancel) { setRows(r.rows); setTotal(r.total); } })
      .catch(() => { if (!cancel) { setRows([]); setTotal(0); } })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [pagina, q, desde, hasta, proveedor, tipoPago, estado, recarga]);

  const refrescar = useCallback(() => setRecarga((k) => k + 1), []);
  const hayFiltros = !!(q || desde || hasta || proveedor || tipoPago || estado);
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Operaciones · Compras</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Compras</h1>
          <p className="mt-1 text-sm text-slate-500">Las facturas de tus proveedores: cada una suma stock y actualiza los costos.</p>
        </div>
        <Link href="/compras/nueva" className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95" style={{ backgroundColor: TEAL }}>
          <Plus className="h-4 w-4" /> Nueva compra
        </Link>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={borrador} onChange={(e) => setBorrador(e.target.value)} placeholder="Buscar por número, proveedor, factura o producto…"
              className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]" />
          </div>
          <input type="date" value={desde} onChange={(e) => { setDesde(e.target.value); setPagina(1); }} aria-label="Desde" className={INPUT_F} />
          <input type="date" value={hasta} onChange={(e) => { setHasta(e.target.value); setPagina(1); }} aria-label="Hasta" className={INPUT_F} />
          <Select value={proveedor} onChange={(v) => { setProveedor(v); setPagina(1); }} minWidth={180}
            options={[["", "Todos los proveedores"], ...proveedores.map((p): [string, string] => [p.id, nombreProveedor(p)])]} />
          <Select value={tipoPago} onChange={(v) => { setTipoPago(v); setPagina(1); }} minWidth={140} options={[["", "Contado y crédito"], ["contado", "Contado"], ["credito", "Crédito"]]} />
          <Select value={estado} onChange={(v) => { setEstado(v); setPagina(1); }} minWidth={140} options={[["", "Todas"], ["registrada", "Registradas"], ["anulada", "Anuladas"]]} />
          {hayFiltros ? (
            <button onClick={() => { setBorrador(""); setQ(""); setDesde(""); setHasta(""); setProveedor(""); setTipoPago(""); setEstado(""); setPagina(1); }} className="text-xs text-slate-400 underline-offset-2 hover:text-slate-700 hover:underline">Limpiar</button>
          ) : null}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b-2 text-[11px] font-bold uppercase tracking-wider" style={{ borderColor: `${TEAL}26`, backgroundColor: `${TEAL}0d`, color: TEAL }}>
                <th className="px-5 py-3">Número</th>
                <th className="px-3 py-3">Fecha</th>
                <th className="px-3 py-3">Proveedor</th>
                <th className="px-3 py-3">Factura</th>
                <th className="px-3 py-3 text-center">Productos</th>
                <th className="px-3 py-3">Condición</th>
                <th className="px-5 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando && rows.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-400">Cargando…</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <ShoppingCart className="mx-auto h-8 w-8 text-slate-300" />
                    <p className="mt-3 text-sm font-medium text-slate-700">{hayFiltros ? "Ninguna compra coincide con los filtros" : "Todavía no cargaste compras"}</p>
                    {!hayFiltros ? (
                      <Link href="/compras/nueva" className="mt-4 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: TEAL }}>
                        <Plus className="h-4 w-4" /> Cargar la primera
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ) : (
                rows.map((c) => {
                  const anulada = c.estado === "anulada";
                  return (
                    <tr key={c.id} onClick={() => setViendo(c.id)} className={`cursor-pointer transition-colors hover:bg-[var(--brand-50)] ${cargando ? "opacity-60" : ""}`}>
                      <td className="px-5 py-3">
                        <p className={`font-mono text-xs font-semibold ${anulada ? "text-slate-400 line-through" : "text-slate-800"}`}>{c.numero_control}</p>
                        {anulada ? <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">Anulada</span> : null}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600">{fecha(c.fecha)}</td>
                      <td className="px-3 py-3 font-semibold text-slate-800">{c.proveedor_nombre}</td>
                      <td className="px-3 py-3 font-mono text-xs text-slate-600">{c.numero_factura}</td>
                      <td className="px-3 py-3 text-center text-slate-600">{c.cantidad_items}</td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.tipo_pago === "credito" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                          {c.tipo_pago === "credito" ? "Crédito" : "Contado"}
                        </span>
                        {c.tipo_pago === "credito" && c.vencimiento ? <p className="mt-0.5 text-[11px] text-slate-400">vence {fechaDia(c.vencimiento)}</p> : null}
                      </td>
                      <td className={`whitespace-nowrap px-5 py-3 text-right font-bold tabular-nums ${anulada ? "text-slate-400 line-through" : "text-slate-900"}`}>{gs(c.total)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {total > POR_PAGINA ? (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            <span>Página {pagina} de {totalPaginas} · {total} compras</span>
            <div className="flex gap-2">
              <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Anterior</button>
              <button disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Siguiente</button>
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
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  return (
    <Drawer
      titulo={c ? `Compra ${c.numero_control}` : "Compra"}
      subtitulo={c ? `${c.proveedor_nombre} · factura ${c.numero_factura}` : undefined}
      onClose={onClose}
      footer={c && !anulada ? (
        anulando ? (
          <>
            <button onClick={() => setAnulando(false)} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Volver</button>
            <button onClick={anular} disabled={busy || !motivo.trim()} className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-40">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Confirmar anulación
            </button>
          </>
        ) : (
          <button onClick={() => setAnulando(true)} className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50">
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
            <Dato l="Condición" v={c.tipo_pago === "credito" ? `Crédito${c.plazo_dias ? ` ${c.plazo_dias} días` : ""}${c.vencimiento ? ` · vence ${fechaDia(c.vencimiento)}` : ""}` : "Contado"} />
            {c.moneda === "USD" ? <Dato l="Moneda" v={`Dólares · 1 US$ = ${gs(c.tipo_cambio)}`} /> : null}
          </dl>

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Productos</p>
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
              {(c.items ?? []).map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{i.producto_nombre}</p>
                    <p className="text-[11px] text-slate-500">
                      {Number(i.cantidad).toLocaleString("es-PY")} × {c.moneda === "USD" ? `US$ ${Number(i.costo_unitario_original).toLocaleString("es-PY")}` : gs(i.costo_unitario)}
                      {i.precio_venta_nuevo ? ` · precio de venta → ${gs(i.precio_venta_nuevo)}` : ""}
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

          {anulando ? (
            <div className="rounded-xl border border-rose-200 p-4">
              <p className="text-sm font-semibold text-slate-800">¿Por qué la anulás?</p>
              <p className="mt-0.5 text-xs text-slate-500">Se descuenta del stock lo que entró con esta compra y se recalcula el costo promedio. Queda registrado en el kardex.</p>
              <textarea autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500} placeholder="Ej: se cargó con el proveedor equivocado"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-rose-400 focus:ring-4 focus:ring-rose-100" />
            </div>
          ) : null}
          {error ? (
            <div className="flex items-start justify-between gap-2 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">
              <span>{error}</span><button onClick={() => setError(null)} aria-label="Cerrar"><X className="h-3.5 w-3.5" /></button>
            </div>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}

function Dato({ l, v, mono }: { l: string; v: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] text-slate-500">{l}</dt>
      <dd className={`text-sm font-medium text-slate-800 ${mono ? "font-mono" : ""}`}>{v}</dd>
    </div>
  );
}
