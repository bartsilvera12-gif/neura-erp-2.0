"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { clienteConfig } from "@/cliente.config";

const BRAND = clienteConfig.color;

/**
 * Dropdown elegante y animado (estilo React Bits): no es el <select> nativo, sino un
 * listbox propio con apertura suave, hover y check en el elegido. Cierra con Escape o
 * click afuera.
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
  const current = options.find((o) => o[0] === value) ?? options[0];

  useEffect(() => {
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

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

      {open && !disabled ? (
        <div
          className="absolute left-0 right-0 z-30 mt-1.5 origin-top rounded-xl border border-slate-200 bg-white p-1 shadow-[0_12px_32px_-8px_rgba(2,48,71,0.25)]"
          style={{ animation: "rb-pop 0.15s cubic-bezier(0.16,1,0.3,1)" }}
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
        </div>
      ) : null}
    </div>
  );
}
