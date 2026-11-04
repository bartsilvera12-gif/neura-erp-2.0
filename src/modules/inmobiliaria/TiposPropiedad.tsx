"use client";

/**
 * Tipos de propiedad de la empresa (Casa, Departamento, Terreno / lote…): se agregan, se renombran,
 * se ordenan y se desactivan. Uno que ya usa alguna propiedad no se borra: queda desactivado.
 */
import { useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { Drawer } from "@/components/Drawer";
import { apiFetch } from "@/lib/api/client-fetch";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, INPUT } from "@/modules/inventario/ui";
import type { TipoPropiedad } from "@/modules/inmobiliaria/tipos";

type Fila = { id: string | null; nombre: string; activo: boolean; usos: number; clave: string };

export function TiposPropiedad({ tipos, onCerrar, onGuardados }: {
  tipos: TipoPropiedad[];
  onCerrar: () => void;
  onGuardados: (t: TipoPropiedad[]) => void;
}) {
  const [filas, setFilas] = useState<Fila[]>(tipos.map((t) => ({ ...t, clave: t.id })));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mover = (i: number, d: -1 | 1) => setFilas((f) => {
    const n = [...f];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    return n;
  });
  const cambiar = (i: number, p: Partial<Fila>) => { setFilas((f) => f.map((x, j) => (j === i ? { ...x, ...p } : x))); setError(null); };

  async function guardar() {
    if (filas.some((f) => f.nombre.trim().length < 2)) { setError("Cada tipo necesita un nombre."); return; }
    setGuardando(true);
    try {
      onGuardados(await apiFetch<TipoPropiedad[]>("/api/inmobiliaria/tipos", {
        method: "PUT",
        body: JSON.stringify(filas.map((f) => ({ id: f.id, nombre: f.nombre.trim(), activo: f.activo }))),
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Drawer
      titulo="Tipos de propiedad"
      subtitulo="Los que se eligen en cada ficha. Uno en uso no se borra: se desactiva."
      onClose={onCerrar}
      footer={
        <div className="flex w-full gap-2 sm:justify-end max-sm:[&>*]:min-h-11 max-sm:[&>*]:flex-1">
          <button type="button" onClick={onCerrar} disabled={guardando} className={BOTON_SECUNDARIO}>Cancelar</button>
          <button type="button" onClick={() => void guardar()} disabled={guardando} className={`${BOTON_PRIMARIO} bg-[var(--brand)]`}>
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
        <ul className="m-0 list-none space-y-2 p-0">
          {filas.map((f, i) => (
            <li key={f.clave} className="flex items-center gap-2">
              <div className="flex flex-col">
                <button type="button" aria-label="Subir" disabled={i === 0} onClick={() => mover(i, -1)} className="grid h-6 w-8 place-items-center rounded text-slate-400 hover:bg-slate-100 disabled:opacity-30 max-sm:h-8"><ArrowUp className="h-3.5 w-3.5" /></button>
                <button type="button" aria-label="Bajar" disabled={i === filas.length - 1} onClick={() => mover(i, 1)} className="grid h-6 w-8 place-items-center rounded text-slate-400 hover:bg-slate-100 disabled:opacity-30 max-sm:h-8"><ArrowDown className="h-3.5 w-3.5" /></button>
              </div>
              <input value={f.nombre} maxLength={60} onChange={(e) => cambiar(i, { nombre: e.target.value })} aria-label="Nombre del tipo" className={`${INPUT} min-w-0 flex-1 ${f.activo ? "" : "text-slate-400 line-through"}`} />
              {f.usos > 0 ? (
                <button type="button" onClick={() => cambiar(i, { activo: !f.activo })} className="min-h-11 shrink-0 rounded-xl px-2 text-xs font-medium text-slate-500 hover:bg-slate-100">
                  {f.activo ? "Desactivar" : "Activar"}
                </button>
              ) : (
                <button type="button" aria-label="Quitar" onClick={() => setFilas((x) => x.filter((_, j) => j !== i))} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setFilas((x) => [...x, { id: null, nombre: "", activo: true, usos: 0, clave: `n${Date.now()}` }])} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:w-full`}>
          <Plus className="h-4 w-4" /> Agregar tipo
        </button>
      </div>
    </Drawer>
  );
}
