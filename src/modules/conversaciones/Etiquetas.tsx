"use client";

/** Etiquetas de la conversación: chips con ✕ y alta con Enter (sugiere las ya usadas). */
import { useEffect, useRef, useState } from "react";
import { Tag, X } from "lucide-react";
import { accionConversacion } from "@/modules/conversaciones/api";
import type { FilaBandeja } from "@/modules/conversaciones/dominio";

export function EtiquetasPopover({
  conv,
  sugeridas,
  onCerrar,
  onListo,
}: {
  conv: FilaBandeja;
  sugeridas: string[];
  onCerrar: () => void;
  onListo: (f: FilaBandeja) => void;
}) {
  const [nueva, setNueva] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const cerrar = useRef(onCerrar);
  cerrar.current = onCerrar;

  useEffect(() => {
    const fuera = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && cerrar.current();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && cerrar.current();
    const t = window.setTimeout(() => document.addEventListener("mousedown", fuera), 0);
    document.addEventListener("keydown", esc);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  const guardar = async (etiquetas: string[]) => {
    setGuardando(true);
    setError(null);
    try {
      onListo(await accionConversacion(conv.id, { accion: "etiquetas", etiquetas }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  const agregar = (t: string) => {
    const v = t.trim().toLowerCase().slice(0, 40);
    if (!v || conv.etiquetas.includes(v)) return setNueva("");
    setNueva("");
    void guardar([...conv.etiquetas, v]);
  };

  const opciones = sugeridas.filter((s) => !conv.etiquetas.includes(s) && (!nueva.trim() || s.includes(nueva.trim().toLowerCase()))).slice(0, 8);

  return (
    <div ref={ref} className="absolute right-0 top-full z-40 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <Tag className="h-3.5 w-3.5" /> Etiquetas
      </p>
      <div className="mb-2 flex flex-wrap gap-1">
        {conv.etiquetas.length === 0 ? <span className="text-[11px] text-slate-400">Sin etiquetas</span> : null}
        {conv.etiquetas.map((e) => (
          <span key={e} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
            {e}
            <button type="button" disabled={guardando} onClick={() => void guardar(conv.etiquetas.filter((x) => x !== e))} aria-label={`Quitar ${e}`} className="text-indigo-400 hover:text-indigo-700">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <input
        autoFocus
        value={nueva}
        disabled={guardando}
        onChange={(e) => setNueva(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            agregar(nueva);
          }
        }}
        placeholder="Nueva etiqueta + Enter"
        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
      />
      {opciones.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {opciones.map((s) => (
            <button key={s} type="button" onClick={() => agregar(s)} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700">
              + {s}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="mt-2 text-[11px] text-red-600">{error}</p> : null}
    </div>
  );
}
