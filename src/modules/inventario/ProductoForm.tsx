"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { History, ImagePlus, Loader2, Wand2, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { Drawer } from "@/components/Drawer";
import { Select } from "@/components/Select";
import MontoInput from "@/components/ui/MontoInput";
import { subirImagenProducto } from "@/modules/caja/upload-imagen";
import type { TipoIva } from "@/modules/caja/lib";
import type { ProductoInventario } from "@/modules/inventario/tipos";
import { partesCategoria, type Categoria } from "@/modules/inventario/categorias";

const BRAND = clienteConfig.color;
const INPUT =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)] disabled:bg-slate-50 disabled:text-slate-400";
const NUM = `${INPUT} text-right tabular-nums`;
const ET = "mb-1 block text-xs font-medium text-slate-600";
const IVAS: [TipoIva, string][] = [["10%", "10%"], ["5%", "5%"], ["EXENTA", "Exenta"]];
const UNIDADES = ["Unidad", "Kilogramo", "Gramo", "Litro", "Metro", "Caja", "Paquete", "Docena"];
const gs = (v: number) => `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`;

/**
 * Alta y edición de producto (inventario), en el panel lateral, ordenado en bloques:
 * Producto (foto + identificación) · Precios (con margen y precio final en vivo) · Stock.
 * Si `producto` viene, edita; si no, crea. Un producto inactivo se abre en solo lectura
 * (como Ferretería): primero hay que reactivarlo.
 */
export function ProductoForm({
  producto,
  categorias = [],
  onClose,
  onSaved,
}: {
  producto?: ProductoInventario | null;
  categorias?: Categoria[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editando = !!producto;
  const soloLectura = producto?.activo === false;
  const [f, setF] = useState({
    nombre: producto?.nombre ?? "",
    sku: producto?.sku ?? "",
    codigo_barras: producto?.codigo_barras ?? "",
    categoria_principal_id: producto?.categoria_principal_id ?? "",
    unidad_medida: producto?.unidad_medida ?? "Unidad",
    tipo_iva: (producto?.tipo_iva ?? "10%") as TipoIva,
    costo_promedio: Number(producto?.costo_promedio ?? 0),
    precio_venta: Number(producto?.precio_venta ?? 0),
    precio_mayorista: Number(producto?.precio_mayorista ?? 0),
    precio_distribuidor: Number(producto?.precio_distribuidor ?? 0),
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
  const [generando, setGenerando] = useState<"" | "sku" | "barras">("");
  const fileRef = useRef<HTMLInputElement>(null);

  /** Botón "Generar": SKU armado desde el nombre (COC-COL-2L) o un EAN-13 interno. */
  async function generar(tipo: "sku" | "barras") {
    setError(null);
    if (tipo === "sku" && !f.nombre.trim()) {
      setError("Escribí primero el nombre del producto: el SKU se arma a partir de él.");
      return;
    }
    setGenerando(tipo);
    try {
      const r = await apiFetch<{ codigo: string }>("/api/productos/generar-codigo", {
        method: "POST",
        body: JSON.stringify({ tipo, nombre: f.nombre.trim() }),
      });
      set(tipo === "sku" ? "sku" : "codigo_barras", r.codigo);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerando("");
    }
  }

  // Categoría → subcategoría: el producto guarda la hoja (la sub si se eligió, si no la categoría).
  const porId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);
  const cat = partesCategoria(f.categoria_principal_id, porId);
  const visible = (c: Categoria) => c.activo || c.id === cat.madre?.id || c.id === cat.sub?.id;
  const madres = categorias.filter((c) => !c.parent_id && visible(c));
  const subs = cat.madre ? categorias.filter((c) => c.parent_id === cat.madre!.id && visible(c)) : [];

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const num = (v: string) => (v === "" ? undefined : Number(v));
  const puede = !soloLectura && f.nombre.trim() !== "" && f.sku.trim() !== "";

  // Cálculos en vivo (IVA incluido en precio y costo, igual que el listado).
  const margen = f.precio_venta ? ((f.precio_venta - f.costo_promedio) / f.precio_venta) * 100 : null;
  const desc = Math.min(100, Math.max(0, Number(f.descuento_pct) || 0));
  const precioFinal = Math.round(f.precio_venta * (1 - desc / 100));
  const margenFinal = precioFinal ? ((precioFinal - f.costo_promedio) / precioFinal) * 100 : null;
  const stockCambio = editando && f.stock_actual !== "" && Number(f.stock_actual) !== Number(producto?.stock_actual ?? 0);

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
      codigo_barras: f.codigo_barras.trim() || null,
      categoria_principal_id: f.categoria_principal_id || null,
      unidad_medida: f.unidad_medida.trim() || "Unidad",
      tipo_iva: f.tipo_iva,
      costo_promedio: f.costo_promedio || 0,
      precio_venta: f.precio_venta || 0,
      precio_mayorista: f.precio_mayorista || null,
      precio_distribuidor: f.precio_distribuidor || null,
      descuento_pct: desc,
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
      titulo={soloLectura ? "Producto inactivo" : editando ? "Editar producto" : "Nuevo producto"}
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
      <form id="producto-form" onSubmit={guardar} className="space-y-6">
        {soloLectura ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Este producto está <strong>inactivo</strong> (solo lectura). Reactivalo desde el listado para poder editarlo.
          </p>
        ) : null}

        <fieldset disabled={soloLectura} className="space-y-6 disabled:opacity-70">
          {/* ── Producto ─────────────────────────────────────────────────── */}
          <Bloque titulo="Producto" extra={editando ? (
            <Link href={`/inventario/movimientos?producto=${producto!.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)] hover:underline">
              <History className="h-3.5 w-3.5" /> Ver movimientos
            </Link>
          ) : null}>
            <div className="flex gap-4">
              <div className="shrink-0 text-center">
                <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  title="Foto del producto (opcional · JPG/PNG hasta 5 MB)"
                  className="relative flex h-[104px] w-[104px] items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-200 bg-white text-slate-400 transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
                >
                  {subiendo ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : imagenUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imagenUrl} alt="" className="h-full w-full object-contain p-1" />
                  ) : (
                    <span className="flex flex-col items-center gap-1 text-[11px]">
                      <ImagePlus className="h-6 w-6" /> Foto
                    </span>
                  )}
                </button>
                {imagenUrl ? (
                  <button type="button" onClick={() => setImagenUrl(null)} className="mt-1 inline-flex items-center gap-1 text-[11px] text-rose-500 hover:underline">
                    <X className="h-3 w-3" /> Quitar
                  </button>
                ) : null}
              </div>
              <div className="grid min-w-0 flex-1 grid-cols-3 gap-3">
                <label className="col-span-3 block">
                  <span className={ET}>Nombre *</span>
                  <input autoFocus value={f.nombre} onChange={(e) => set("nombre", e.target.value)} className={INPUT} placeholder="Ej. Coca-Cola 2L" />
                </label>
                <div className="col-span-3">
                  <span className={ET}>SKU *</span>
                  <div className="flex gap-2">
                    <input value={f.sku} onChange={(e) => set("sku", e.target.value)} className={`${INPUT} font-mono`} placeholder="Escribilo o tocá Generar" aria-label="SKU" />
                    <BotonGenerar onClick={() => generar("sku")} cargando={generando === "sku"} />
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-3">
              <span className={ET}>Código de barras <span className="font-normal text-slate-400">(opcional)</span></span>
              <div className="flex gap-2">
                <input value={f.codigo_barras} onChange={(e) => set("codigo_barras", e.target.value)} className={`${INPUT} font-mono`} placeholder="Escaneá el código o tocá Generar" aria-label="Código de barras" />
                <BotonGenerar onClick={() => generar("barras")} cargando={generando === "barras"} />
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                {/^2\d{12}$/.test(f.codigo_barras)
                  ? "Código propio del local: se puede escanear e imprimir en etiquetas."
                  : "Si el producto no trae código, generá uno para imprimir etiquetas."}
              </p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block">
                <span className={ET}>Categoría</span>
                <Select
                  value={cat.madre?.id ?? ""}
                  onChange={(v) => set("categoria_principal_id", v)}
                  block
                  options={[["", "— Sin categoría —"], ...madres.map((c): [string, string] => [c.id, c.nombre])]}
                />
              </label>
              <label className="block">
                <span className={ET}>Subcategoría <span className="font-normal text-slate-400">(opcional)</span></span>
                <Select
                  value={cat.sub?.id ?? ""}
                  onChange={(v) => set("categoria_principal_id", v || cat.madre?.id || "")}
                  block
                  disabled={!cat.madre || subs.length === 0}
                  options={[[
                    "",
                    !cat.madre ? "Elegí primero la categoría" : subs.length === 0 ? "No tiene subcategorías" : "— Sin subcategoría —",
                  ], ...subs.map((c): [string, string] => [c.id, c.nombre])]}
                />
              </label>
            </div>
          </Bloque>

          {/* ── Precios ──────────────────────────────────────────────────── */}
          <Bloque titulo="Precios" extra={<span className="text-[11px] text-slate-400">IVA incluido</span>}>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={ET}>Costo promedio</span>
                <MontoInput decimals={false} value={f.costo_promedio} onChange={(v) => set("costo_promedio", v)} className={NUM} placeholder="0" />
              </label>
              <label className="block">
                <span className={ET}>Precio de venta</span>
                <MontoInput decimals={false} value={f.precio_venta} onChange={(v) => set("precio_venta", v)} className={NUM} placeholder="0" />
              </label>
            </div>
            {margen != null ? (
              <p className="mt-1.5 text-right text-xs text-slate-500">
                Ganancia por unidad <strong className="tabular-nums text-slate-700">{gs(f.precio_venta - f.costo_promedio)}</strong> ·{" "}
                <span className={`font-semibold ${margen >= 40 ? "text-emerald-600" : margen >= 20 ? "text-amber-600" : "text-red-600"}`}>margen {margen.toFixed(1)}%</span>
              </p>
            ) : null}

            <div className="mt-3">
              <span className={ET}>IVA</span>
              <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
                {IVAS.map(([v, l]) => (
                  <button key={v} type="button" onClick={() => set("tipo_iva", v)}
                    className="rounded-lg py-2 text-sm font-semibold transition"
                    style={f.tipo_iva === v ? { backgroundColor: "#fff", color: BRAND, boxShadow: "0 1px 2px rgba(15,23,42,.08)" } : { color: "#64748b" }}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block">
                <span className={ET}>Precio mayorista <span className="font-normal text-slate-400">(opcional)</span></span>
                <MontoInput decimals={false} value={f.precio_mayorista} onChange={(v) => set("precio_mayorista", v)} className={NUM} placeholder="—" />
              </label>
              <label className="block">
                <span className={ET}>Precio distribuidor <span className="font-normal text-slate-400">(opcional)</span></span>
                <MontoInput decimals={false} value={f.precio_distribuidor} onChange={(v) => set("precio_distribuidor", v)} className={NUM} placeholder="—" />
              </label>
            </div>

            <div className="mt-3 grid grid-cols-[120px_1fr] items-end gap-3">
              <label className="block">
                <span className={ET}>Descuento</span>
                <div className="relative">
                  <input inputMode="numeric" value={f.descuento_pct} onChange={(e) => set("descuento_pct", e.target.value.replace(/\D/g, "").slice(0, 3))} className={`${NUM} pr-8`} placeholder="0" />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">%</span>
                </div>
              </label>
              <p className="pb-2.5 text-xs text-slate-500">
                {desc > 0 ? (
                  <>
                    Se aplica solo en la caja. Precio final <strong className="tabular-nums text-slate-800">{gs(precioFinal)}</strong>
                    {margenFinal != null ? <span className={`ml-1 font-semibold ${margenFinal >= 20 ? "text-slate-600" : "text-red-600"}`}>· margen {margenFinal.toFixed(1)}%</span> : null}
                  </>
                ) : (
                  "Se aplica solo al vender en la caja."
                )}
              </p>
            </div>
          </Bloque>

          {/* ── Stock ────────────────────────────────────────────────────── */}
          <Bloque titulo="Stock">
            <div className="space-y-2">
              <Interruptor checked={f.controla_stock} onChange={(v) => set("controla_stock", v)} label="Controla stock" detalle="Descuenta al vender y avisa cuando queda por debajo del mínimo." />
              <Interruptor checked={f.es_vendible} onChange={(v) => set("es_vendible", v)} label="Se vende en caja" detalle="Aparece en el buscador de la caja." />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <label className="block">
                <span className={ET}>Stock actual</span>
                <input inputMode="numeric" disabled={!f.controla_stock} value={f.stock_actual} onChange={(e) => set("stock_actual", e.target.value.replace(/\D/g, ""))} className={NUM} placeholder="0" />
              </label>
              <label className="block">
                <span className={ET}>Stock mínimo</span>
                <input inputMode="numeric" disabled={!f.controla_stock} value={f.stock_minimo} onChange={(e) => set("stock_minimo", e.target.value.replace(/\D/g, ""))} className={NUM} placeholder="0" />
              </label>
              <label className="block">
                <span className={ET}>Unidad</span>
                <input list="unidades-medida" value={f.unidad_medida} onChange={(e) => set("unidad_medida", e.target.value)} className={INPUT} placeholder="Unidad" />
                <datalist id="unidades-medida">{UNIDADES.map((u) => <option key={u} value={u} />)}</datalist>
              </label>
            </div>
            {stockCambio ? (
              <p className="mt-2 rounded-lg bg-[var(--brand-50)] px-3 py-2 text-xs text-slate-600">
                El cambio de stock ({Number(producto?.stock_actual ?? 0).toLocaleString("es-PY")} → {Number(f.stock_actual).toLocaleString("es-PY")}) queda en el kardex como <strong>ajuste manual</strong>.
              </p>
            ) : null}
          </Bloque>
        </fieldset>
        {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
      </form>
    </Drawer>
  );
}

/** Botón "Generar" pegado al campo, con texto: el usuario ve qué hace sin adivinar. */
function BotonGenerar({ onClick, cargando }: { onClick: () => void; cargando: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={cargando}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--brand)] px-3.5 text-sm font-semibold text-[var(--brand)] transition hover:bg-[var(--brand-50)] disabled:opacity-60">
      {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
      Generar
    </button>
  );
}

function Bloque({ titulo, extra, children }: { titulo: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
        <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          <span className="block h-3.5 w-1 rounded-full" style={{ backgroundColor: BRAND }} />
          {titulo}
        </h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

function Interruptor({ checked, onChange, label, detalle }: { checked: boolean; onChange: (v: boolean) => void; label: string; detalle: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left transition hover:bg-slate-50">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="block text-[11px] text-slate-400">{detalle}</span>
      </span>
      <span className="relative h-5 w-9 shrink-0 rounded-full transition-colors" style={{ backgroundColor: checked ? BRAND : "#cbd5e1" }}>
        <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all" style={{ left: checked ? 18 : 2 }} />
      </span>
    </button>
  );
}
