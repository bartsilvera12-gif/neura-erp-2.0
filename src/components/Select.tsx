"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { clienteConfig } from "@/cliente.config";

const BRAND = clienteConfig.color;

/**
 * Dropdown elegante y animado (estilo React Bits): no es el <select> nativo, sino un
 * listbox propio con apertura suave, hover y check en el elegido. Cierra con Escape o
 * click afuera.
 * La lista se monta en <body> con position: fixed (como MenuAcciones): nunca queda cortada
 * dentro de un modal con scroll ni de una tabla; si abajo no entra, se abre hacia arriba.
 */
export function Select({
  value,
  onChange,
  options,
  minWidth,
  block = false,
  disabled = false,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  /** ancho mínimo (selects de barra/toolbar) */
  minWidth?: number;
  /** ocupa todo el ancho (campos de formulario) */
  block?: boolean;
  /** gris y sin abrir (ej. subcategoría sin categoría elegida) */
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1); // opción resaltada para el teclado
  const ref = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxH: number } | null>(null);
  const current = options.find((o) => o[0] === value) ?? options[0];

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || lista.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Posición de la lista pegada al botón; se recalcula al scrollear o cambiar el tamaño.
  const ubicar = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const margen = 8;
    const abajo = window.innerHeight - r.bottom - margen;
    const arriba = r.top - margen;
    const alto = Math.min(320, options.length * 38 + 10);
    if (abajo >= Math.min(alto, 180) || abajo >= arriba) {
      setPos({ left: r.left, width: r.width, top: r.bottom + 6, maxH: Math.max(120, abajo - 6) });
    } else {
      setPos({ left: r.left, width: r.width, bottom: window.innerHeight - r.top + 6, maxH: Math.max(120, arriba - 6) });
    }
  }, [options.length]);
  useLayoutEffect(() => {
    if (!open) return;
    ubicar();
    window.addEventListener("resize", ubicar);
    window.addEventListener("scroll", ubicar, true);
    return () => {
      window.removeEventListener("resize", ubicar);
      window.removeEventListener("scroll", ubicar, true);
    };
  }, [open, ubicar]);

  // Navegación por teclado (combobox): ↑/↓ mueven, Enter elige, Esc cierra.
  function onTriggerKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); setHi(Math.max(0, options.findIndex((o) => o[0] === value))); return; }
      setHi((h) => {
        const n = options.length;
        return e.key === "ArrowDown" ? (h + 1) % n : (h - 1 + n) % n;
      });
    } else if (e.key === "Enter" || e.key === " ") {
      if (open && hi >= 0) { e.preventDefault(); onChange(options[hi][0]); setOpen(false); }
      // si está cerrado, el click nativo del botón lo abre
    } else if (e.key === "Escape") {
      if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    }
  }

  return (
    <div ref={ref} className={`relative ${block ? "w-full" : ""} ${className}`} style={minWidth ? { minWidth } : undefined}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => { const n = !v; if (n) setHi(Math.max(0, options.findIndex((o) => o[0] === value))); return n; })}
        onKeyDown={onTriggerKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-xl border bg-white py-2.5 pl-3.5 pr-3 text-sm font-medium text-slate-600 outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:shadow-[0_0_0_4px_var(--brand-100)] disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:hover:border-slate-200"
        style={{ borderColor: open ? BRAND : "#e2e8f0", boxShadow: open ? `0 0 0 4px var(--brand-100)` : undefined }}
      >
        <span className="truncate">{current?.[1]}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && !disabled && pos && typeof document !== "undefined" ? createPortal(
        <div
          ref={lista}
          className="fixed z-[200] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-1 shadow-[0_12px_32px_-8px_rgba(2,48,71,0.25)]"
          style={{
            left: pos.left, width: Math.max(pos.width, minWidth ?? 0), top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH,
            transformOrigin: pos.top != null ? "top" : "bottom", animation: "rb-pop 0.15s cubic-bezier(0.16,1,0.3,1)",
          }}
          role="listbox"
        >
          {options.map(([v, label], idx) => {
            const sel = v === value;
            const activo = idx === hi;
            return (
              <button
                key={v}
                type="button"
                role="option"
                aria-selected={sel}
                onMouseEnter={() => setHi(idx)}
                onClick={() => { onChange(v); setOpen(false); }}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors"
                style={sel ? { backgroundColor: "var(--brand-50)", color: BRAND, fontWeight: 500 } : activo ? { backgroundColor: "#f1f5f9", color: "#475569" } : { color: "#475569" }}
              >
                <span className="truncate">{label}</span>
                {sel ? <Check className="h-4 w-4 shrink-0" /> : null}
              </button>
            );
          })}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
