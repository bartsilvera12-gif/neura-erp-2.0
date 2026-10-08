"use client";

/**
 * Selector de proveedor con búsqueda inteligente: escribís parte del nombre, RUC o
 * vendedor y elegís. Si no existe, "+ Crear proveedor «X»" lo da de alta ahí mismo
 * (solo con la razón social; el resto se completa después en Proveedores).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Truck, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { buscar } from "@/lib/busqueda";
import { nombreProveedor, type ProveedorMin as ProvMin } from "@/modules/proveedores/tipos";
// Una sola carga por pantalla aunque haya varios selectores (cache compartido con las
// pantallas de Compras: /api/proveedores?min=1).
import { cargarProveedores } from "@/modules/proveedores/cache";

export function SelectorProveedor({
  value,
  onChange,
  placeholder = "Buscar o crear proveedor…",
  permitirCrear = true,
}: {
  value: string | null;
  onChange: (id: string | null, nombre: string | null) => void;
  placeholder?: string;
  permitirCrear?: boolean;
}) {
  const [lista, setLista] = useState<ProvMin[]>([]);
  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [hi, setHi] = useState(0);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { void cargarProveedores().then(setLista); }, []);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setAbierto(false);
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  const elegido = lista.find((p) => p.id === value) ?? null;
  const resultados = useMemo(() => {
    const activos = lista.filter((p) => p.activo);
    const r = texto.trim()
      ? buscar(activos, texto, (p) => ({ principal: nombreProveedor(p), otros: [p.nombre, p.contacto], codigos: [p.ruc] }))
      : activos;
    return r.slice(0, 8);
  }, [lista, texto]);
  const exacto = resultados.some((p) => nombreProveedor(p).toLowerCase() === texto.trim().toLowerCase() || p.nombre.toLowerCase() === texto.trim().toLowerCase());
  const puedeCrear = permitirCrear && texto.trim().length >= 2 && !exacto;
  const opciones = resultados.length + (puedeCrear ? 1 : 0);

  function elegir(p: ProvMin) {
    onChange(p.id, nombreProveedor(p));
    setTexto("");
    setAbierto(false);
  }

  async function crear() {
    const nombre = texto.trim();
    if (!nombre) return;
    setCreando(true);
    setError(null);
    try {
      const r = await apiFetch<{ id: string }>("/api/proveedores", { method: "POST", body: JSON.stringify({ nombre }) });
      const nuevos = await cargarProveedores(true);
      setLista(nuevos);
      onChange(r.id, nombre);
      setTexto("");
      setAbierto(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreando(false);
    }
  }

  if (elegido) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2">
        <Truck className="h-4 w-4 shrink-0 text-slate-400" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-800">{nombreProveedor(elegido)}</p>
          {elegido.ruc ? <p className="font-mono text-[11px] text-slate-400">RUC {elegido.ruc}</p> : null}
        </div>
        <button type="button" onClick={() => onChange(null, null)} aria-label="Quitar proveedor" className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-slate-700">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <input
        value={texto}
        onChange={(e) => { setTexto(e.target.value); setAbierto(true); setHi(0); }}
        onFocus={() => setAbierto(true)}
        onKeyDown={(e) => {
          if (!abierto) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, opciones - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") {
            e.preventDefault();
            if (hi < resultados.length && resultados[hi]) elegir(resultados[hi]);
            else if (puedeCrear) void crear();
          } else if (e.key === "Escape") setAbierto(false);
        }}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]"
      />
      {abierto && opciones > 0 ? (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {resultados.map((p, i) => (
            <li key={p.id}>
              <button type="button" onMouseEnter={() => setHi(i)} onClick={() => elegir(p)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${hi === i ? "bg-[var(--brand-50)]" : ""}`}>
                <span className="min-w-0 truncate font-medium text-slate-800">{nombreProveedor(p)}</span>
                {p.ruc ? <span className="shrink-0 font-mono text-[11px] text-slate-400">{p.ruc}</span> : null}
              </button>
            </li>
          ))}
          {puedeCrear ? (
            <li>
              <button type="button" onMouseEnter={() => setHi(resultados.length)} onClick={() => void crear()} disabled={creando}
                className={`flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-sm font-semibold text-[var(--brand)] ${hi === resultados.length ? "bg-[var(--brand-50)]" : ""}`}>
                {creando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Crear proveedor «{texto.trim()}»
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
