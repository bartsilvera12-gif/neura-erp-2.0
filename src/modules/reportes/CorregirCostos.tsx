"use client";

/**
 * Modal "Corregir costos" del reporte de ventas: lista los productos vendidos sin costo,
 * deja cargar el costo de cada uno y, opcionalmente, completar con ese costo las ventas
 * pasadas que quedaron en 0 (así la ganancia del reporte pasa a ser real).
 */
import { useEffect, useState } from "react";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { Loader2, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { traerProductosLote } from "@/modules/inventario/lote";
import { clienteConfig } from "@/cliente.config";
import MontoInput from "@/components/ui/MontoInput";

const TEAL = clienteConfig.color;
const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;

type Item = { producto_id: string; nombre: string; sku: string | null; monto: number; costoActual: number; costo: number };

export function CorregirCostos({
  productos,
  onClose,
  onListo,
}: {
  productos: { producto_id: string | null; nombre: string; sku: string | null; monto: number }[];
  onClose: () => void;
  onListo: (msg: string) => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [completar, setCompletar] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Costo actual de cada producto (puede que ya lo tenga y solo falten las ventas viejas).
  useEffect(() => {
    const conId = productos.filter((p): p is typeof p & { producto_id: string } => !!p.producto_id);
    // Todos en un solo request (no uno por producto); si falla, quedan en 0 como antes.
    type Costo = { id: string; costo_promedio: number | null };
    traerProductosLote<Costo>(conId.map((p) => p.producto_id))
      .then((r) => r.productos)
      .catch(() => new Map<string, Costo>())
      .then((porId) =>
        setItems(conId.map((p) => {
          const c = Number(porId.get(p.producto_id)?.costo_promedio) || 0;
          return { producto_id: p.producto_id, nombre: p.nombre, sku: p.sku, monto: p.monto, costoActual: c, costo: c };
        })),
      );
  }, [productos]);

  const conCosto = items?.filter((i) => i.costo > 0).length ?? 0;

  async function guardar() {
    if (!items) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ productos_actualizados: number; lineas_completadas: number }>("/api/reportes/ventas/costos", {
        method: "POST",
        body: JSON.stringify({
          costos: items.map((i) => ({ producto_id: i.producto_id, costo: i.costo })),
          completar_ventas: completar,
        }),
      });
      onListo(
        `Costo cargado en ${r.productos_actualizados} producto(s)` +
          (completar ? ` y completado en ${r.lineas_completadas} línea(s) de ventas pasadas.` : "."),
      );
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <CapaModal onClose={busy ? undefined : onClose} z="z-[120]" fondo="bg-slate-900/40 backdrop-blur-sm">
        <div className={`flex ${ALTO_MAX_MODAL} w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5`} onClick={(e) => e.stopPropagation()} style={{ animation: "rb-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5 sm:px-6 sm:py-4">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-slate-900">Corregir costos</h3>
              <p className="mt-0.5 text-xs text-slate-500">Cargá el costo de cada producto. Es lo que se le resta a la venta para calcular la ganancia.</p>
            </div>
            <button onClick={onClose} disabled={busy} aria-label="Cerrar" className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 max-sm:-mr-2 max-sm:-mt-1 max-sm:h-11 max-sm:w-11"><X className="h-5 w-5" /></button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4">
            {!items ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
            ) : (
              // Grilla (no <table>): en celular el nombre va a todo el ancho y debajo "Vendido" + el costo.
              <div className="text-sm">
                <div className="hidden grid-cols-[minmax(0,1fr)_auto_10rem] gap-3 pb-2 text-xs font-semibold text-slate-500 sm:grid">
                  <span>Producto</span><span className="text-right">Vendido</span><span className="text-right">Costo unitario</span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {items.map((it, i) => (
                    <li key={it.producto_id} className="grid grid-cols-[minmax(0,1fr)_9.5rem] items-center gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_10rem]">
                      <div className="col-span-2 min-w-0 sm:col-span-1">
                        <p className="font-medium text-slate-800 [overflow-wrap:anywhere]">{it.nombre}</p>
                        <p className="text-[11px] text-slate-400">
                          <span className="font-mono">{it.sku}</span>
                          {it.costoActual > 0 ? <span className="ml-1.5 text-emerald-600">· ya tiene costo, faltan ventas viejas</span> : null}
                        </p>
                      </div>
                      <p className="tabular-nums text-slate-500 sm:text-right"><span className="text-xs text-slate-400 sm:hidden">Vendido </span>{gs(it.monto)}</p>
                      <MontoInput
                        value={it.costo}
                        onChange={(v) => setItems((xs) => xs!.map((x, j) => (j === i ? { ...x, costo: v } : x)))}
                        placeholder="0"
                        aria-label={`Costo de ${it.nombre}`}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-right text-sm tabular-nums outline-none focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)] max-sm:h-11"
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="shrink-0 space-y-3 border-t border-slate-100 px-4 py-3.5 sm:px-6 sm:py-4">
            <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={completar} onChange={(e) => setCompletar(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
              <span>
                Completar con este costo las <strong>ventas pasadas</strong> que quedaron sin costo
                <span className="block text-xs text-slate-400">No cambia precios, totales, stock ni caja: solo corrige la ganancia del reporte.</span>
              </span>
            </label>
            {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-slate-400">{conCosto} de {items?.length ?? 0} con costo</span>
              <div className="flex gap-2 max-sm:w-full">
                <button onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 max-sm:min-h-11 max-sm:flex-1">Cancelar</button>
                <button onClick={guardar} disabled={busy || !items || conCosto === 0} className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50 max-sm:min-h-11 max-sm:flex-1" style={{ backgroundColor: TEAL }}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {busy ? "Guardando…" : "Guardar costos"}
                </button>
              </div>
            </div>
          </div>
        </div>
    </CapaModal>
  );
}
