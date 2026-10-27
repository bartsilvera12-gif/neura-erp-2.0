"use client";

/**
 * Hoja de modificadores de un plato (receta 73), compartida por el menú QR y Caja › Nueva venta.
 * En celular es una hoja inferior (CapaModal la apoya abajo); en tablet / escritorio, un modal.
 *   · Opciones (radios si se elige una, casillas si más; las obligatorias con *). Receta 74: una
 *     opción cuyos ingredientes no alcanzan aparece deshabilitada con "Sin stock".
 *   · Quitar ("Sin lechuga")
 *   · Extras (− / + con su precio; sin stock: no aparecen en el QR, deshabilitados en la caja)
 *   · Nota (opcional), cantidad y el precio en vivo.
 * El precio final lo pone el servidor; acá es la vista previa (mismo cálculo).
 */
import { useMemo, useRef, useState } from "react";
import { Check, Minus, Plus, X } from "lucide-react";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import {
  claveMods, partesSel, precioMods, problemaSel, selVacia, textoSnapshot,
  type ModsCatalogo, type ModsSeleccion,
} from "@/modules/mesas/modificadores";

const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;

export type ResultadoMods = {
  sel: ModsSeleccion;
  cantidad: number;
  nota: string;
  /** "sin cebolla · + extra queso ×2 · a punto" */
  texto: string;
  /** Precio por unidad de los modificadores. */
  precio_mods: number;
  clave: string;
};

export function HojaModificadores({
  producto, catalogo, inicial, color, conNota = false, ocultarSinStock = false, textoBoton, maxCantidad = 50,
  z, onConfirmar, onClose,
}: {
  producto: { nombre: string; precio: number; precio_lista?: number | null; imagen_url?: string | null; descripcion?: string | null };
  catalogo: ModsCatalogo;
  inicial?: { sel: ModsSeleccion; cantidad: number; nota?: string };
  color: string;
  /** Aclaración libre de la línea (menú QR). */
  conNota?: boolean;
  /** Menú QR: los extras sin stock no aparecen (en la caja se ven deshabilitados). */
  ocultarSinStock?: boolean;
  textoBoton?: string;
  maxCantidad?: number;
  z?: string;
  onConfirmar: (r: ResultadoMods) => void;
  onClose: () => void;
}) {
  const [sel, setSel] = useState<ModsSeleccion>(() => inicial?.sel ? structuredClone(inicial.sel) : selVacia());
  const [cantidad, setCantidad] = useState(inicial?.cantidad ?? 1);
  const [nota, setNota] = useState(inicial?.nota ?? "");
  const [intento, setIntento] = useState(false);
  const [sinFoto, setSinFoto] = useState(!producto.imagen_url);
  const refs = useRef<Record<string, HTMLElement | null>>({});

  const extras = useMemo(
    () => catalogo.extras.filter((e) => !ocultarSinStock || e.disponible > 0 || sel.extras.some((x) => x.extra_id === e.extra_id && x.cantidad > 0)),
    [catalogo.extras, ocultarSinStock, sel.extras],
  );
  const grupos = catalogo.grupos.filter((g) => g.opciones.length > 0);
  const unidad = producto.precio + precioMods(catalogo, sel);
  const problema = problemaSel(catalogo, sel);
  const texto = textoSnapshot(partesSel(catalogo, sel));

  const elegirOpcion = (gId: string, oId: string, maximo: number) =>
    setSel((s) => {
      const delGrupo = grupos.find((g) => g.id === gId)!.opciones.map((o) => o.id);
      const ya = s.opciones.includes(oId);
      if (maximo === 1) return { ...s, opciones: [...s.opciones.filter((x) => !delGrupo.includes(x)), ...(ya ? [] : [oId])] };
      if (ya) return { ...s, opciones: s.opciones.filter((x) => x !== oId) };
      if (s.opciones.filter((x) => delGrupo.includes(x)).length >= maximo) return s;
      return { ...s, opciones: [...s.opciones, oId] };
    });
  const alternarQuitar = (id: string) =>
    setSel((s) => ({ ...s, quitar: s.quitar.includes(id) ? s.quitar.filter((x) => x !== id) : [...s.quitar, id] }));
  const cantExtra = (id: string) => sel.extras.find((e) => e.extra_id === id)?.cantidad ?? 0;
  const cambiarExtra = (id: string, delta: number, tope: number) =>
    setSel((s) => {
      const n = Math.max(0, Math.min(tope, (s.extras.find((e) => e.extra_id === id)?.cantidad ?? 0) + delta));
      const resto = s.extras.filter((e) => e.extra_id !== id);
      return { ...s, extras: n > 0 ? [...resto, { extra_id: id, cantidad: n }] : resto };
    });

  function confirmar() {
    if (problema) {
      setIntento(true);
      refs.current[problema.grupo]?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const limpia: ModsSeleccion = { quitar: sel.quitar, extras: sel.extras.filter((e) => e.cantidad > 0), opciones: sel.opciones };
    onConfirmar({ sel: limpia, cantidad, nota: nota.trim(), texto, precio_mods: precioMods(catalogo, limpia), clave: claveMods(limpia) });
  }

  const titulo = (t: string, sub?: string, obligatorio?: boolean) => (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h3 className="text-sm font-bold text-slate-900">{t}{obligatorio ? <span className="text-rose-600"> *</span> : null}</h3>
      {sub ? <span className={`shrink-0 text-[11px] font-medium ${obligatorio ? "text-rose-600" : "text-slate-400"}`}>{sub}</span> : null}
    </div>
  );

  return (
    <CapaModal onClose={onClose} z={z}>
      <div role="dialog" aria-modal="true" aria-label={producto.nombre}
        className={`flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl ${ALTO_MAX_MODAL}`}
        style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        {/* Cabecera */}
        <div className="flex shrink-0 items-start gap-3 border-b border-slate-100 px-4 py-3">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-100">
            {sinFoto ? (
              <div className="grid h-full w-full place-items-center text-xl font-bold text-slate-300">{producto.nombre.slice(0, 1)}</div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={producto.imagen_url!} alt="" className="h-full w-full object-cover" onError={() => setSinFoto(true)} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold leading-snug text-slate-900 [overflow-wrap:anywhere]">{producto.nombre}</p>
            {producto.descripcion ? <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{producto.descripcion}</p> : null}
            <p className="mt-0.5 text-sm tabular-nums text-slate-600">
              {producto.precio_lista ? <span className="mr-1.5 text-xs text-slate-400 line-through">{gs(producto.precio_lista)}</span> : null}
              {gs(producto.precio)}
            </p>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="-mr-1 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 sm:h-9 sm:w-9">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Cuerpo */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
          {grupos.map((g) => {
            const marcadas = g.opciones.filter((o) => sel.opciones.includes(o.id)).length;
            const mal = intento && problema?.grupo === g.id;
            const min = g.obligatorio ? Math.max(1, g.minimo) : 0;
            const sub = g.maximo === 1 ? (g.obligatorio ? "Obligatorio · elegí 1" : "Opcional") : `${g.obligatorio ? `Elegí de ${min} a ${g.maximo}` : `Hasta ${g.maximo}`}`;
            return (
              <section key={g.id} ref={(el) => { refs.current[g.id] = el; }} className={`rounded-xl transition ${mal ? "ring-2 ring-rose-300 ring-offset-4" : ""}`}>
                {titulo(g.nombre, sub, g.obligatorio)}
                <div role={g.maximo === 1 ? "radiogroup" : "group"} aria-label={g.nombre} className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                  {g.opciones.map((o) => {
                    const on = sel.opciones.includes(o.id);
                    // Receta 74: sin stock para sus ingredientes → deshabilitada (si ya estaba elegida, se puede sacar).
                    const sinStock = o.disponible === false;
                    const bloqueada = !on && (sinStock || (g.maximo > 1 && marcadas >= g.maximo));
                    return (
                      <button key={o.id} type="button" role={g.maximo === 1 ? "radio" : "checkbox"} aria-checked={on} disabled={bloqueada}
                        onClick={() => elegirOpcion(g.id, o.id, g.maximo)}
                        className={`flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left text-sm transition active:bg-slate-50 ${sinStock && !on ? "disabled:opacity-50" : "disabled:opacity-40"}`}>
                        <span className={`grid h-5 w-5 shrink-0 place-items-center border-2 ${g.maximo === 1 ? "rounded-full" : "rounded-md"}`}
                          style={{ borderColor: on ? color : "#cbd5e1", backgroundColor: on && g.maximo > 1 ? color : undefined }}>
                          {on ? (g.maximo === 1 ? <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} /> : <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />) : null}
                        </span>
                        <span className={`min-w-0 flex-1 ${on ? "font-semibold text-slate-900" : "text-slate-700"}`}>{o.nombre}</span>
                        {sinStock ? <span className="shrink-0 text-xs font-medium text-rose-600">Sin stock</span>
                          : o.precio > 0 ? <span className="shrink-0 text-xs font-medium tabular-nums text-slate-500">+ {gs(o.precio)}</span> : null}
                      </button>
                    );
                  })}
                </div>
                {mal ? <p className="mt-1.5 text-xs font-medium text-rose-600" role="alert">{problema!.mensaje}</p> : null}
              </section>
            );
          })}

          {catalogo.quitar.length ? (
            <section>
              {titulo("¿Le sacamos algo?", "Sin cargo")}
              <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                {catalogo.quitar.map((q) => {
                  const on = sel.quitar.includes(q.producto_id);
                  return (
                    <button key={q.producto_id} type="button" role="checkbox" aria-checked={on} onClick={() => alternarQuitar(q.producto_id)}
                      className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left text-sm transition active:bg-slate-50">
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md border-2"
                        style={{ borderColor: on ? "#e11d48" : "#cbd5e1", backgroundColor: on ? "#e11d48" : undefined }}>
                        {on ? <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} /> : null}
                      </span>
                      <span className={`min-w-0 flex-1 ${on ? "font-semibold text-rose-700" : "text-slate-700"}`}>Sin {q.nombre.toLowerCase()}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {extras.length ? (
            <section>
              {titulo("Extras", "Con cargo")}
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                {extras.map((e) => {
                  const n = cantExtra(e.extra_id);
                  const tope = Math.max(0, Math.min(e.maximo, e.disponible));
                  const agotado = tope <= 0 && n === 0;
                  return (
                    <li key={e.extra_id} className={`flex min-h-12 items-center gap-3 px-3 py-1.5 text-sm ${agotado ? "opacity-50" : ""}`}>
                      <div className="min-w-0 flex-1">
                        <p className={n > 0 ? "font-semibold text-emerald-800" : "text-slate-700"}>{e.nombre}</p>
                        <p className="text-xs tabular-nums text-slate-500">
                          + {gs(e.precio)}{agotado ? " · sin stock" : e.maximo > 1 ? ` · hasta ${tope}` : ""}
                        </p>
                      </div>
                      {n > 0 ? (
                        <div className="flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white p-0.5">
                          <button type="button" onClick={() => cambiarExtra(e.extra_id, -1, tope)} aria-label={`Uno menos de ${e.nombre}`}
                            className="grid h-9 w-9 place-items-center rounded-full text-slate-700 active:bg-slate-100"><Minus className="h-4 w-4" /></button>
                          <span className="min-w-5 text-center text-sm font-bold tabular-nums">{n}</span>
                          <button type="button" onClick={() => cambiarExtra(e.extra_id, 1, tope)} disabled={n >= tope} aria-label={`Uno más de ${e.nombre}`}
                            className="grid h-9 w-9 place-items-center rounded-full text-white disabled:opacity-40" style={{ backgroundColor: color }}><Plus className="h-4 w-4" /></button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => cambiarExtra(e.extra_id, 1, tope)} disabled={agotado} aria-label={`Agregar ${e.nombre}`}
                          className="inline-flex h-10 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-semibold disabled:cursor-not-allowed"
                          style={{ borderColor: `${color}66`, color }}>
                          <Plus className="h-3.5 w-3.5" /> Agregar
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {conNota ? (
            <label className="block">
              <span className="mb-1 block text-sm font-bold text-slate-900">Aclaración <span className="text-xs font-normal text-slate-400">(opcional)</span></span>
              <input value={nota} onChange={(e) => setNota(e.target.value.slice(0, 200))} placeholder="Ej.: cortada al medio"
                className="h-11 w-full rounded-xl border border-slate-200 px-3 text-base outline-none focus:border-[var(--brand)]" style={{ ["--brand" as string]: color }} />
            </label>
          ) : null}
        </div>

        {/* Pie: resumen, cantidad y agregar */}
        <div className="shrink-0 border-t border-slate-100 px-4 pt-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {texto ? <p className="mb-2 line-clamp-2 text-xs text-slate-500">{texto}</p> : null}
          {intento && problema ? <p className="mb-2 rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700" role="alert">{problema.mensaje}</p> : null}
          <div className="flex items-center gap-2">
            <div className="flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white p-0.5">
              <button type="button" onClick={() => setCantidad((c) => Math.max(1, c - 1))} disabled={cantidad <= 1} aria-label="Uno menos"
                className="grid h-10 w-10 place-items-center rounded-full text-slate-700 active:bg-slate-100 disabled:opacity-30"><Minus className="h-4 w-4" /></button>
              <span className="min-w-6 text-center text-base font-bold tabular-nums">{cantidad}</span>
              <button type="button" onClick={() => setCantidad((c) => Math.min(maxCantidad, c + 1))} disabled={cantidad >= maxCantidad} aria-label="Uno más"
                className="grid h-10 w-10 place-items-center rounded-full text-slate-700 active:bg-slate-100 disabled:opacity-30"><Plus className="h-4 w-4" /></button>
            </div>
            <button type="button" onClick={confirmar}
              className={`flex h-12 min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-4 text-base font-semibold text-white shadow-sm active:scale-[0.99] ${problema ? "opacity-70" : ""}`}
              style={{ backgroundColor: color }}>
              <span className="truncate">{textoBoton ?? "Agregar"}</span>
              <span className="shrink-0 tabular-nums">{gs(unidad * cantidad)}</span>
            </button>
          </div>
        </div>
      </div>
    </CapaModal>
  );
}
