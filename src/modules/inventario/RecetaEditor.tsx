"use client";

/**
 * Editor de receta (receta 72) en un CapaModal (hoja a todo el ancho en celular): rendimiento,
 * ingredientes (buscador inteligente de materias primas y preparaciones), cantidad neta, unidad
 * (g↔kg, ml↔l), merma %, costo por línea y total, y margen contra el precio de venta EN VIVO.
 * La base valida todo de nuevo (tipos, unidades, ciclos, profundidad) al guardar.
 *
 * Receta 73 — un plato (Menú) tiene pestañas Ingredientes / Extras / Opciones:
 *   · Ingredientes: cada uno con "Se puede quitar" (el cliente lo pide "sin …", no se descuenta).
 *   · Extras: se activan de la lista común (Recetas › Extras) con precio propio opcional y máximo.
 *   · Opciones: grupos ("Punto de la carne") obligatorios o no, con mínimo / máximo y opciones con
 *     precio extra opcional.
 *   · "Copiar de otro plato": suma los extras y los grupos de opciones de otro plato.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChefHat, Copy, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { buscar } from "@/lib/busqueda";
import { clienteConfig } from "@/cliente.config";
import { BuscadorProductos } from "@/modules/compras/partes";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT, ModalDocumento, Pestanas } from "@/modules/inventario/ui";
import type { ProductoInventario } from "@/modules/inventario/tipos";
import {
  brutoEnUnidadInsumo, cant, colorMargen, gs, margenPct, numero, precioFinal, unidadCorta, unidadSugerida, unidadesCompatibles,
  type DetalleReceta, type ExtraComun, type ExtraPlato, type GrupoOpciones, type ListaRecetas,
} from "@/modules/inventario/recetas";

const TEAL = clienteConfig.color;
const NUM = `${INPUT} text-right tabular-nums`;
const MINI = "mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-slate-400";

type Linea = {
  key: string;
  insumo_id: string;
  nombre: string;
  sku: string;
  unidad_insumo: string;
  cantidad: string;
  unidad: string;
  merma: string;
  costo_unitario: number;
  es_preparacion: boolean;
  stock: number;
  controla_stock: boolean;
  activo: boolean;
  quitar: boolean;
};

type ExtraEd = { extra_id: string; nombre: string; precio_lista: number; precio: string; maximo: string; activo: boolean; detalle: string; disponible?: number };
type OpcionEd = { key: string; id?: string; nombre: string; precio: string; activo: boolean };
type GrupoEd = { key: string; id?: string; nombre: string; obligatorio: boolean; minimo: string; maximo: string; opciones: OpcionEd[] };

let sec = 0;
const nuevaKey = () => `l${++sec}`;
const soloEntero = (v: string) => v.replace(/\D/g, "").slice(0, 2);
const soloGs = (v: string) => v.replace(/\D/g, "").slice(0, 9);

const extraEd = (e: ExtraPlato): ExtraEd => ({
  extra_id: e.extra_id, nombre: e.nombre, precio_lista: Number(e.precio_lista) || 0,
  precio: e.precio == null ? "" : String(e.precio), maximo: String(e.maximo ?? 3), activo: e.activo,
  detalle: `${e.insumo_nombre} · ${cant(e.cantidad)} ${unidadCorta(e.unidad)}`, disponible: e.disponible,
});
const grupoEd = (g: GrupoOpciones, conIds = true): GrupoEd => ({
  key: nuevaKey(), id: conIds ? g.id : undefined, nombre: g.nombre, obligatorio: g.obligatorio,
  minimo: String(g.obligatorio ? Math.max(1, g.minimo) : 1), maximo: String(g.maximo ?? 1),
  opciones: g.opciones.map((o) => ({ key: nuevaKey(), id: conIds ? o.id : undefined, nombre: o.nombre, precio: o.precio ? String(o.precio) : "", activo: o.activo !== false })),
});

export function RecetaEditor({ productoId, puedeEditar, onClose, onGuardado }: {
  productoId: string;
  puedeEditar: boolean;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [det, setDet] = useState<DetalleReceta | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [rend, setRend] = useState("1");
  const [notas, setNotas] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [extras, setExtras] = useState<ExtraEd[]>([]);
  const [grupos, setGrupos] = useState<GrupoEd[]>([]);
  const [tab, setTab] = useState<"ingredientes" | "extras" | "opciones">("ingredientes");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmarQuitar, setConfirmarQuitar] = useState(false);
  const [copiando, setCopiando] = useState(false);

  function cargarDetalle(d: DetalleReceta) {
    setDet(d);
    setRend(String(d.rendimiento ?? 1).replace(".", ","));
    setNotas(d.notas ?? "");
    setLineas(d.items.map((i) => ({
      key: nuevaKey(), insumo_id: i.insumo_id, nombre: i.nombre, sku: i.sku, unidad_insumo: i.unidad_insumo,
      cantidad: String(i.cantidad).replace(".", ","), unidad: i.unidad, merma: i.merma_pct ? String(i.merma_pct).replace(".", ",") : "",
      costo_unitario: Number(i.costo_unitario) || 0, es_preparacion: i.es_preparacion, stock: Number(i.stock) || 0,
      controla_stock: i.controla_stock, activo: i.activo, quitar: !!i.se_puede_quitar,
    })));
    setExtras((d.extras ?? []).map(extraEd));
    setGrupos((d.grupos ?? []).map((g) => grupoEd(g)));
  }

  useEffect(() => {
    let vivo = true;
    apiFetch<DetalleReceta>(`/api/inventario/recetas/${productoId}`)
      .then((d) => { if (vivo) cargarDetalle(d); })
      .catch((e) => { if (vivo) setErrorCarga((e as Error).message); });
    return () => { vivo = false; };
  }, [productoId]);

  const esPreparacion = det?.producto.tipo_producto === "materia_prima";
  const esPlato = det?.producto.tipo_producto === "menu";
  const unidadProd = det?.producto.unidad_medida ?? "Unidad";
  const rendimiento = Math.max(0, numero(rend));
  const costos = useMemo(() => lineas.map((l) => {
    const bruto = brutoEnUnidadInsumo(numero(l.cantidad), l.unidad, numero(l.merma), l.unidad_insumo);
    return { bruto, costo: bruto * l.costo_unitario };
  }), [lineas]);
  const costoTanda = costos.reduce((s, c) => s + c.costo, 0);
  const costoUnidad = rendimiento > 0 ? costoTanda / rendimiento : 0;
  const precio = det ? precioFinal(det.producto.precio_venta, det.producto.descuento_pct) : 0;
  const margen = !esPreparacion ? margenPct(costoUnidad, precio) : null;
  // Porciones que alcanzan con el stock del depósito (solo ingredientes con stock propio).
  // (Las preparaciones se cuentan en el servidor: acá se muestra lo que devolvió al abrir.)
  const porcionesVivo = useMemo((): number | null => {
    if (rendimiento <= 0) return null;
    if (lineas.some((l) => l.es_preparacion)) return det?.porciones ?? null;
    let min: number | null = null;
    for (let i = 0; i < lineas.length; i++) {
      const l = lineas[i];
      if (!l.controla_stock) continue;
      const porUnidad = costos[i].bruto / rendimiento;
      if (porUnidad <= 0) continue;
      const n = Math.floor(l.stock / porUnidad);
      min = min === null ? n : Math.min(min, n);
    }
    return min;
  }, [lineas, costos, rendimiento, det?.porciones]);

  const faltaCantidad = lineas.some((l) => numero(l.cantidad) <= 0);
  const mermaMal = lineas.some((l) => numero(l.merma) < 0 || numero(l.merma) > 90);
  // Receta 73: grupos con nombre y al menos una opción con nombre; mínimos y máximos con sentido.
  const problemaOpciones = useMemo(() => {
    if (!esPlato) return null;
    for (const g of grupos) {
      if (!g.nombre.trim()) return "Escribí el nombre de cada grupo de opciones.";
      if (!g.opciones.length) return `El grupo «${g.nombre}» no tiene opciones.`;
      if (g.opciones.some((o) => !o.nombre.trim())) return `Hay una opción sin nombre en «${g.nombre}».`;
      const max = Number(g.maximo) || 0, min = Number(g.minimo) || 0;
      if (max < 1) return `En «${g.nombre}» el máximo tiene que ser al menos 1.`;
      if (g.obligatorio && min > max) return `En «${g.nombre}» el mínimo no puede pasar el máximo.`;
      if (g.obligatorio && g.opciones.filter((o) => o.activo).length < Math.max(1, min)) return `El grupo obligatorio «${g.nombre}» necesita opciones activas.`;
    }
    const nombres = grupos.map((g) => g.nombre.trim().toLowerCase());
    if (new Set(nombres).size !== nombres.length) return "Hay dos grupos de opciones con el mismo nombre.";
    if (extras.some((e) => { const m = Number(e.maximo); return !(m >= 1 && m <= 20); })) return "El máximo de cada extra va de 1 a 20.";
    return null;
  }, [esPlato, grupos, extras]);
  const puedeGuardar = puedeEditar && !!det && rendimiento > 0 && !faltaCantidad && !mermaMal && lineas.length > 0 && !problemaOpciones;

  function agregar(p: ProductoInventario) {
    setAviso(null);
    if (!det) return;
    if (p.id === det.producto.id) { setAviso("Un producto no puede ser ingrediente de sí mismo."); return; }
    if (det.usado_en.some((u) => u.id === p.id)) { setAviso(`"${p.nombre}" ya usa "${det.producto.nombre}" en su receta: se formaría un ciclo.`); return; }
    if (p.tipo_producto && p.tipo_producto !== "materia_prima") { setAviso(`"${p.nombre}" no es materia prima.`); return; }
    if (lineas.some((l) => l.insumo_id === p.id)) { setAviso(`"${p.nombre}" ya está en la receta: cambiá su cantidad.`); return; }
    const u = p.unidad_medida || "Unidad";
    setLineas((ls) => [...ls, {
      key: nuevaKey(), insumo_id: p.id, nombre: p.nombre, sku: p.sku, unidad_insumo: u, cantidad: "", unidad: unidadSugerida(u),
      merma: "", costo_unitario: Number(p.costo_promedio) || 0, es_preparacion: p.controla_stock === false, stock: Number(p.stock_actual) || 0,
      controla_stock: p.controla_stock !== false, activo: p.activo !== false, quitar: false,
    }]);
  }

  const cambiar = (key: string, campo: "cantidad" | "unidad" | "merma", v: string) =>
    setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, [campo]: v } : l)));

  // ── Extras / opciones (receta 73) ──
  const cambiarExtra = (id: string, campo: "precio" | "maximo", v: string) =>
    setExtras((xs) => xs.map((x) => (x.extra_id === id ? { ...x, [campo]: v } : x)));
  const cambiarGrupo = (key: string, cambio: Partial<GrupoEd>) => setGrupos((gs) => gs.map((g) => (g.key === key ? { ...g, ...cambio } : g)));
  const cambiarOpcion = (gk: string, ok: string, cambio: Partial<OpcionEd>) =>
    setGrupos((gs) => gs.map((g) => (g.key === gk ? { ...g, opciones: g.opciones.map((o) => (o.key === ok ? { ...o, ...cambio } : o)) } : g)));

  function copiarDe(d: DetalleReceta) {
    let nExt = 0, nGr = 0;
    setExtras((xs) => {
      const nuevos = (d.extras ?? []).filter((e) => !xs.some((x) => x.extra_id === e.extra_id)).map(extraEd);
      nExt = nuevos.length;
      return [...xs, ...nuevos];
    });
    setGrupos((gs) => {
      const nombres = new Set(gs.map((g) => g.nombre.trim().toLowerCase()));
      const nuevos = (d.grupos ?? []).filter((g) => !nombres.has(g.nombre.trim().toLowerCase())).map((g) => grupoEd(g, false));
      nGr = nuevos.length;
      return [...gs, ...nuevos];
    });
    setCopiando(false);
    setTimeout(() => setAviso(nExt + nGr ? `Se copiaron de «${d.producto.nombre}»: ${nExt} extra(s) y ${nGr} grupo(s) de opciones. Guardá para aplicarlos.` : `«${d.producto.nombre}» no tiene extras ni opciones nuevas para copiar.`), 0);
  }

  async function guardar(items: Linea[]) {
    if (!det) return;
    setBusy(true);
    setError(null);
    try {
      const d = await apiFetch<DetalleReceta>(`/api/inventario/recetas/${det.producto.id}`, {
        method: "PUT",
        body: JSON.stringify({
          rendimiento: rendimiento || 1,
          notas: notas.trim() || null,
          items: items.map((l) => ({
            insumo_id: l.insumo_id, cantidad: numero(l.cantidad), unidad: l.unidad, merma_pct: numero(l.merma),
            se_puede_quitar: esPlato ? l.quitar : false,
          })),
          ...(esPlato && items.length ? {
            extras: extras.map((x) => ({ extra_id: x.extra_id, precio: x.precio === "" ? null : Number(x.precio), maximo: Number(x.maximo) || 3 })),
            grupos: grupos.map((g) => ({
              id: g.id ?? null, nombre: g.nombre.trim(), obligatorio: g.obligatorio,
              minimo: g.obligatorio ? Math.max(1, Number(g.minimo) || 1) : 0, maximo: Math.max(1, Number(g.maximo) || 1),
              opciones: g.opciones.map((o) => ({ id: o.id ?? null, nombre: o.nombre.trim(), precio: Number(o.precio) || 0, activo: o.activo })),
            })),
          } : {}),
        }),
      });
      cargarDetalle(d);
      setConfirmarQuitar(false);
      onGuardado();
      if (items.length) onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const titulo = det ? det.producto.nombre : "Receta";
  const quitables = lineas.filter((l) => l.quitar).length;
  return (
    <ModalDocumento
      ancho="max-w-3xl"
      titulo={<><ChefHat className="h-5 w-5 shrink-0" style={{ color: TEAL }} /> <span className="min-w-0 truncate">{titulo}</span></>}
      subtitulo={det ? (esPreparacion ? `Preparación · se mide en ${unidadCorta(unidadProd)} · no lleva stock propio` : `Plato del menú · ${det.producto.sku}`) : "Cargando…"}
      onClose={busy ? undefined : onClose}
      footer={det ? (
        <>
          {det.tiene_receta && puedeEditar ? (
            confirmarQuitar ? (
              <span className="mr-auto flex flex-wrap items-center gap-2 text-xs text-rose-700">
                ¿Quitar la receta?{esPreparacion ? " Vuelve a ser materia prima con stock." : " El plato no se podrá vender."}
                <button type="button" disabled={busy} onClick={() => void guardar([])} className="rounded-lg bg-rose-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50 max-sm:min-h-11">Sí, quitar</button>
                <button type="button" disabled={busy} onClick={() => setConfirmarQuitar(false)} className="rounded-lg px-2 py-1.5 font-semibold text-slate-500 max-sm:min-h-11">No</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmarQuitar(true)} className="mr-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 max-sm:min-h-11">
                <Trash2 className="h-3.5 w-3.5" /> Quitar receta
              </button>
            )
          ) : null}
          <button type="button" onClick={onClose} disabled={busy} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:flex-1`}>{puedeEditar ? "Cancelar" : "Cerrar"}</button>
          {puedeEditar ? (
            <button type="button" onClick={() => void guardar(lineas)} disabled={busy || !puedeGuardar} className={`${BOTON_PRIMARIO} max-sm:min-h-11 max-sm:flex-[2]`} style={{ backgroundColor: TEAL }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar receta
            </button>
          ) : null}
        </>
      ) : undefined}
    >
      {errorCarga ? (
        <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{errorCarga}</p>
      ) : !det ? (
        <div className="py-14 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /></div>
      ) : (
        <div className="space-y-5">
          {esPlato ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Pestanas
                valor={tab}
                onChange={(v) => { setTab(v as typeof tab); setAviso(null); }}
                opciones={[
                  { id: "ingredientes", label: "Ingredientes", badge: lineas.length || undefined },
                  { id: "extras", label: "Extras", badge: extras.length || undefined },
                  { id: "opciones", label: "Opciones", badge: grupos.length || undefined },
                ]}
              />
              {puedeEditar && tab !== "ingredientes" ? (
                <button type="button" onClick={() => setCopiando(true)} className={`${BOTON_SECUNDARIO} max-sm:min-h-11`}>
                  <Copy className="h-4 w-4" /> Copiar de otro plato
                </button>
              ) : null}
            </div>
          ) : null}
          {aviso && tab !== "ingredientes" ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{aviso}</p> : null}

          {tab === "ingredientes" || !esPlato ? (
            <>
              {/* Resumen en vivo */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Cifra etiqueta={esPreparacion ? `Costo por ${unidadCorta(unidadProd)}` : "Costo por porción"} valor={gs(costoUnidad)} />
                {esPreparacion ? (
                  <Cifra etiqueta="Costo de la tanda" valor={gs(costoTanda)} />
                ) : (
                  <Cifra etiqueta="Precio de venta" valor={gs(precio)} detalle={det.producto.descuento_pct ? `con ${det.producto.descuento_pct}% de desc.` : undefined} />
                )}
                {esPreparacion ? (
                  <Cifra etiqueta="Rinde" valor={`${cant(rendimiento)} ${unidadCorta(unidadProd)}`} />
                ) : (
                  <Cifra etiqueta="Margen" valor={margen == null ? "—" : `${margen.toFixed(1)}%`} clase={colorMargen(margen)}
                    detalle={precio > 0 ? `ganancia ${gs(precio - costoUnidad)}` : "sin precio de venta"} />
                )}
                <Cifra etiqueta={esPreparacion ? "Alcanza para" : "Porciones posibles"}
                  valor={porcionesVivo == null ? "—" : `${cant(porcionesVivo, 0)} ${esPreparacion ? unidadCorta(unidadProd) : "porc."}`}
                  clase={porcionesVivo === 0 ? "text-rose-600" : undefined} detalle="con el stock de tu depósito" />
              </div>

              {/* Rendimiento */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr] sm:items-start">
                <label className="block">
                  <span className={ET}>Rendimiento *</span>
                  <div className="relative">
                    <input inputMode="decimal" enterKeyHint="next" disabled={!puedeEditar} value={rend} onChange={(e) => setRend(e.target.value.replace(/[^\d.,]/g, ""))} className={`${NUM} pr-16`} />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{esPreparacion ? unidadCorta(unidadProd) : "porciones"}</span>
                  </div>
                </label>
                <p className="text-[11px] leading-relaxed text-slate-500 sm:pt-6">
                  {esPreparacion
                    ? `Cuánto produce esta receta (ej. 1 kg de salsa). Al vender un plato que la usa se descuentan sus ingredientes en proporción.`
                    : "Cuántas porciones salen con estas cantidades (ej. un flan entero = 8 porciones). Al vender se descuenta la parte de una porción."}
                  {" "}La cantidad de cada ingrediente es la <strong>neta</strong> (lo que va al plato); con merma se descuenta la bruta = neta ÷ (1 − merma).
                </p>
              </div>

              {/* Ingredientes */}
              <section>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Ingredientes ({lineas.length})</h3>
                  <span className="text-[11px] text-slate-400">Costos con IVA incluido</span>
                </div>
                {puedeEditar ? (
                  <>
                    <BuscadorProductos tipo="materia_prima" onElegir={agregar} />
                    <p className="mt-1 text-[11px] text-slate-400">Materias primas y preparaciones. Si falta un insumo, crealo en Productos como «Materia prima».</p>
                  </>
                ) : null}
                {aviso && tab === "ingredientes" ? <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{aviso}</p> : null}

                {lineas.length === 0 ? (
                  <div className="mt-3 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                    Todavía no tiene ingredientes. {puedeEditar ? "Buscalos arriba." : ""}
                  </div>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {lineas.map((l, i) => {
                      const c = costos[i];
                      const unidades = unidadesCompatibles(l.unidad_insumo);
                      const sinStock = l.controla_stock && !l.es_preparacion && rendimiento > 0 && l.stock < c.bruto / rendimiento;
                      return (
                        <li key={l.key} className={`rounded-xl border px-3 py-2.5 ${sinStock || !l.activo ? "border-rose-200 bg-rose-50/40" : "border-slate-200 bg-white"}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-900">
                                {l.nombre}
                                {l.es_preparacion ? <span className="ml-1.5 rounded-full bg-lime-50 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-lime-800 ring-1 ring-lime-200">Preparación</span> : null}
                                {!l.activo ? <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-amber-700">Inactivo</span> : null}
                              </p>
                              <p className="text-[11px] text-slate-500">
                                {gs(l.costo_unitario)} / {unidadCorta(l.unidad_insumo)}
                                {l.es_preparacion ? " · se explota en sus ingredientes" : l.controla_stock ? ` · stock ${cant(l.stock)} ${unidadCorta(l.unidad_insumo)}` : " · sin control de stock"}
                              </p>
                            </div>
                            {puedeEditar ? (
                              <button type="button" onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Quitar ${l.nombre}`}
                                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 max-sm:h-11 max-sm:w-11">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            ) : null}
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[120px_auto_100px_minmax(0,1fr)] sm:items-end">
                            <label className="block">
                              <span className={MINI}>Cantidad neta</span>
                              <input inputMode="decimal" disabled={!puedeEditar} value={l.cantidad} onChange={(e) => cambiar(l.key, "cantidad", e.target.value.replace(/[^\d.,]/g, ""))}
                                placeholder="0" aria-label={`Cantidad de ${l.nombre}`} className={`${NUM} py-2`} />
                            </label>
                            <div>
                              <span className={MINI}>Unidad</span>
                              <div role="radiogroup" aria-label={`Unidad de ${l.nombre}`} className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
                                {unidades.map((u) => (
                                  <button key={u} type="button" role="radio" aria-checked={l.unidad === u} disabled={!puedeEditar} onClick={() => cambiar(l.key, "unidad", u)}
                                    className="min-w-10 flex-1 rounded-lg px-2 py-1 text-sm font-semibold transition max-sm:min-h-9"
                                    style={l.unidad === u ? { backgroundColor: "#fff", color: TEAL, boxShadow: "0 1px 2px rgba(15,23,42,.08)" } : { color: "#64748b" }}>
                                    {unidadCorta(u)}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <label className="block">
                              <span className={MINI}>Merma</span>
                              <div className="relative">
                                <input inputMode="decimal" disabled={!puedeEditar} value={l.merma} onChange={(e) => cambiar(l.key, "merma", e.target.value.replace(/[^\d.,]/g, "").slice(0, 5))}
                                  placeholder="0" aria-label={`Merma de ${l.nombre}`} className={`${NUM} py-2 pr-7 ${numero(l.merma) > 90 ? "border-rose-300" : ""}`} />
                                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
                              </div>
                            </label>
                            <div className="text-right max-sm:col-span-1 max-sm:self-end">
                              <p className="text-[11px] text-slate-500 tabular-nums">
                                Descuenta {cant(c.bruto, 4)} {unidadCorta(l.unidad_insumo)}
                              </p>
                              <p className="text-sm font-semibold tabular-nums text-slate-900">{gs(c.costo)}</p>
                            </div>
                          </div>
                          {esPlato ? (
                            <Interruptor activo={l.quitar} disabled={!puedeEditar} onChange={(v) => setLineas((ls) => ls.map((x) => (x.key === l.key ? { ...x, quitar: v } : x)))}
                              texto="Se puede quitar" detalle={l.quitar ? `El cliente lo puede pedir "sin ${l.nombre.toLowerCase()}" (no se descuenta)` : undefined} />
                          ) : null}
                          {sinStock ? (
                            <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-rose-700"><AlertTriangle className="h-3.5 w-3.5" /> No alcanza para una {esPreparacion ? "tanda" : "porción"} con el stock de tu depósito.</p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {lineas.length ? (
                  <div className="mt-3 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
                    <span className="text-slate-500">Total de la receta <strong className="tabular-nums text-slate-900">{gs(costoTanda)}</strong></span>
                    <span className="text-slate-500">÷ {cant(rendimiento)} = <strong className="tabular-nums text-slate-900">{gs(costoUnidad)}</strong> por {esPreparacion ? unidadCorta(unidadProd) : "porción"}</span>
                  </div>
                ) : null}
                {esPlato && quitables ? <p className="mt-2 text-[11px] text-slate-500">{quitables} ingrediente(s) se pueden quitar.</p> : null}
              </section>

              <label className="block">
                <span className={ET}>Notas <span className="font-normal text-slate-400">(opcional: preparación, armado)</span></span>
                <textarea rows={2} disabled={!puedeEditar} value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={1000} className={`${INPUT} resize-none`} />
              </label>

              {det.usado_en.length ? (
                <p className="text-xs text-slate-500">
                  Se usa en: {det.usado_en.map((u, i) => <span key={u.id}>{i ? ", " : ""}<strong className="text-slate-700">{u.nombre}</strong></span>)}.
                </p>
              ) : null}
              {!esPreparacion ? (
                <p className="text-[11px] text-slate-400">
                  El precio se cambia en <Link href="/inventario" className="font-semibold text-[var(--brand)] hover:underline">Productos</Link>. Sin receta el plato no se puede vender; si falta un ingrediente, tampoco (y sale del menú QR).
                </p>
              ) : null}
            </>
          ) : tab === "extras" ? (
            <TabExtras extras={extras} setExtras={setExtras} cambiarExtra={cambiarExtra} puedeEditar={puedeEditar} />
          ) : (
            <section className="space-y-3">
              <p className="text-[11px] leading-relaxed text-slate-500">
                Grupos para elegir al pedir (ej. «Punto de la carne»: Jugosa / A punto / Bien cocida). Si es obligatorio, no se puede pedir sin elegir.
                Cada opción puede sumar un precio (0 = sin cargo). Las opciones no cambian el stock.
              </p>
              {grupos.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">Este plato no tiene opciones para elegir.</div>
              ) : null}
              {grupos.map((g) => (
                <div key={g.key} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start gap-2">
                    <label className="block min-w-0 flex-1">
                      <span className={MINI}>Grupo</span>
                      <input value={g.nombre} disabled={!puedeEditar} onChange={(e) => cambiarGrupo(g.key, { nombre: e.target.value.slice(0, 60) })} placeholder="Ej.: Punto de la carne" className={`${INPUT} py-2`} />
                    </label>
                    {puedeEditar ? (
                      <button type="button" onClick={() => setGrupos((gs) => gs.filter((x) => x.key !== g.key))} aria-label={`Quitar el grupo ${g.nombre}`}
                        className="mt-4 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 max-sm:h-11 max-sm:w-11">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
                    <Interruptor activo={g.obligatorio} disabled={!puedeEditar} onChange={(v) => cambiarGrupo(g.key, { obligatorio: v })} texto="Obligatorio" />
                    {g.obligatorio ? (
                      <label className="block w-20">
                        <span className={MINI}>Mínimo</span>
                        <input inputMode="numeric" disabled={!puedeEditar} value={g.minimo} onChange={(e) => cambiarGrupo(g.key, { minimo: soloEntero(e.target.value) })} className={`${NUM} py-2`} />
                      </label>
                    ) : null}
                    <label className="block w-20">
                      <span className={MINI}>Máximo</span>
                      <input inputMode="numeric" disabled={!puedeEditar} value={g.maximo} onChange={(e) => cambiarGrupo(g.key, { maximo: soloEntero(e.target.value) })} className={`${NUM} py-2`} />
                    </label>
                    <span className="pb-2 text-[11px] text-slate-400">{Number(g.maximo) === 1 ? "Se elige una" : `Se eligen hasta ${Number(g.maximo) || 0}`}</span>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {g.opciones.map((o) => (
                      <li key={o.key} className="grid grid-cols-[minmax(0,1fr)_7.5rem_auto] items-end gap-2 max-sm:grid-cols-[minmax(0,1fr)_6.5rem_auto]">
                        <label className="block min-w-0">
                          <span className={MINI}>Opción</span>
                          <input value={o.nombre} disabled={!puedeEditar} onChange={(e) => cambiarOpcion(g.key, o.key, { nombre: e.target.value.slice(0, 60) })} placeholder="Ej.: A punto"
                            className={`${INPUT} py-2 ${o.activo ? "" : "text-slate-400 line-through"}`} />
                        </label>
                        <label className="block">
                          <span className={MINI}>+ Precio (Gs.)</span>
                          <input inputMode="numeric" disabled={!puedeEditar} value={o.precio} onChange={(e) => cambiarOpcion(g.key, o.key, { precio: soloGs(e.target.value) })} placeholder="0" className={`${NUM} py-2`} />
                        </label>
                        {puedeEditar ? (
                          <button type="button" onClick={() => cambiarGrupo(g.key, { opciones: g.opciones.filter((x) => x.key !== o.key) })} aria-label={`Quitar la opción ${o.nombre}`}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 max-sm:h-11 max-sm:w-11">
                            <X className="h-4 w-4" />
                          </button>
                        ) : <span />}
                      </li>
                    ))}
                  </ul>
                  {puedeEditar ? (
                    <button type="button" onClick={() => cambiarGrupo(g.key, { opciones: [...g.opciones, { key: nuevaKey(), nombre: "", precio: "", activo: true }] })}
                      className="mt-2 inline-flex min-h-10 items-center gap-1 rounded-lg px-1 text-xs font-semibold" style={{ color: TEAL }}>
                      <Plus className="h-3.5 w-3.5" /> Opción
                    </button>
                  ) : null}
                </div>
              ))}
              {puedeEditar ? (
                <button type="button" className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:w-full`}
                  onClick={() => setGrupos((gs) => [...gs, { key: nuevaKey(), nombre: "", obligatorio: true, minimo: "1", maximo: "1", opciones: [{ key: nuevaKey(), nombre: "", precio: "", activo: true }, { key: nuevaKey(), nombre: "", precio: "", activo: true }] }])}>
                  <Plus className="h-4 w-4" /> Grupo de opciones
                </button>
              ) : null}
              <p className="text-[11px] text-slate-400">Pendiente: que una opción agregue o reemplace un ingrediente (por ahora solo cambia el precio).</p>
            </section>
          )}
          {problemaOpciones && tab !== "ingredientes" ? <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">{problemaOpciones}</p> : null}
          {problemaOpciones && tab === "ingredientes" ? <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">Revisá la pestaña Opciones: {problemaOpciones}</p> : null}
          {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
        </div>
      )}
      {copiando && det ? <CopiarDePlato excluir={det.producto.id} onElegir={copiarDe} onClose={() => setCopiando(false)} /> : null}
    </ModalDocumento>
  );
}

/** Pestaña Extras del plato: activar extras de la lista común (precio propio opcional y máximo). */
function TabExtras({ extras, setExtras, cambiarExtra, puedeEditar }: {
  extras: ExtraEd[];
  setExtras: React.Dispatch<React.SetStateAction<ExtraEd[]>>;
  cambiarExtra: (id: string, campo: "precio" | "maximo", v: string) => void;
  puedeEditar: boolean;
}) {
  const [lista, setLista] = useState<ExtraComun[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    apiFetch<{ items: ExtraComun[] }>("/api/inventario/recetas/extras").then((r) => setLista(r.items)).catch(() => setLista([]));
  }, []);
  const libres = useMemo(() => {
    const l = (lista ?? []).filter((x) => x.activo && !extras.some((e) => e.extra_id === x.id));
    return q.trim() ? buscar(l, q, (x) => ({ principal: x.nombre, otros: [x.insumo_nombre] })) : l;
  }, [lista, extras, q]);

  return (
    <section className="space-y-3">
      <p className="text-[11px] leading-relaxed text-slate-500">
        Los extras suman al precio y descuentan su ingrediente del stock (la cantidad del extra, sin merma). Se crean en la pestaña
        <strong> Extras</strong> de Recetas y acá se activan para este plato. Precio vacío = el de la lista.
      </p>
      {extras.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">Este plato no tiene extras activados.</div>
      ) : (
        <ul className="space-y-2">
          {extras.map((x) => (
            <li key={x.extra_id} className={`rounded-xl border px-3 py-2.5 ${x.activo ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50/40"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {x.nombre}
                    {!x.activo ? <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-amber-700">Inactivo en la lista</span> : null}
                  </p>
                  <p className="text-[11px] text-slate-500">{x.detalle} · lista {gs(x.precio_lista)}{x.disponible != null && x.disponible < 999 ? ` · alcanza para ${x.disponible}` : ""}</p>
                </div>
                {puedeEditar ? (
                  <button type="button" onClick={() => setExtras((xs) => xs.filter((e) => e.extra_id !== x.extra_id))} aria-label={`Quitar ${x.nombre}`}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 max-sm:h-11 max-sm:w-11">
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:max-w-sm">
                <label className="block">
                  <span className={MINI}>Precio en este plato</span>
                  <input inputMode="numeric" disabled={!puedeEditar} value={x.precio} placeholder={String(x.precio_lista)} onChange={(e) => cambiarExtra(x.extra_id, "precio", soloGs(e.target.value))} className={`${NUM} py-2`} />
                </label>
                <label className="block">
                  <span className={MINI}>Máximo por plato</span>
                  <input inputMode="numeric" disabled={!puedeEditar} value={x.maximo} onChange={(e) => cambiarExtra(x.extra_id, "maximo", soloEntero(e.target.value))} className={`${NUM} py-2`} />
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}
      {puedeEditar ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <p className="mb-2 text-xs font-semibold text-slate-700">Activar un extra de la lista</p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar extra o ingrediente…" className={`${INPUT} pl-9`} />
          </div>
          {lista === null ? (
            <div className="py-4 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></div>
          ) : libres.length === 0 ? (
            <p className="py-3 text-center text-xs text-slate-500">{(lista ?? []).length ? "No hay más extras para activar." : "Todavía no hay extras: crealos en la pestaña Extras de Recetas."}</p>
          ) : (
            <ul className="mt-2 max-h-56 divide-y divide-slate-100 overflow-auto rounded-xl border border-slate-200 bg-white">
              {libres.map((x) => (
                <li key={x.id}>
                  <button type="button" onClick={() => setExtras((xs) => [...xs, {
                    extra_id: x.id, nombre: x.nombre, precio_lista: Number(x.precio) || 0, precio: "", maximo: "3", activo: x.activo,
                    detalle: `${x.insumo_nombre} · ${cant(x.cantidad)} ${unidadCorta(x.unidad)}`,
                  }])} className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-slate-900">{x.nombre}</span>
                      <span className="block text-[11px] text-slate-500">{x.insumo_nombre} · {cant(x.cantidad)} {unidadCorta(x.unidad)}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-700">+ {gs(x.precio)}</span>
                    <Plus className="h-4 w-4 shrink-0" style={{ color: TEAL }} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** Elegir otro plato para copiar sus extras y grupos de opciones. */
function CopiarDePlato({ excluir, onElegir, onClose }: { excluir: string; onElegir: (d: DetalleReceta) => void; onClose: () => void }) {
  const [lista, setLista] = useState<ListaRecetas["items"] | null>(null);
  const [q, setQ] = useState("");
  const [cargando, setCargando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<ListaRecetas>("/api/inventario/recetas").then((r) => setLista(r.items.filter((f) => f.tipo === "menu" && f.id !== excluir))).catch(() => setLista([]));
  }, [excluir]);
  const filas = useMemo(() => {
    const l = lista ?? [];
    return q.trim() ? buscar(l, q, (f) => ({ principal: f.nombre, codigos: [f.sku] })) : l;
  }, [lista, q]);
  async function elegir(id: string) {
    setCargando(id);
    setError(null);
    try {
      onElegir(await apiFetch<DetalleReceta>(`/api/inventario/recetas/${id}`));
    } catch (e) {
      setError((e as Error).message);
      setCargando(null);
    }
  }
  return (
    <ModalDocumento ancho="max-w-md" titulo="Copiar de otro plato" subtitulo="Se suman sus extras activados y sus grupos de opciones (los que este plato no tiene)" onClose={onClose}>
      <div className="space-y-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar plato…" className={`${INPUT} pl-9`} />
        </div>
        {lista === null ? (
          <div className="py-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></div>
        ) : filas.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">No hay otros platos.</p>
        ) : (
          <ul className="max-h-[50dvh] divide-y divide-slate-100 overflow-auto rounded-xl border border-slate-200">
            {filas.map((f) => (
              <li key={f.id}>
                <button type="button" disabled={!!cargando} onClick={() => void elegir(f.id)} className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-60">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-900">{f.nombre}</span>
                    <span className="block text-[11px] text-slate-500">{f.modificadores ? `${f.modificadores} modificador(es)` : "Sin modificadores"}</span>
                  </span>
                  {cargando === f.id ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : <Copy className="h-4 w-4 text-slate-400" />}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
      </div>
    </ModalDocumento>
  );
}

function Interruptor({ activo, onChange, texto, detalle, disabled }: { activo: boolean; onChange: (v: boolean) => void; texto: string; detalle?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={activo} disabled={disabled} onClick={() => onChange(!activo)}
      className="mt-2 flex min-h-10 items-center gap-2 text-left text-xs disabled:opacity-60">
      <span className="relative inline-flex h-5 w-9 shrink-0 rounded-full transition" style={{ backgroundColor: activo ? TEAL : "#cbd5e1" }}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${activo ? "left-[18px]" : "left-0.5"}`} />
      </span>
      <span>
        <span className="font-semibold text-slate-700">{texto}</span>
        {detalle ? <span className="block text-[11px] text-slate-500">{detalle}</span> : null}
      </span>
    </button>
  );
}

function Cifra({ etiqueta, valor, detalle, clase }: { etiqueta: string; valor: string; detalle?: string; clase?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{etiqueta}</p>
      <p className={`mt-0.5 text-[15px] font-semibold tabular-nums [overflow-wrap:anywhere] ${clase ?? "text-slate-900"}`}>{valor}</p>
      {detalle ? <p className="text-[10px] text-slate-400">{detalle}</p> : null}
    </div>
  );
}
