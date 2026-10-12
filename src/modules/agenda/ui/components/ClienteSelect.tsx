"use client";

/**
 * Selector de cliente con BUSCADOR para el formulario de cita. En el actual era un
 * desplegable con los primeros 1000 clientes; acá se busca en la base (/api/clientes?q=,
 * búsqueda inteligente: nombre, RUC, teléfono, correo…) con debounce. El panel va en un
 * portal fijo para no recortarse contra el scroll del modal.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "@/lib/api/client-fetch";

export type ClienteOpcion = { id: string; nombre: string | null; telefono?: string | null; ruc?: string | null; documento?: string | null };

export function ClienteSelect({
  valor,
  onChange,
}: {
  valor: ClienteOpcion | null;
  onChange: (c: ClienteOpcion | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<ClienteOpcion[] | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    const t = q.trim();
    const h = setTimeout(() => {
      const url = t ? `/api/clientes?q=${encodeURIComponent(t)}&limite=30` : "/api/clientes?limit=24";
      apiFetch<ClienteOpcion[]>(url)
        .then((r) => vivo && setResultados(Array.isArray(r) ? r : []))
        .catch(() => vivo && setResultados([]));
    }, t ? 250 : 0);
    return () => {
      vivo = false;
      clearTimeout(h);
    };
  }, [abierto, q]);

  useEffect(() => {
    if (!abierto) return;
    const recalcular = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (r) setPos({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    recalcular();
    window.addEventListener("scroll", recalcular, true);
    window.addEventListener("resize", recalcular);
    return () => {
      window.removeEventListener("scroll", recalcular, true);
      window.removeEventListener("resize", recalcular);
    };
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    const alClickear = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if ((t as HTMLElement).closest?.("[data-cliente-panel]")) return;
      setAbierto(false);
      setQ("");
    };
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setAbierto(false);
        setQ("");
      }
    };
    document.addEventListener("mousedown", alClickear);
    document.addEventListener("keydown", alTeclear, true);
    return () => {
      document.removeEventListener("mousedown", alClickear);
      document.removeEventListener("keydown", alTeclear, true);
    };
  }, [abierto]);

  useEffect(() => {
    if (abierto) inputRef.current?.focus();
  }, [abierto]);

  function elegir(c: ClienteOpcion | null) {
    onChange(c);
    setAbierto(false);
    setQ("");
  }

  const panel =
    abierto && pos
      ? createPortal(
          <div
            data-cliente-panel=""
            className="z-[70] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
            style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width }}
          >
            <div className="border-b border-slate-100 p-2">
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (resultados?.[0]) elegir(resultados[0]);
                  }
                }}
                placeholder="Buscar por nombre, RUC, teléfono…"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
              />
            </div>
            <ul className="max-h-56 overflow-y-auto py-1">
              <li>
                <button type="button" onClick={() => elegir(null)} className="flex w-full px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50">
                  — Sin cliente —
                </button>
              </li>
              {resultados === null ? (
                <li className="px-3 py-3 text-center text-xs text-slate-400">Buscando…</li>
              ) : resultados.length === 0 ? (
                <li className="px-3 py-3 text-center text-xs text-slate-400">Sin coincidencias.</li>
              ) : (
                resultados.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => elegir(c)}
                      className={`flex w-full flex-col px-3 py-2 text-left transition-colors hover:bg-slate-50 ${valor?.id === c.id ? "bg-[#4FAEB2]/10" : ""}`}
                    >
                      <span className="truncate text-sm text-slate-800">{c.nombre ?? c.id}</span>
                      {c.ruc || c.documento || c.telefono ? (
                        <span className="truncate text-[11px] text-slate-400">
                          {[c.ruc ? `RUC ${c.ruc}` : c.documento ? `Doc. ${c.documento}` : null, c.telefono].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-label="Cliente"
        className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left text-sm shadow-sm transition-colors hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
      >
        <span className={`min-w-0 flex-1 truncate ${valor ? "text-slate-900" : "text-slate-400"}`}>{valor ? valor.nombre ?? valor.id : "— Sin cliente —"}</span>
        <span aria-hidden="true" className={`shrink-0 text-slate-400 transition-transform ${abierto ? "rotate-180" : ""}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {panel}
    </div>
  );
}
