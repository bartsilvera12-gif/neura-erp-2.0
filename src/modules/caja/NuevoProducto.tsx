"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { subirImagenProducto } from "@/modules/caja/upload-imagen";
import type { Producto, TipoIva } from "@/modules/caja/lib";

const BRAND = clienteConfig.color;
const INPUT =
  "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
const IVAS: TipoIva[] = ["10%", "5%", "EXENTA"];

/** Alta rápida de producto. Se usa desde la caja (catálogo). Precio e IVA van al catálogo. */
export function NuevoProducto({ onClose, onCreado }: { onClose: () => void; onCreado: (p: Producto) => void }) {
  const [nombre, setNombre] = useState("");
  const [sku, setSku] = useState("");
  const [precio, setPrecio] = useState("");
  const [stock, setStock] = useState("");
  const [unidad, setUnidad] = useState("Unidad");
  const [tipoIva, setTipoIva] = useState<TipoIva>("10%");
  const [imagenUrl, setImagenUrl] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const puede = nombre.trim() !== "" && sku.trim() !== "";

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
    try {
      const p = await apiFetch<Producto>("/api/productos", {
        method: "POST",
        body: JSON.stringify({
          nombre: nombre.trim(),
          sku: sku.trim(),
          precio_venta: Number(precio) || 0,
          stock_actual: Number(stock) || 0,
          unidad_medida: unidad.trim() || "Unidad",
          tipo_iva: tipoIva,
          controla_stock: true,
          imagen_url: imagenUrl ?? undefined,
        }),
      });
      onCreado(p);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal titulo="Nuevo producto" onClose={onClose}>
      <form onSubmit={guardar} className="space-y-4">
        <div className="flex items-center gap-4">
          <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-200 text-slate-400 transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
          >
            {subiendo ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : imagenUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imagenUrl} alt="" className="h-full w-full object-cover" />
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

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Nombre *</span>
          <input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} className={INPUT} placeholder="Ej. Coca-Cola 2L" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">SKU *</span>
            <input value={sku} onChange={(e) => setSku(e.target.value)} className={INPUT} placeholder="COCA2L" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Unidad</span>
            <input value={unidad} onChange={(e) => setUnidad(e.target.value)} className={INPUT} placeholder="Unidad" />
          </label>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="col-span-1 block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Precio Gs.</span>
            <input inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value.replace(/\D/g, ""))} className={`${INPUT} text-right tabular-nums`} placeholder="0" />
          </label>
          <label className="col-span-1 block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Stock</span>
            <input inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value.replace(/\D/g, ""))} className={`${INPUT} text-right tabular-nums`} placeholder="0" />
          </label>
          <label className="col-span-1 block">
            <span className="mb-1 block text-xs font-medium text-slate-600">IVA</span>
            <Select value={tipoIva} onChange={(v) => setTipoIva(v as TipoIva)} block options={IVAS.map((i) => [i, i])} />
          </label>
        </div>

        {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy || subiendo || !puede}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-40"
            style={{ backgroundColor: BRAND }}
          >
            {busy ? "Guardando…" : "Crear producto"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
