"use client";

/** Piezas compartidas por Nueva compra y Nueva orden de compra. */
import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import type { ProductoInventario } from "@/modules/inventario/tipos";

const TEAL = clienteConfig.color;
export const INPUT = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
export const ET = "mb-1 block text-xs font-medium text-slate-600";
export const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
export const usd = (v: number) => `US$ ${Number(v || 0).toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const ivaDe = (importe: number, tipo: string) => (tipo === "10%" ? Math.round(importe / 11) : tipo === "5%" ? Math.round(importe / 21) : 0);

export function sumarDias(fecha: string, dias: number) {
  const d = new Date(`${fecha}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Buscador de productos con búsqueda inteligente; Enter agrega el primero (lector de códigos). */
export function BuscadorProductos({ onElegir }: { onElegir: (p: ProductoInventario) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<ProductoInventario[]>([]);
  const [hi, setHi] = useState(0);
  const [buscando, setBuscando] = useState(false);
  const [resDe, setResDe] = useState(""); // texto al que corresponden los resultados
  const ref = useRef<HTMLInputElement>(null);

  const consultar = (t: string) =>
    apiFetch<{ rows: ProductoInventario[] }>(`/api/productos?paginado=1&por_pagina=8&q=${encodeURIComponent(t)}`).then((r) => r.rows);

  // El lector de códigos tipea y manda Enter enseguida: si los resultados todavía no
  // son de lo escrito, se busca en el momento y se agrega el primero.
  async function enter() {
    const t = q.trim();
    if (!t) return;
    if (resDe === t && res[hi]) { elegir(res[hi]); return; }
    try {
      const filas = await consultar(t);
      if (filas[0]) elegir(filas[0]);
    } catch { /* sin resultados */ }
  }

  useEffect(() => {
    const t = q.trim();
    if (!t) { setRes([]); setResDe(""); return; }
    let vivo = true;
    const h = setTimeout(() => {
      setBuscando(true);
      consultar(t)
        .then((rows) => { if (vivo) { setRes(rows); setResDe(t); setHi(0); } })
        .catch(() => vivo && setRes([]))
        .finally(() => vivo && setBuscando(false));
    }, 200);
    return () => { vivo = false; clearTimeout(h); };
  }, [q]);

  function elegir(p: ProductoInventario) {
    onElegir(p);
    setQ("");
    setRes([]);
    setResDe("");
    ref.current?.focus();
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input ref={ref} value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, res.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); void enter(); }
          else if (e.key === "Escape") setQ("");
        }}
        placeholder="Buscá o escaneá un producto (nombre, SKU o código de barras)…" className={`${INPUT} pl-9`} />
      {buscando ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" /> : null}
      {res.length ? (
        <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {res.map((p, i) => (
            <li key={p.id}>
              <button type="button" onMouseEnter={() => setHi(i)} onClick={() => elegir(p)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${hi === i ? "bg-[var(--brand-50)]" : ""}`}>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-800">{p.nombre}</span>
                  <span className="font-mono text-[11px] text-slate-400">{p.sku}{p.codigo_barras ? ` · ${p.codigo_barras}` : ""}</span>
                </span>
                <span className="shrink-0 text-right text-xs text-slate-500">
                  stock {Number(p.stock_actual).toLocaleString("es-PY")}<br />costo {gs(Number(p.costo_promedio))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : q.trim() && !buscando ? <p className="mt-1 px-1 text-xs text-slate-400">Ningún producto coincide.</p> : null}
    </div>
  );
}

export function Tarjeta({ numero, titulo, extra, children }: { numero: number; titulo: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-sm font-semibold text-slate-800">
          <span className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: TEAL }}>{numero}</span>
          {titulo}
        </h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

export function Fila({ l, v }: { l: string; v: string }) {
  return <div className="flex justify-between text-slate-600"><dt>{l}</dt><dd className="tabular-nums">{v}</dd></div>;
}

export function Segmentado({ valor, onChange, opciones }: { valor: string; onChange: (v: string) => void; opciones: [string, string][] }) {
  return (
    <div className="flex rounded-xl bg-slate-100 p-1">
      {opciones.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={`flex-1 rounded-lg py-1.5 text-sm font-semibold transition ${valor === v ? "bg-white shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          style={valor === v ? { color: TEAL } : undefined}>
          {l}
        </button>
      ))}
    </div>
  );
}
