"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { History, ImagePlus, Loader2, Wand2, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { Drawer } from "@/components/Drawer";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { apiFetchCache } from "@/lib/api/cache-cliente";
import { Select } from "@/components/Select";
import MontoInput from "@/components/ui/MontoInput";
import { subirImagenProducto } from "@/modules/caja/upload-imagen";
import type { TipoIva } from "@/modules/caja/lib";
import type { ProductoInventario } from "@/modules/inventario/tipos";
import { partesCategoria, type Categoria } from "@/modules/inventario/categorias";
import { HistorialCostos } from "@/modules/inventario/HistorialCostos";
import { StockDepositosProducto } from "@/modules/inventario/LotesProducto";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { SelectorProveedor } from "@/modules/proveedores/SelectorProveedor";
import { opcionesDepositos, useDepositos } from "@/modules/inventario/depositos";
import { loteAutomatico } from "@/modules/inventario/vencimientos";
import { hoyPY } from "@/lib/fecha/paraguay";

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
// Constante: un [] nuevo en cada render dispararía el efecto que trae las categorías una y otra vez.
const SIN_CATEGORIAS: Categoria[] = [];

export function ProductoForm({
  producto,
  categorias = SIN_CATEGORIAS,
  onClose,
  onSaved,
  modal = false,
  inicial,
}: {
  producto?: ProductoInventario | null;
  categorias?: Categoria[];
  onClose: () => void;
  /** Al crear recibe el producto nuevo (para elegirlo enseguida, ej. en una compra). */
  onSaved: (creado?: { id: string }) => void;
  /** Modal centrado en vez del panel lateral (alta rápida desde Compras / Órdenes). */
  modal?: boolean;
  /** Datos con los que arranca un alta: lo que se buscó y el proveedor de la compra. */
  inicial?: { nombre?: string; proveedor_principal_id?: string | null };
}) {
  const editando = !!producto;
  const esAdmin = useUsuario()?.rol === "ADMIN";
  const soloLectura = producto?.activo === false;
  const [f, setF] = useState({
    nombre: producto?.nombre ?? inicial?.nombre ?? "",
    sku: producto?.sku ?? "",
    codigo_barras: producto?.codigo_barras ?? "",
    categoria_principal_id: producto?.categoria_principal_id ?? "",
    proveedor_principal_id: producto?.proveedor_principal_id ?? inicial?.proveedor_principal_id ?? null,
    unidad_medida: producto?.unidad_medida ?? "Unidad",
    tipo_iva: (producto?.tipo_iva ?? "10%") as TipoIva,
    costo_promedio: Number(producto?.costo_promedio ?? 0),
    precio_venta: Number(producto?.precio_venta ?? 0),
    precio_mayorista: Number(producto?.precio_mayorista ?? 0),
    precio_distribuidor: Number(producto?.precio_distribuidor ?? 0),
    descuento_pct: producto?.descuento_pct ? String(producto.descuento_pct) : "",
    stock_minimo: String(producto?.stock_minimo ?? ""),
    controla_stock: producto?.controla_stock ?? true,
    controla_lotes: producto?.controla_lotes ?? false,
    es_vendible: producto?.es_vendible ?? true,
  });
  // Alta: stock con el que arranca → ajuste de inventario inicial (AJ-) en un depósito.
  const deps = useDepositos();
  const [stockIni, setStockIni] = useState({ cantidad: "", deposito: "", lote: loteAutomatico(hoyPY()), vencimiento: "" });
  const depositoInicial = stockIni.deposito || deps.datos?.mi_deposito_id || "";
  const [imagenUrl, setImagenUrl] = useState<string | null>(producto?.imagen_url ?? null);
  const [subiendo, setSubiendo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generando, setGenerando] = useState<"" | "sku" | "barras">("");
  const fileRef = useRef<HTMLInputElement>(null);
  // Fuera de Inventario nadie le pasa las categorías: las trae (cacheadas).
  const [cats, setCats] = useState<Categoria[]>(categorias);
  useEffect(() => {
    if (categorias.length) { setCats(categorias); return; }
    apiFetchCache<{ categorias: Categoria[] }>("/api/inventario/categorias").then((r) => setCats(r.categorias ?? [])).catch(() => {});
  }, [categorias]);

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
  const porId = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const cat = partesCategoria(f.categoria_principal_id, porId);
  const visible = (c: Categoria) => c.activo || c.id === cat.madre?.id || c.id === cat.sub?.id;
  const madres = cats.filter((c) => !c.parent_id && visible(c));
  const subs = cat.madre ? cats.filter((c) => c.parent_id === cat.madre!.id && visible(c)) : [];

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const num = (v: string) => (v === "" ? undefined : Number(v));
  const cantInicial = !editando && f.controla_stock ? Number(stockIni.cantidad) || 0 : 0;
  const faltaInicial = cantInicial > 0 && (!depositoInicial || (f.controla_lotes && !stockIni.vencimiento));
  const puede = !soloLectura && f.nombre.trim() !== "" && f.sku.trim() !== "" && !faltaInicial;

  // Cálculos en vivo (IVA incluido en precio y costo, igual que el listado).
  const margen = f.precio_venta ? ((f.precio_venta - f.costo_promedio) / f.precio_venta) * 100 : null;
  const desc = Math.min(100, Math.max(0, Number(f.descuento_pct) || 0));
  const precioFinal = Math.round(f.precio_venta * (1 - desc / 100));
  const margenFinal = precioFinal ? ((precioFinal - f.costo_promedio) / precioFinal) * 100 : null;
  const conLotes = f.controla_stock && f.controla_lotes;

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
      proveedor_principal_id: f.proveedor_principal_id || null,
      unidad_medida: f.unidad_medida.trim() || "Unidad",
      tipo_iva: f.tipo_iva,
      costo_promedio: f.costo_promedio || 0,
      precio_venta: f.precio_venta || 0,
      precio_mayorista: f.precio_mayorista || null,
      precio_distribuidor: f.precio_distribuidor || null,
      descuento_pct: desc,
      // El stock no se edita: en el alta, el inicial queda como ajuste de inventario (AJ-).
      stock_inicial: cantInicial > 0
        ? { cantidad: cantInicial, deposito_id: depositoInicial, lote: conLotes ? stockIni.lote.trim() || null : null, vencimiento: conLotes ? stockIni.vencimiento : null }
        : undefined,
      stock_minimo: num(f.stock_minimo) ?? 0,
      controla_stock: f.controla_stock,
      controla_lotes: f.controla_stock && f.controla_lotes,
      es_vendible: f.es_vendible,
      imagen_url: imagenUrl ?? undefined,
    };
    try {
      if (editando) {
        await apiFetch(`/api/productos/${producto!.id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        const creado = await apiFetch<{ id: string }>("/api/productos", { method: "POST", body: JSON.stringify(body) });
        onSaved(creado);
        return;
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Contenedor modal={modal}
      titulo={soloLectura ? "Producto inactivo" : editando ? "Editar producto" : "Nuevo producto"}
      subtitulo={editando ? producto?.sku : "Cargá los datos del producto"}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 max-sm:min-h-11 max-sm:flex-1">Cancelar</button>
          <button type="submit" form="producto-form" disabled={busy || subiendo || !puede} className="rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-40 max-sm:min-h-11 max-sm:flex-[2] max-sm:px-4" style={{ backgroundColor: BRAND }}>
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
            {/* Celular: foto chica + nombre en una fila y el SKU debajo a todo el ancho; desde sm,
                foto a la izquierda con nombre y SKU apilados (como siempre). */}
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 sm:gap-x-4">
              <div className="shrink-0 text-center sm:row-span-2">
                <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  title="Foto del producto (opcional · JPG/PNG hasta 5 MB)"
                  aria-label={imagenUrl ? "Cambiar la foto del producto" : "Agregar foto del producto"}
                  className="relative flex h-[104px] w-[104px] items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-200 bg-white text-slate-400 transition hover:border-[var(--brand)] hover:text-[var(--brand)] max-sm:h-[84px] max-sm:w-[84px]"
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
                  <button type="button" onClick={() => setImagenUrl(null)} className="mt-1 inline-flex items-center gap-1 text-[11px] text-rose-500 hover:underline max-sm:min-h-9 max-sm:px-2">
                    <X className="h-3 w-3" /> Quitar
                  </button>
                ) : null}
              </div>
              <label className="block min-w-0 max-sm:self-center">
                <span className={ET}>Nombre *</span>
                <input autoFocus enterKeyHint="next" value={f.nombre} onChange={(e) => set("nombre", e.target.value)} className={INPUT} placeholder="Ej. Coca-Cola 2L" />
              </label>
              <div className="col-span-2 min-w-0 sm:col-span-1">
                <span className={ET}>SKU *</span>
                <div className="flex gap-2">
                  <input enterKeyHint="next" autoCapitalize="characters" autoComplete="off" value={f.sku} onChange={(e) => set("sku", e.target.value)} className={`${INPUT} min-w-0 font-mono`} placeholder="Escribilo o tocá Generar" aria-label="SKU" />
                  <BotonGenerar onClick={() => generar("sku")} cargando={generando === "sku"} />
                </div>
              </div>
            </div>
            <div className="mt-3">
              <span className={ET}>Código de barras <span className="font-normal text-slate-400">(opcional)</span></span>
              <div className="flex gap-2">
                <input enterKeyHint="next" autoComplete="off" value={f.codigo_barras} onChange={(e) => set("codigo_barras", e.target.value)} className={`${INPUT} min-w-0 font-mono`} placeholder="Escaneá el código o tocá Generar" aria-label="Código de barras" />
                <BotonGenerar onClick={() => generar("barras")} cargando={generando === "barras"} />
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                {/^2\d{12}$/.test(f.codigo_barras)
                  ? "Código propio del local: se puede escanear e imprimir en etiquetas."
                  : "Si el producto no trae código, generá uno para imprimir etiquetas."}
              </p>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={ET}>Categoría</span>
                <Select
                  value={cat.madre?.id ?? ""}
                  onChange={(v) => set("categoria_principal_id", v)}
                  block
                  etiqueta="Categoría"
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
                  etiqueta="Subcategoría"
                  options={[[
                    "",
                    !cat.madre ? "Elegí primero la categoría" : subs.length === 0 ? "No tiene subcategorías" : "— Sin subcategoría —",
                  ], ...subs.map((c): [string, string] => [c.id, c.nombre])]}
                />
              </label>
            </div>
            <div className="mt-3">
              <span className={ET}>Proveedor principal <span className="font-normal text-slate-400">(opcional)</span></span>
              <SelectorProveedor value={f.proveedor_principal_id} onChange={(id) => set("proveedor_principal_id", id)} />
              <p className="mt-1 text-[11px] text-slate-400">A quién se le compra normalmente. Se propone al cargar una compra.</p>
            </div>
          </Bloque>

          {/* ── Precios ──────────────────────────────────────────────────── */}
          <Bloque titulo="Precios" extra={<span className="text-[11px] text-slate-400">IVA incluido</span>}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    className="rounded-lg py-2 text-sm font-semibold transition max-sm:min-h-10"
                    style={f.tipo_iva === v ? { backgroundColor: "#fff", color: BRAND, boxShadow: "0 1px 2px rgba(15,23,42,.08)" } : { color: "#64748b" }}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                  <input inputMode="numeric" value={f.descuento_pct} onChange={(e) => set("descuento_pct", e.target.value.replace(/\D/g, "").slice(0, 3))} enterKeyHint="next" className={`${NUM} pr-8`} placeholder="0" />
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

          {/* ── Historial de costos (solo al editar) ───────────────────────── */}
          {editando && producto ? (
            <Bloque titulo="Historial de costos">
              <HistorialCostos productoId={producto.id} unidad={producto.unidad_medida ?? "Unidad"} />
            </Bloque>
          ) : null}

          {/* ── Stock ────────────────────────────────────────────────────── */}
          <Bloque titulo="Stock">
            <div className="space-y-2">
              <Interruptor checked={f.controla_stock} onChange={(v) => setF((p) => ({ ...p, controla_stock: v, controla_lotes: v ? p.controla_lotes : false }))} label="Controla stock" detalle="Descuenta al vender y avisa cuando queda por debajo del mínimo." />
              {f.controla_stock ? (
                <Interruptor checked={f.controla_lotes} onChange={(v) => set("controla_lotes", v)} label="Controla lotes y vencimiento"
                  detalle="Perecibles: cada compra pide lote y vencimiento; la caja vende primero el que vence antes y no vende los vencidos." />
              ) : null}
              <Interruptor checked={f.es_vendible} onChange={(v) => set("es_vendible", v)} label="Se vende en caja" detalle="Aparece en el buscador de la caja." />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={ET}>Stock mínimo</span>
                <input inputMode="numeric" enterKeyHint="next" disabled={!f.controla_stock} value={f.stock_minimo} onChange={(e) => set("stock_minimo", e.target.value.replace(/\D/g, ""))} className={NUM} placeholder="0" />
              </label>
              <label className="block">
                <span className={ET}>Unidad</span>
                <input list="unidades-medida" enterKeyHint="next" value={f.unidad_medida} onChange={(e) => set("unidad_medida", e.target.value)} className={INPUT} placeholder="Unidad" />
                <datalist id="unidades-medida">{UNIDADES.map((u) => <option key={u} value={u} />)}</datalist>
              </label>
            </div>

            {/* Alta: stock inicial documentado (ajuste de inventario inicial en un depósito). */}
            {!editando && f.controla_stock ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3">
                <p className="text-xs font-semibold text-slate-700">Stock inicial <span className="font-normal text-slate-400">(opcional)</span></p>
                <div className="mt-2 grid grid-cols-[110px_1fr] gap-3">
                  <label className="block">
                    <span className={ET}>Cantidad</span>
                    <input inputMode="decimal" enterKeyHint="next" value={stockIni.cantidad} onChange={(e) => setStockIni((p) => ({ ...p, cantidad: e.target.value.replace(/[^\d.]/g, "") }))} className={`${NUM} bg-white`} placeholder="0" />
                  </label>
                  <div>
                    <span className={ET}>Depósito</span>
                    <Select value={depositoInicial} onChange={(v) => setStockIni((p) => ({ ...p, deposito: v }))} block etiqueta="Depósito del stock inicial"
                      options={deps.datos ? opcionesDepositos(deps.datos) : [["", "Cargando depósitos…"]]} />
                  </div>
                </div>
                {conLotes && cantInicial > 0 ? (
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className={ET}>N° de lote <span className="font-normal text-slate-400">(editable)</span></span>
                      <input enterKeyHint="next" autoCapitalize="characters" autoComplete="off" value={stockIni.lote} onChange={(e) => setStockIni((p) => ({ ...p, lote: e.target.value.slice(0, 40) }))} className={`${INPUT} font-mono uppercase`} />
                    </label>
                    <label className="block">
                      <span className={ET}>Vencimiento *</span>
                      <input type="date" value={stockIni.vencimiento} onChange={(e) => setStockIni((p) => ({ ...p, vencimiento: e.target.value }))} className={INPUT} />
                    </label>
                  </div>
                ) : null}
                <p className="mt-2 text-[11px] text-slate-500">
                  {cantInicial > 0
                    ? <>Queda registrado como <strong>ajuste de inventario inicial</strong> (AJ-) en ese depósito, con fecha, usuario y costo.</>
                    : "Si ya tenés unidades, cargalas acá: quedan como ajuste de inventario inicial. Si no, el stock entra con la primera compra."}
                </p>
              </div>
            ) : null}
            {editando && conLotes && !producto?.controla_lotes && Number(producto?.stock_actual ?? 0) > 0 ? (
              <p className="mt-2 rounded-lg bg-[var(--brand-50)] px-3 py-2 text-xs text-slate-600">
                Las {Number(producto?.stock_actual).toLocaleString("es-PY")} unidades que ya tiene quedan como <strong>sin lote</strong> en cada depósito. Desde ahora, cada compra pide lote y vencimiento.
              </p>
            ) : null}
          </Bloque>

          {/* ── Stock por depósito (al editar): solo lectura; se mueve con documentos ── */}
          {editando && producto && producto.controla_stock && f.controla_stock ? (
            <Bloque titulo="Stock por depósito" extra={producto.controla_lotes ? <Link href="/inventario/vencimientos" className="text-xs font-semibold text-[var(--brand)] hover:underline">Ver vencimientos</Link> : null}>
              <StockDepositosProducto productoId={producto.id} unidad={producto.unidad_medida ?? "Unidad"} puedeEditar={esAdmin && !soloLectura} />
            </Bloque>
          ) : null}
        </fieldset>
        {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
      </form>
    </Contenedor>
  );
}

/** Botón "Generar" pegado al campo, con texto: el usuario ve qué hace sin adivinar. */
function BotonGenerar({ onClick, cargando }: { onClick: () => void; cargando: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={cargando}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--brand)] px-3.5 text-sm font-semibold max-sm:min-h-11 max-sm:px-3 text-[var(--brand)] transition hover:bg-[var(--brand-50)] disabled:opacity-60">
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

/** Panel lateral (Inventario) o modal centrado (alta rápida desde Compras). */
function Contenedor({ modal, titulo, subtitulo, onClose, footer, children }: {
  modal: boolean; titulo: string; subtitulo?: string; onClose: () => void; footer?: React.ReactNode; children: React.ReactNode;
}) {
  if (!modal) return <Drawer titulo={titulo} subtitulo={subtitulo} onClose={onClose} footer={footer}>{children}</Drawer>;
  return (
    <CapaModal onClose={onClose} z="z-[120]">
      <div role="dialog" aria-modal="true" aria-label={titulo}
        className={`flex w-full max-w-2xl ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-[#4FAEB2]/15`}
        style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 py-3 pl-4 pr-2 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900 sm:text-lg">{titulo}</h2>
            {subtitulo ? <p className="mt-0.5 text-xs text-slate-500">{subtitulo}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="inline-flex shrink-0 items-center justify-center rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 max-sm:h-11 max-sm:w-11">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">{children}</div>
        {footer ? <div className="pb-safe flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-6 sm:py-3.5">{footer}</div> : null}
      </div>
    </CapaModal>
  );
}
