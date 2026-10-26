"use client";

/**
 * Inventario › Recetas › Extras (receta 73): la lista común de extras de los platos
 * ("Extra queso" = 1 feta de Queso en fetas, + Gs. 5.000). Cada plato activa los suyos en su
 * receta (pestaña Extras) con precio propio opcional y un máximo. Un extra descuenta su
 * ingrediente (materia prima o preparación) SIN merma: la cantidad cargada es lo que se descuenta.
 */
import { useMemo, useState } from "react";
import { Loader2, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { buscar } from "@/lib/busqueda";
import { clienteConfig } from "@/cliente.config";
import { BuscadorProductos } from "@/modules/compras/partes";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT, ModalDocumento } from "@/modules/inventario/ui";
import { useListaCacheada, invalidarLista } from "@/modules/inventario/lista-cache";
import { cant, gs, numero, unidadCorta, unidadSugerida, unidadesCompatibles, type ExtraComun } from "@/modules/inventario/recetas";

const TEAL = clienteConfig.color;
const URL = "/api/inventario/recetas/extras";

type Form = { id?: string; nombre: string; insumo_id: string; insumo_nombre: string; unidad_insumo: string; cantidad: string; unidad: string; precio: string; activo: boolean };

export function ExtrasComunes({ puedeEditar }: { puedeEditar: boolean }) {
  const [recarga, setRecarga] = useState(0);
  const { datos, cargando, error } = useListaCacheada<{ items: ExtraComun[] }>(URL, recarga);
  const [q, setQ] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const items = useMemo(() => {
    const l = datos?.items ?? [];
    return q.trim() ? buscar(l, q, (x) => ({ principal: x.nombre, otros: [x.insumo_nombre], codigos: [x.insumo_sku] })) : l;
  }, [datos, q]);

  function guardado() {
    invalidarLista(URL);
    setRecarga((k) => k + 1);
    setForm(null);
  }

  return (
    <div>
      <div className="flex flex-col gap-2 border-b border-slate-100 bg-slate-50/40 px-3 py-3 sm:flex-row sm:items-center sm:px-5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar extra o ingrediente…" aria-label="Buscar extras"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-10 text-sm outline-none focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)] md:h-10" />
          {q ? (
            <button type="button" onClick={() => setQ("")} aria-label="Limpiar búsqueda" className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        {puedeEditar ? (
          <button type="button" onClick={() => setForm({ nombre: "", insumo_id: "", insumo_nombre: "", unidad_insumo: "Unidad", cantidad: "", unidad: "Unidad", precio: "", activo: true })}
            className={`${BOTON_PRIMARIO} max-sm:min-h-11`} style={{ backgroundColor: TEAL }}>
            <Plus className="h-4 w-4" /> Nuevo extra
          </button>
        ) : null}
      </div>

      {cargando && !datos ? (
        <div className="py-14 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /></div>
      ) : error ? (
        <p className="px-5 py-10 text-center text-sm text-rose-600">No se pudieron cargar los extras. Probá de nuevo.</p>
      ) : items.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-700">{q ? "Ningún extra coincide" : "Todavía no hay extras"}</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">Ej.: «Extra queso» = 1 feta de Queso en fetas, + Gs. 5.000. Después activalo en la receta de cada plato (pestaña Extras).</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
          {items.map((x) => (
            <li key={x.id}>
              <button type="button" onClick={() => setForm({
                  id: x.id, nombre: x.nombre, insumo_id: x.insumo_id, insumo_nombre: x.insumo_nombre, unidad_insumo: x.unidad_insumo,
                  cantidad: String(x.cantidad).replace(".", ","), unidad: x.unidad, precio: String(Math.round(x.precio)), activo: x.activo,
                })}
                className={`flex h-full w-full flex-col rounded-xl border px-3.5 py-3 text-left transition hover:border-[var(--brand)] ${x.activo ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50 opacity-70"}`}>
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0 text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">{x.nombre}</span>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-slate-900">+ {gs(x.precio)}</span>
                </span>
                <span className="mt-0.5 text-xs text-slate-500">
                  {x.insumo_nombre}{x.es_preparacion ? " (preparación)" : ""} · {cant(x.cantidad)} {unidadCorta(x.unidad)}
                </span>
                <span className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">costo {gs(x.costo)}</span>
                  <span className={`rounded-full px-2 py-0.5 font-medium ${x.alcanza != null && x.alcanza <= 0 ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"}`}>
                    {x.alcanza == null ? "sin control de stock" : x.alcanza <= 0 ? "sin stock" : `alcanza para ${cant(x.alcanza, 0)}`}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">{x.platos} plato{x.platos === 1 ? "" : "s"}</span>
                  {!x.activo ? <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">Inactivo</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {items.length ? <p className="border-t border-slate-100 px-3 py-2.5 text-[11px] text-slate-500 sm:px-5">Tocá un extra para cambiarlo. Los platos lo activan en su receta, pestaña Extras. Un extra descuenta su cantidad tal cual (sin merma).</p> : null}

      {form ? <FormExtra inicial={form} puedeEditar={puedeEditar} platos={datos?.items.find((x) => x.id === form.id)?.platos ?? 0} onClose={() => setForm(null)} onGuardado={guardado} /> : null}
    </div>
  );
}

function FormExtra({ inicial, puedeEditar, platos, onClose, onGuardado }: { inicial: Form; puedeEditar: boolean; platos: number; onClose: () => void; onGuardado: () => void }) {
  const [f, setF] = useState<Form>(inicial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [borrar, setBorrar] = useState(false);
  const set = (c: Partial<Form>) => setF((x) => ({ ...x, ...c }));
  const ok = puedeEditar && f.nombre.trim() && f.insumo_id && numero(f.cantidad) > 0;

  async function enviar(eliminar = false) {
    setBusy(true);
    setError(null);
    try {
      if (eliminar) await apiFetch(`${URL}/${f.id}`, { method: "DELETE" });
      else {
        await apiFetch(f.id ? `${URL}/${f.id}` : URL, {
          method: f.id ? "PUT" : "POST",
          body: JSON.stringify({ nombre: f.nombre.trim(), insumo_id: f.insumo_id, cantidad: numero(f.cantidad), unidad: f.unidad, precio: Number(f.precio) || 0, activo: f.activo }),
        });
      }
      onGuardado();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <ModalDocumento ancho="max-w-lg" titulo={f.id ? f.nombre || "Extra" : "Nuevo extra"} subtitulo="Lista común: cada plato lo activa en su receta" onClose={busy ? undefined : onClose}
      footer={
        <>
          {f.id && puedeEditar ? (
            borrar ? (
              <span className="mr-auto flex flex-wrap items-center gap-2 text-xs text-rose-700">
                ¿Borrarlo?{platos ? ` Sale de ${platos} plato(s).` : ""}
                <button type="button" disabled={busy} onClick={() => void enviar(true)} className="rounded-lg bg-rose-600 px-3 py-1.5 font-semibold text-white max-sm:min-h-11">Sí, borrar</button>
                <button type="button" disabled={busy} onClick={() => setBorrar(false)} className="rounded-lg px-2 py-1.5 font-semibold text-slate-500 max-sm:min-h-11">No</button>
              </span>
            ) : (
              <button type="button" onClick={() => setBorrar(true)} className="mr-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 max-sm:min-h-11">
                <Trash2 className="h-3.5 w-3.5" /> Borrar
              </button>
            )
          ) : null}
          <button type="button" onClick={onClose} disabled={busy} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:flex-1`}>{puedeEditar ? "Cancelar" : "Cerrar"}</button>
          {puedeEditar ? (
            <button type="button" onClick={() => void enviar()} disabled={busy || !ok} className={`${BOTON_PRIMARIO} max-sm:min-h-11 max-sm:flex-[2]`} style={{ backgroundColor: TEAL }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar
            </button>
          ) : null}
        </>
      }>
      <div className="space-y-4 pb-1">
        <label className="block">
          <span className={ET}>Nombre *</span>
          <input value={f.nombre} disabled={!puedeEditar} onChange={(e) => set({ nombre: e.target.value.slice(0, 60) })} placeholder="Ej.: Extra queso" className={INPUT} />
        </label>
        <div>
          <span className={ET}>Ingrediente que descuenta *</span>
          {f.insumo_id ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
              <span className="min-w-0 font-medium text-slate-900">{f.insumo_nombre} <span className="text-xs font-normal text-slate-500">· se mide en {unidadCorta(f.unidad_insumo)}</span></span>
              {puedeEditar ? <button type="button" onClick={() => set({ insumo_id: "", insumo_nombre: "" })} className="shrink-0 text-xs font-semibold" style={{ color: TEAL }}>Cambiar</button> : null}
            </div>
          ) : (
            <BuscadorProductos tipo="materia_prima" onElegir={(p) => {
              const u = p.unidad_medida || "Unidad";
              set({ insumo_id: p.id, insumo_nombre: p.nombre, unidad_insumo: u, unidad: unidadSugerida(u), nombre: f.nombre || `Extra ${p.nombre.toLowerCase()}` });
            }} />
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={ET}>Cantidad por extra *</span>
            <input inputMode="decimal" disabled={!puedeEditar} value={f.cantidad} onChange={(e) => set({ cantidad: e.target.value.replace(/[^\d.,]/g, "") })} placeholder="0" className={`${INPUT} text-right tabular-nums`} />
          </label>
          <div>
            <span className={ET}>Unidad</span>
            <div role="radiogroup" aria-label="Unidad" className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
              {unidadesCompatibles(f.unidad_insumo).map((u) => (
                <button key={u} type="button" role="radio" aria-checked={f.unidad === u} disabled={!puedeEditar} onClick={() => set({ unidad: u })}
                  className="min-h-9 min-w-10 flex-1 rounded-lg px-2 text-sm font-semibold transition"
                  style={f.unidad === u ? { backgroundColor: "#fff", color: TEAL, boxShadow: "0 1px 2px rgba(15,23,42,.08)" } : { color: "#64748b" }}>
                  {unidadCorta(u)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <label className="block">
          <span className={ET}>Precio (Gs., con IVA)</span>
          <input inputMode="numeric" disabled={!puedeEditar} value={f.precio} onChange={(e) => set({ precio: e.target.value.replace(/\D/g, "").slice(0, 9) })} placeholder="0" className={`${INPUT} text-right tabular-nums`} />
          <span className="mt-1 block text-[11px] text-slate-400">Cada plato puede tener su propio precio para este extra.</span>
        </label>
        <button type="button" role="switch" aria-checked={f.activo} disabled={!puedeEditar} onClick={() => set({ activo: !f.activo })} className="flex min-h-10 items-center gap-2 text-sm">
          <span className="relative inline-flex h-5 w-9 shrink-0 rounded-full transition" style={{ backgroundColor: f.activo ? TEAL : "#cbd5e1" }}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${f.activo ? "left-[18px]" : "left-0.5"}`} />
          </span>
          <span className="font-semibold text-slate-700">Activo</span>
          <span className="text-xs text-slate-400">{f.activo ? "se puede elegir" : "no aparece en ningún plato"}</span>
        </button>
        <p className="text-[11px] leading-relaxed text-slate-500">Se descuenta la cantidad cargada tal cual (sin merma). Si el ingrediente es una preparación, se descuentan sus materias primas.</p>
        {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
      </div>
    </ModalDocumento>
  );
}
