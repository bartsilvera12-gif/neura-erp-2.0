"use client";

/**
 * Buscador único de Gestión del Cliente (copia del sistema actual): un solo campo que cubre
 * nombre, razón social, RUC, teléfonos, correos, documento y código interno (búsqueda
 * inteligente de la base). Dos variantes: "landing" (grande, al centro, sin cliente elegido)
 * y "toolbar" (chip compacto "<CLIENTE> CAMBIAR" + "×" con un cliente abierto).
 * Enter = primer resultado; Esc cierra.
 */
import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { TEAL, codigoCliente } from "@/modules/clientes/ui";
import type { ClienteBuscado } from "@/modules/clientes/gestion/tipos";

export function IconoLupa({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

async function buscar(q: string): Promise<ClienteBuscado[]> {
  const t = q.trim();
  // Sin texto: los primeros por nombre (como el actual, que muestra 24 ordenados).
  if (!t) return apiFetch<ClienteBuscado[]>("/api/clientes?limit=24");
  return apiFetch<ClienteBuscado[]>(`/api/clientes?q=${encodeURIComponent(t)}&limite=50`);
}

export function BuscadorCliente({ variant, seleccionado, onSelect, onClear, onCrear }: {
  variant: "landing" | "toolbar";
  /** nombre del cliente abierto (solo toolbar) */
  seleccionado?: string | null;
  onSelect: (c: ClienteBuscado) => void;
  onClear?: () => void;
  /** Si viene, la lista ofrece "Crear cliente" con lo que se buscó (alta rápida). */
  onCrear?: (texto: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState<ClienteBuscado[]>([]);
  const [resultadosDe, setResultadosDe] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Búsqueda en la base con debounce (250 ms); solo mientras el desplegable está abierto.
  useEffect(() => {
    if (!open) return;
    const t = query.trim();
    if (resultadosDe === t) return;
    let vivo = true;
    setCargando(true);
    const h = setTimeout(() => {
      buscar(t)
        .then((r) => { if (vivo) { setResultados(r); setResultadosDe(t); } })
        .catch(() => { if (vivo) { setResultados([]); setResultadosDe(t); } })
        .finally(() => { if (vivo) setCargando(false); });
    }, t ? 250 : 0);
    return () => { vivo = false; clearTimeout(h); };
  }, [open, query, resultadosDe]);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        if (variant === "toolbar") setQuery("");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open, variant]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  function elegir(c: ClienteBuscado) {
    onSelect(c);
    setOpen(false);
    setQuery("");
  }

  async function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const t = query.trim();
      // Si todavía no llegaron los resultados de lo que se escribió, se buscan ya.
      if (resultadosDe !== t) {
        try {
          const r = await buscar(t);
          if (r[0]) elegir(r[0]);
        } catch { /* sin resultados */ }
        return;
      }
      if (resultados[0]) elegir(resultados[0]);
    }
  }

  if (variant === "toolbar" && seleccionado && !open) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <button type="button" onClick={() => { setQuery(""); setOpen(true); }} title="Buscar otro cliente"
          className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left sm:min-h-0 text-xs font-medium text-slate-800 shadow-sm transition-colors hover:border-[var(--brand)]">
          <IconoLupa className="h-3.5 w-3.5 shrink-0" style={{ color: TEAL }} />
          <span className="min-w-0 truncate">{seleccionado}</span>
          <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ backgroundColor: `${TEAL}1a`, color: TEAL }}>
            Cambiar
          </span>
        </button>
        {onClear ? (
          <button type="button" onClick={onClear} title="Quitar cliente" aria-label="Quitar cliente"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 sm:h-auto sm:w-auto sm:p-1.5">
            <X className="h-3.5 w-3.5" strokeWidth={2.25} />
          </button>
        ) : null}
      </div>
    );
  }

  const shell = variant === "landing"
    ? "w-full rounded-xl border border-slate-200 bg-white shadow-sm transition focus-within:border-[var(--brand)] focus-within:ring-2 focus-within:ring-[var(--brand-100)]"
    : "w-full min-w-[200px] rounded-lg border border-slate-200 bg-white shadow-lg transition focus-within:border-[var(--brand)] focus-within:ring-2 focus-within:ring-[var(--brand-100)]";
  const t = query.trim();

  return (
    <div ref={containerRef} className={`relative ${variant === "landing" ? "mx-auto w-full max-w-2xl" : "min-w-0 flex-1"}`}>
      <div className={shell}>
        <div className="flex min-h-11 items-center gap-2 px-3 py-1 sm:min-h-0 sm:py-2.5">
          <IconoLupa className="h-4 w-4 shrink-0" style={{ color: TEAL }} />
          <input ref={inputRef} type="search" autoComplete="off" value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onKeyDown={(e) => void onKeyDown(e)}
            onFocus={() => setOpen(true)}
            placeholder="Nombre, RUC, teléfono, correo, documento, código…"
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            aria-label="Buscar cliente" />
          {query ? (
            <button type="button" onClick={() => setQuery("")}
              className="min-h-9 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-500 sm:min-h-0 transition-colors hover:bg-slate-100 hover:text-slate-800">
              Limpiar
            </button>
          ) : null}
          {variant === "toolbar" && seleccionado && open ? (
            <button type="button" onClick={() => { setOpen(false); setQuery(""); }}
              className="min-h-9 shrink-0 px-1 text-[11px] font-semibold transition-colors hover:brightness-90 sm:min-h-0 sm:px-0" style={{ color: TEAL }}>
              Listo
            </button>
          ) : null}
        </div>
      </div>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className={`max-h-[min(16rem,50dvh)] overflow-y-auto overscroll-y-contain ${cargando && resultadosDe !== t ? "opacity-60" : ""}`}>
            {resultadosDe === null ? (
              <div className="px-4 py-8 text-center text-xs text-slate-400">Buscando…</div>
            ) : resultados.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-slate-400">
                {resultadosDe ? <>Sin resultados para &ldquo;{resultadosDe}&rdquo;</> : <>Sin clientes cargados</>}
              </div>
            ) : (
              resultados.map((c, i) => (
                <button key={c.id} type="button" onClick={() => elegir(c)}
                  className="block min-h-11 w-full border-b border-slate-100 px-3 py-2 text-left transition-colors last:border-0 hover:bg-slate-50"
                  style={i === 0 && t ? { backgroundColor: `${TEAL}14` } : undefined}>
                  <p className="truncate text-xs font-semibold text-slate-900">{c.nombre}</p>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                    <span className="font-mono text-[10px] text-slate-400">{codigoCliente(c)}</span>
                    {c.razon_social && c.razon_social !== c.nombre ? <span className="text-[10px] text-slate-500">{c.razon_social}</span> : null}
                    {c.ruc ? <span className="text-[10px] text-slate-500">RUC {c.ruc}</span> : c.documento ? <span className="text-[10px] text-slate-500">Doc. {c.documento}</span> : null}
                    {c.telefono ? <span className="text-[10px] text-slate-500">{c.telefono}</span> : null}
                  </div>
                </button>
              ))
            )}
          </div>
          {onCrear ? (
            <button type="button" onClick={() => { setOpen(false); setQuery(""); onCrear(t); }}
              className="flex min-h-11 w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-xs font-semibold text-[var(--brand)] transition-colors hover:bg-[var(--brand-50)]">
              <Plus className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate">{t ? <>Crear cliente «{t}»</> : "Crear un cliente nuevo"}</span>
            </button>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] text-slate-400 [@media(pointer:coarse)]:hidden">
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5 font-mono text-[9px] leading-none">↵</kbd>
              primer resultado
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5 font-mono text-[9px] leading-none">Esc</kbd>
              cerrar
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
