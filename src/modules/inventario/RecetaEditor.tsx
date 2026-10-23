"use client";

/**
 * Editor de receta (receta 72) en un CapaModal (hoja a todo el ancho en celular): rendimiento,
 * ingredientes (buscador inteligente de materias primas y preparaciones), cantidad neta, unidad
 * (g↔kg, ml↔l), merma %, costo por línea y total, y margen contra el precio de venta EN VIVO.
 * La base valida todo de nuevo (tipos, unidades, ciclos, profundidad) al guardar.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChefHat, Loader2, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { BuscadorProductos } from "@/modules/compras/partes";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT, ModalDocumento } from "@/modules/inventario/ui";
import type { ProductoInventario } from "@/modules/inventario/tipos";
import {
  brutoEnUnidadInsumo, cant, colorMargen, gs, margenPct, numero, precioFinal, unidadCorta, unidadSugerida, unidadesCompatibles,
  type DetalleReceta,
} from "@/modules/inventario/recetas";

const TEAL = clienteConfig.color;
const NUM = `${INPUT} text-right tabular-nums`;

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
};

let sec = 0;
const nuevaKey = () => `l${++sec}`;

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmarQuitar, setConfirmarQuitar] = useState(false);

  function cargarDetalle(d: DetalleReceta) {
    setDet(d);
    setRend(String(d.rendimiento ?? 1).replace(".", ","));
    setNotas(d.notas ?? "");
    setLineas(d.items.map((i) => ({
      key: nuevaKey(), insumo_id: i.insumo_id, nombre: i.nombre, sku: i.sku, unidad_insumo: i.unidad_insumo,
      cantidad: String(i.cantidad).replace(".", ","), unidad: i.unidad, merma: i.merma_pct ? String(i.merma_pct).replace(".", ",") : "",
      costo_unitario: Number(i.costo_unitario) || 0, es_preparacion: i.es_preparacion, stock: Number(i.stock) || 0,
      controla_stock: i.controla_stock, activo: i.activo,
    })));
  }

  useEffect(() => {
    let vivo = true;
    apiFetch<DetalleReceta>(`/api/inventario/recetas/${productoId}`)
      .then((d) => { if (vivo) cargarDetalle(d); })
      .catch((e) => { if (vivo) setErrorCarga((e as Error).message); });
    return () => { vivo = false; };
  }, [productoId]);

  const esPreparacion = det?.producto.tipo_producto === "materia_prima";
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
  const puedeGuardar = puedeEditar && !!det && rendimiento > 0 && !faltaCantidad && !mermaMal && lineas.length > 0;

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
      controla_stock: p.controla_stock !== false, activo: p.activo !== false,
    }]);
  }

  const cambiar = (key: string, campo: "cantidad" | "unidad" | "merma", v: string) =>
    setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, [campo]: v } : l)));

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
          items: items.map((l) => ({ insumo_id: l.insumo_id, cantidad: numero(l.cantidad), unidad: l.unidad, merma_pct: numero(l.merma) })),
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
            {aviso ? <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{aviso}</p> : null}

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
                          <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-slate-400">Cantidad neta</span>
                          <input inputMode="decimal" disabled={!puedeEditar} value={l.cantidad} onChange={(e) => cambiar(l.key, "cantidad", e.target.value.replace(/[^\d.,]/g, ""))}
                            placeholder="0" aria-label={`Cantidad de ${l.nombre}`} className={`${NUM} py-2`} />
                        </label>
                        <div>
                          <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-slate-400">Unidad</span>
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
                          <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-slate-400">Merma</span>
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
          {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
        </div>
      )}
    </ModalDocumento>
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
