"use client";

/**
 * /compras/ordenes/nueva — pedido al proveedor (orden de compra). Sin factura y sin
 * mover stock: proveedor (propone su condición y moneda), fecha de entrega esperada,
 * productos con cantidad y costo estimado (se propone el de la última compra).
 * Con ?editar=ID edita una orden que todavía no recibió nada.
 */
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Download, Loader2, Package, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { clienteConfig } from "@/cliente.config";
import MontoInput from "@/components/ui/MontoInput";
import { SelectorProveedor } from "@/modules/proveedores/SelectorProveedor";
import type { HistorialCostosData } from "@/modules/inventario/HistorialCostos";
import { traerProductosLote } from "@/modules/inventario/lote";
import type { ProductoInventario } from "@/modules/inventario/tipos";
import type { ProveedorMin } from "@/modules/proveedores/tipos";
import { cargarProveedores } from "@/modules/proveedores/cache";
import type { OrdenCompra } from "@/modules/compras/ordenes";
import { BuscadorProductos, ET, Fila, gs, INPUT, Segmentado, Tarjeta, usd } from "@/modules/compras/partes";

const TEAL = clienteConfig.color;

type Linea = { key: string; prod: ProductoInventario; cantidad: string; costo: number; ultima: number | null };

export default function NuevaOrdenPage() {
  return (
    <Suspense>
      <NuevaOrden />
    </Suspense>
  );
}

function NuevaOrden() {
  const editarId = useSearchParams().get("editar");
  const [proveedores, setProveedores] = useState<ProveedorMin[]>([]);
  const [proveedorId, setProveedorId] = useState<string | null>(null);
  const [entrega, setEntrega] = useState("");
  const [tipoPago, setTipoPago] = useState<"contado" | "credito">("contado");
  const [plazo, setPlazo] = useState("30");
  const [moneda, setMoneda] = useState<"GS" | "USD">("GS");
  const [cambio, setCambio] = useState(0);
  const [observacion, setObservacion] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecha, setHecha] = useState<{ id: string; numero: string } | null>(null);
  const [numeroEditando, setNumeroEditando] = useState<string | null>(null);

  useEffect(() => {
    // Misma lista (y misma llamada) que usa el SelectorProveedor.
    void cargarProveedores().then(setProveedores);
  }, []);

  // Editar: carga la orden.
  useEffect(() => {
    if (!editarId) return;
    let vivo = true;
    (async () => {
      try {
        const o = await apiFetch<OrdenCompra>(`/api/ordenes-compra/${editarId}`);
        // Todos los productos de la orden en un solo request (no uno por producto).
        const { productos } = await traerProductosLote<ProductoInventario>((o.items ?? []).map((i) => i.producto_id));
        const prods = (o.items ?? []).map((i) => productos.get(i.producto_id) ?? null);
        if (!vivo) return;
        setNumeroEditando(o.numero_oc);
        setProveedorId(o.proveedor_id);
        setEntrega(o.fecha_entrega ?? "");
        setTipoPago(o.tipo_pago);
        if (o.plazo_dias) setPlazo(String(o.plazo_dias));
        setMoneda(o.moneda);
        if (o.moneda === "USD") setCambio(Number(o.tipo_cambio) || 0);
        setObservacion(o.observacion ?? "");
        setLineas((o.items ?? []).flatMap((i, n) => (prods[n] ? [{ key: i.id, prod: prods[n]!, cantidad: String(Number(i.cantidad)), costo: Number(i.costo_unitario_original) || 0, ultima: null }] : [])));
      } catch (e) {
        if (vivo) setError((e as Error).message);
      }
    })();
    return () => { vivo = false; };
  }, [editarId]);

  function elegirProveedor(id: string | null) {
    setProveedorId(id);
    const p = proveedores.find((x) => x.id === id);
    if (!p) {
      if (id) void cargarProveedores().then(setProveedores);
      return;
    }
    setTipoPago(p.condicion_pago);
    if (p.plazo_pago_dias) setPlazo(String(p.plazo_pago_dias));
    setMoneda(p.moneda);
  }

  async function agregar(prod: ProductoInventario) {
    const ex = lineas.find((l) => l.prod.id === prod.id);
    if (ex) {
      setLineas((ls) => ls.map((l) => (l.key === ex.key ? { ...l, cantidad: String((Number(l.cantidad.replace(",", ".")) || 0) + 1) } : l)));
      return;
    }
    const key = `${prod.id}-${Date.now()}`;
    setLineas((ls) => [...ls, { key, prod, cantidad: "1", costo: 0, ultima: null }]);
    try {
      const h = await apiFetch<HistorialCostosData>(`/api/productos/${prod.id}/costos`);
      const u = h.compras[0] ? Number(h.compras[0].costo) : null;
      const base = u ?? (Number(prod.costo_promedio) || 0);
      setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ultima: u, costo: l.costo || (moneda === "GS" ? Math.round(base) : 0) } : l)));
    } catch {
      /* sin historial */
    }
  }

  const factor = moneda === "USD" ? cambio : 1;
  const calc = useMemo(() => {
    let total = 0, unidades = 0, totalOrig = 0;
    for (const l of lineas) {
      const c = Number(l.cantidad.replace(",", ".")) || 0;
      total += Math.round(c * l.costo * factor);
      totalOrig += c * l.costo;
      unidades += c;
    }
    return { total, unidades, totalOrig };
  }, [lineas, factor]);

  const faltan = [
    !proveedorId && "el proveedor",
    moneda === "USD" && !(cambio > 0) && "la cotización del dólar",
    lineas.length === 0 && "al menos un producto",
    lineas.some((l) => !(Number(l.cantidad.replace(",", ".")) > 0)) && "la cantidad de algún producto",
  ].filter(Boolean) as string[];

  async function guardar() {
    if (faltan.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = JSON.stringify({
        proveedor_id: proveedorId,
        fecha_entrega: entrega || null,
        tipo_pago: tipoPago,
        plazo_dias: tipoPago === "credito" ? Number(plazo) || null : null,
        moneda,
        tipo_cambio: moneda === "USD" ? cambio : null,
        observacion: observacion.trim() || null,
        items: lineas.map((l) => ({ producto_id: l.prod.id, cantidad: Number(l.cantidad.replace(",", ".")), costo_unitario: l.costo || 0 })),
      });
      const r = editarId
        ? await apiFetch<{ id: string; numero_oc: string }>(`/api/ordenes-compra/${editarId}`, { method: "PATCH", body })
        : await apiFetch<{ id: string; numero_oc: string }>("/api/ordenes-compra", { method: "POST", body });
      setHecha({ id: r.id, numero: r.numero_oc });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (hecha) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
        <h1 className="mt-4 text-2xl font-semibold text-slate-900">{editarId ? "Orden actualizada" : "Orden de compra creada"}</h1>
        <p className="mt-1 text-sm text-slate-500">
          <strong className="font-semibold text-slate-700">{hecha.numero}</strong>. Descargá el PDF para mandárselo al proveedor.
          Cuando llegue la mercadería, entrá a la orden y tocá <strong className="font-semibold text-slate-700">Recibir mercadería</strong>.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button onClick={() => descargarArchivo(`/api/ordenes-compra/${hecha.id}/pdf`, `orden-compra-${hecha.numero}.pdf`).catch(() => {})}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
            <Download className="h-4 w-4" /> Descargar PDF
          </button>
          <Link href="/compras/ordenes" className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: TEAL }}>Ver órdenes de compra</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <header className="flex items-start gap-3">
        <Link href="/compras/ordenes" aria-label="Volver a órdenes de compra" className="mt-1 flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Operaciones · Compras</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{numeroEditando ? `Editar ${numeroEditando}` : "Nueva orden de compra"}</h1>
          <p className="mt-1 text-sm text-slate-500">El pedido al proveedor. No mueve el stock: eso pasa cuando recibís la mercadería.</p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Tarjeta numero={1} titulo="Proveedor y condiciones">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <span className={ET}>Proveedor *</span>
                <SelectorProveedor value={proveedorId} onChange={(id) => elegirProveedor(id)} />
              </div>
              <label className="block">
                <span className={ET}>Entrega esperada <span className="font-normal text-slate-400">(opcional)</span></span>
                <input type="date" value={entrega} onChange={(e) => setEntrega(e.target.value)} className={INPUT} />
              </label>
              <div>
                <span className={ET}>Condición</span>
                <Segmentado valor={tipoPago} onChange={(v) => setTipoPago(v as "contado" | "credito")} opciones={[["contado", "Contado"], ["credito", "Crédito"]]} />
                {tipoPago === "credito" ? (
                  <div className="mt-2 flex items-center gap-2">
                    <input inputMode="numeric" value={plazo} onChange={(e) => setPlazo(e.target.value.replace(/\D/g, "").slice(0, 4))} className={`${INPUT} w-20 py-2 text-right tabular-nums`} />
                    <span className="text-sm text-slate-500">días</span>
                  </div>
                ) : null}
              </div>
              <div className="sm:col-span-2 sm:max-w-sm">
                <span className={ET}>Moneda</span>
                <Segmentado valor={moneda} onChange={(v) => setMoneda(v as "GS" | "USD")} opciones={[["GS", "Guaraníes"], ["USD", "Dólares"]]} />
                {moneda === "USD" ? (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-sm text-slate-500">1 US$ =</span>
                    <MontoInput value={cambio} onChange={setCambio} decimals={false} placeholder="7.300" className={`${INPUT} w-28 py-2 text-right tabular-nums`} />
                    <span className="text-sm text-slate-500">Gs.</span>
                  </div>
                ) : null}
              </div>
            </div>
          </Tarjeta>

          <Tarjeta numero={2} titulo="Productos a pedir" extra={lineas.length ? <span className="text-xs text-slate-500">{lineas.length} {lineas.length === 1 ? "producto" : "productos"}</span> : null}>
            <BuscadorProductos onElegir={agregar} />
            {lineas.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
                <Package className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">Buscá los productos que le vas a pedir.</p>
                <Link href="/reportes/stock-minimo" className="mt-1 inline-block text-xs font-semibold text-[var(--brand)] hover:underline">Ver qué está por debajo del stock mínimo</Link>
              </div>
            ) : (
              <ul className="mt-4 space-y-2">
                {lineas.map((l) => {
                  const c = Number(l.cantidad.replace(",", ".")) || 0;
                  return (
                    <li key={l.key} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{l.prod.nombre}</p>
                        <p className="text-[11px] text-slate-500">
                          <span className="font-mono">{l.prod.sku}</span> · stock {Number(l.prod.stock_actual).toLocaleString("es-PY")}
                          {Number(l.prod.stock_minimo) > 0 ? ` · mínimo ${Number(l.prod.stock_minimo).toLocaleString("es-PY")}` : ""}
                          {l.ultima ? ` · última compra ${gs(l.ultima)}` : ""}
                        </p>
                      </div>
                      <label className="w-24">
                        <span className={ET}>Cantidad</span>
                        <input inputMode="decimal" value={l.cantidad} onChange={(e) => setLineas((ls) => ls.map((x) => (x.key === l.key ? { ...x, cantidad: e.target.value.replace(/[^\d.,]/g, "") } : x)))} className={`${INPUT} py-2 text-right tabular-nums`} />
                      </label>
                      <label className="w-32">
                        <span className={ET}>Costo estimado {moneda === "USD" ? "(US$)" : ""}</span>
                        <MontoInput value={l.costo} onChange={(v) => setLineas((ls) => ls.map((x) => (x.key === l.key ? { ...x, costo: v } : x)))} decimals={moneda === "USD"} placeholder="0" className={`${INPUT} py-2 text-right tabular-nums`} />
                      </label>
                      <p className="w-28 text-right text-sm font-bold tabular-nums text-slate-900">{gs(Math.round(c * l.costo * factor))}</p>
                      <button onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Quitar ${l.prod.nombre}`} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Tarjeta>
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Resumen del pedido</p>
            <dl className="mt-3 space-y-1.5 text-sm">
              <Fila l="Productos" v={String(lineas.length)} />
              <Fila l="Unidades" v={calc.unidades.toLocaleString("es-PY", { maximumFractionDigits: 3 })} />
            </dl>
            <div className="mt-3 flex items-baseline justify-between border-t border-slate-100 pt-3">
              <span className="text-sm font-semibold text-slate-800">Total estimado</span>
              <span className="text-2xl font-extrabold tabular-nums text-slate-900">{gs(calc.total)}</span>
            </div>
            {moneda === "USD" ? <p className="text-right text-xs text-slate-500">{usd(calc.totalOrig)}</p> : null}
            <label className="mt-4 block">
              <span className={ET}>Observación para el proveedor <span className="font-normal text-slate-400">(opcional)</span></span>
              <textarea value={observacion} onChange={(e) => setObservacion(e.target.value)} rows={3} maxLength={2000} placeholder="Ej: entregar por la mañana, en el depósito de atrás" className={INPUT} />
            </label>
            {faltan.length ? <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Falta: {faltan.join(", ")}.</p> : null}
            {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
            <button onClick={guardar} disabled={!!faltan.length || busy}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-40" style={{ backgroundColor: TEAL }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {busy ? "Guardando…" : editarId ? "Guardar cambios" : "Crear orden de compra"}
            </button>
            <p className="mt-2 text-center text-[11px] text-slate-400">Después podés descargar el PDF para mandárselo.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
