"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { Drawer } from "@/components/Drawer";
import { Select } from "@/components/Select";
import { subirImagenProducto } from "@/modules/caja/upload-imagen";
import type { Producto, TipoIva } from "@/modules/caja/lib";

const BRAND = clienteConfig.color;
const INPUT =
  "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
const ET = "mb-1 block text-xs font-medium text-slate-600";
const IVAS: TipoIva[] = ["10%", "5%", "EXENTA"];

/** Alta y edición de producto (inventario). Si `producto` viene, edita; si no, crea. */
export function ProductoForm({
  producto,
  onClose,
  onSaved,
}: {
  producto?: Producto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editando = !!producto;
  const [f, setF] = useState({
    nombre: producto?.nombre ?? "",
    sku: producto?.sku ?? "",
    unidad_medida: producto?.unidad_medida ?? "Unidad",
    tipo_iva: (producto?.tipo_iva ?? "10%") as TipoIva,
    costo_promedio: String(producto?.costo_promedio ?? ""),
    precio_venta: String(producto?.precio_venta ?? ""),
    precio_mayorista: producto?.precio_mayorista != null ? String(producto.precio_mayorista) : "",
    precio_distribuidor: producto?.precio_distribuidor != null ? String(producto.precio_distribuidor) : "",
    descuento_pct: producto?.descuento_pct ? String(producto.descuento_pct) : "",
    stock_actual: String(producto?.stock_actual ?? ""),
    stock_minimo: String(producto?.stock_minimo ?? ""),
    controla_stock: producto?.controla_stock ?? true,
    es_vendible: producto?.es_vendible ?? true,
  });
  const [imagenUrl, setImagenUrl] = useState<string | null>(producto?.imagen_url ?? null);
  const [subiendo, setSubiendo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof typeof f, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const num = (v: string) => (v === "" ? undefined : Number(v));
  const puede = f.nombre.trim() !== "" && f.sku.trim() !== "";

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSubiendo(true);
    setError(null);
    try {
      setImagenUrl(await subirImagenProducto(file));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubiendo(false);
    }
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!puede) return;
    setBusy(true);
    setError(null);
    const body = {
      nombre: f.nombre.trim(),
      sku: f.sku.trim(),
      unidad_medida: f.unidad_medida.trim() || "Unidad",
      tipo_iva: f.tipo_iva,
      costo_promedio: num(f.costo_promedio) ?? 0,
      precio_venta: num(f.precio_venta) ?? 0,
      precio_mayorista: num(f.precio_mayorista) ?? null,
      precio_distribuidor: num(f.precio_distribuidor) ?? null,
      descuento_pct: num(f.descuento_pct) ?? 0,
      stock_actual: num(f.stock_actual) ?? 0,
      stock_minimo: num(f.stock_minimo) ?? 0,
      controla_stock: f.controla_stock,
      es_vendible: f.es_vendible,
      imagen_url: imagenUrl ?? undefined,
    };
    try {
      if (editando) {
        await apiFetch(`/api/productos/${producto!.id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await apiFetch("/api/productos", { method: "POST", body: JSON.stringify(body) });
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Drawer
      titulo={editando ? "Editar producto" : "Nuevo producto"}
      subtitulo={editando ? producto?.sku : "Cargá los datos del producto"}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button type="submit" form="producto-form" disabled={busy || subiendo || !puede} className="rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-40" style={{ backgroundColor: BRAND }}>
            {busy ? "Guardando…" : editando ? "Guardar cambios" : "Crear producto"}
          </button>
        </>
      }
    >
      <form id="producto-form" onSubmit={guardar} className="space-y-4">
        <div className="flex items-center gap-4">
          <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-200 bg-white text-slate-400 transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
          >
            {subiendo ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : imagenUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imagenUrl} alt="" className="h-full w-full object-contain p-1" />
            ) : (
              <ImagePlus className="h-6 w-6" />
            )}
          </button>
          <div className="text-xs text-slate-500">
            <p className="font-medium text-slate-700">Foto del producto</p>
            <p>Opcional · JPG/PNG hasta 5 MB.</p>
            {imagenUrl ? (
              <button type="button" onClick={() => setImagenUrl(null)} className="mt-1 inline-flex items-center gap-1 text-rose-500 hover:underline">
                <X className="h-3 w-3" /> Quitar
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          <label className="col-span-2 block sm:col-span-4">
            <span className={ET}>Nombre *</span>
            <input autoFocus value={f.nombre} onChange={(e) => set("nombre", e.target.value)} className={INPUT} placeholder="Ej. Coca-Cola 2L" />
          </label>
          <label className="col-span-1 block sm:col-span-2">
            <span className={ET}>SKU *</span>
            <input value={f.sku} onChange={(e) => set("sku", e.target.value)} className={INPUT} placeholder="COCA2L" />
          </label>

          <label className="col-span-1 block sm:col-span-2">
            <span className={ET}>Costo prom.</span>
            <input inputMode="numeric" value={f.costo_promedio} onChange={(e) => set("costo_promedio", e.target.value.replace(/\D/g, ""))} className={`${INPUT} text-right tabular-nums`} placeholder="0" />
          </label>
          <label className="col-span-1 block sm:col-span-2">
            <span className={ET}>Precio venta</span>
            <input inputMode="numeric" value={f.precio_venta} onChange={(e) => set("precio_venta", e.target.value.replace(/\D/g, ""))} className={`${INPUT} text-right tabular-nums`} placeholder="0" />
          </label>
          <label className="col-span-2 block sm:col-span-2">
            <span className={ET}>IVA</span>
            <Select value={f.tipo_iva} onChange={(v) => set("tipo_iva", v as TipoIva)} block options={IVAS.map((i) => [i, i])} />
          </label>

          <label className="col-span-1 block sm:col-span-3">
            <span className={ET}>Precio mayorista</span>
            <input inputMode="numeric" value={f.precio_mayorista} onChange={(e) => set("precio_mayorista", e.target.value.replace(/\D/g, ""))} className={`${INPUT} text-right tabular-nums`} placeholder="—" />
          </label>
          <label className="col-span-1 block sm:col-span-3">
            <span className={ET}>Precio distribuidor</span>
            <input inputMode="numeric" value={f.precio_distribuidor} onChange={(e) => set("precio_distribuidor", e.target.value.replace(/\D/g, ""))} className={`${INPUT} text-right tabular-nums`} placeholder="—" />
          </label>
          <label className="col-span-1 block sm:col-span-6">
            <span className={ET}>Descuento (%) <span className="font-normal text-slate-400">— se aplica solo al vender</span></span>
            <input inputMode="numeric" value={f.descuento_pct} onChange={(e) => set("descuento_pct", e.target.value.replace(/\D/g, "").slice(0, 3))} className={`${INPUT} text-right tabular-nums`} placeholder="0" />
          </label>

          <label className="col-span-1 block sm:col-span-2">
            <span className={ET}>Stock actual</span>
            <input inputMode="numeric" value={f.stock_actual} onChange={(e) => set("stock_actual", e.target.value.replace(/\D/g, ""))} className={`${INPUT} text-right tabular-nums`} placeholder="0" />
          </label>
          <label className="col-span-1 block sm:col-span-2">
            <span className={ET}>Stock mínimo</span>
            <input inputMode="numeric" value={f.stock_minimo} onChange={(e) => set("stock_minimo", e.target.value.replace(/\D/g, ""))} className={`${INPUT} text-right tabular-nums`} placeholder="0" />
          </label>
          <label className="col-span-1 block sm:col-span-2">
            <span className={ET}>Unidad</span>
            <input value={f.unidad_medida} onChange={(e) => set("unidad_medida", e.target.value)} className={INPUT} placeholder="Unidad" />
          </label>
        </div>

        <div className="flex flex-wrap gap-5 border-t border-slate-100 pt-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={f.controla_stock} onChange={(e) => set("controla_stock", e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Controla stock
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={f.es_vendible} onChange={(e) => set("es_vendible", e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Se vende en caja
          </label>
        </div>

        {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
      </form>
    </Drawer>
  );
}
