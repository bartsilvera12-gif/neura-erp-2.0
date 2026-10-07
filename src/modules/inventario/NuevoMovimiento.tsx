"use client";

/**
 * Panel lateral "Nuevo movimiento" (portado de Ferretería, adaptado al 2.0):
 * entrada, salida o AJUSTE POR CONTEO (se ingresa el stock real contado y se registra la
 * diferencia). Vista previa del impacto antes de guardar. Stock + kardex van atómicos en
 * la base (registrar_movimiento_stock); una entrada por compra recalcula el costo promedio.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, ClipboardCheck, Loader2, Search, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { Drawer } from "@/components/Drawer";
import { Select } from "@/components/Select";
import MontoInput from "@/components/ui/MontoInput";
import { parseNumero } from "@/lib/imports/consolidacion-productos";

const BRAND = clienteConfig.color;
const INPUT = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
const ET = "mb-1 block text-xs font-medium text-slate-600";

type Prod = { id: string; nombre: string; sku: string; stock_actual: number; costo_promedio: number | null; unidad_medida: string; controla_stock: boolean; imagen_url: string | null };
type Tipo = "ENTRADA" | "SALIDA" | "AJUSTE";

const fmt = (n: number) => Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });
// "1,5" → 1,5 · "1.000" → 1000 · "2.5" → 2,5 (mismo criterio que la importación).
const numero = (s: string) => parseNumero(s) ?? NaN;

const TIPOS: { v: Tipo; l: string; d: string; icono: typeof ArrowDownToLine }[] = [
  { v: "ENTRADA", l: "Entrada", d: "Aumenta el stock", icono: ArrowDownToLine },
  { v: "SALIDA", l: "Salida", d: "Disminuye el stock", icono: ArrowUpFromLine },
  { v: "AJUSTE", l: "Ajuste por conteo", d: "Ingresás el stock real", icono: ClipboardCheck },
];

export function NuevoMovimiento({ productoInicial, onClose, onGuardado }: { productoInicial?: string; onClose: () => void; onGuardado: () => void }) {
  const [prod, setProd] = useState<Prod | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<Prod[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [tipo, setTipo] = useState<Tipo>("ENTRADA");
  const [origen, setOrigen] = useState<"compra" | "ajuste_manual">("compra");
  const [cantidad, setCantidad] = useState("");
  const [costo, setCosto] = useState(0);
  const [referencia, setReferencia] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buscarRef = useRef<HTMLInputElement>(null);

  // Producto precargado (viene del historial de un producto).
  useEffect(() => {
    if (!productoInicial) return;
    apiFetch<Prod>(`/api/productos/${productoInicial}`).then(elegir).catch(() => {});
  }, [productoInicial]);

  // Búsqueda de productos (debounce 250 ms), solo los que controlan stock.
  useEffect(() => {
    if (prod) return;
    const q = busqueda.trim();
    if (!q) { setResultados([]); return; }
    const t = setTimeout(() => {
      setBuscando(true);
      apiFetch<{ rows: Prod[] }>(`/api/productos?paginado=1&por_pagina=10&q=${encodeURIComponent(q)}`)
        .then((r) => setResultados(r.rows))
        .catch(() => setResultados([]))
        .finally(() => setBuscando(false));
    }, 250);
    return () => clearTimeout(t);
  }, [busqueda, prod]);

  function elegir(p: Prod) {
    setProd(p);
    setCosto(Number(p.costo_promedio) || 0);
    setResultados([]);
    setBusqueda("");
  }

  function cambiarTipo(t: Tipo) {
    setTipo(t);
    setOrigen(t === "ENTRADA" ? "compra" : "ajuste_manual");
  }

  const cant = cantidad === "" ? NaN : numero(cantidad);
  const stock = Number(prod?.stock_actual ?? 0);
  const delta = !prod || !Number.isFinite(cant) ? null : tipo === "ENTRADA" ? cant : tipo === "SALIDA" ? -cant : cant - stock;
  const resultante = delta == null ? null : stock + delta;
  const invalido =
    !prod || !prod.controla_stock || delta == null || cant < 0 || (tipo !== "AJUSTE" && cant <= 0) || delta === 0 || (resultante ?? 0) < 0;
  const motivoInvalido =
    !prod ? null
    : !prod.controla_stock ? "Este producto no controla stock."
    : delta === 0 && tipo === "AJUSTE" ? "El stock contado es igual al actual: no hay nada que ajustar."
    : resultante != null && resultante < 0 ? `No hay stock suficiente: hay ${fmt(stock)}.`
    : null;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (invalido || !prod) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/inventario/movimientos", {
        method: "POST",
        body: JSON.stringify({
          producto_id: prod.id,
          tipo,
          cantidad: cant,
          costo_unitario: tipo === "ENTRADA" ? costo : 0,
          origen,
          referencia: referencia.trim() || null,
        }),
      });
      onGuardado();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Drawer
      titulo="Nuevo movimiento"
      subtitulo="Registrá una entrada, salida o ajuste de stock"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button type="submit" form="mov-form" disabled={busy || invalido} className="inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-40" style={{ backgroundColor: BRAND }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? "Guardando…" : "Guardar movimiento"}
          </button>
        </>
      }
    >
      <form id="mov-form" onSubmit={guardar} className="space-y-5">
        {/* Producto */}
        <div>
          <span className={ET}>Producto</span>
          {prod ? (
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white text-xs font-semibold text-slate-500">
                {prod.imagen_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={prod.imagen_url} alt="" className="h-full w-full object-contain" />
                ) : (
                  prod.nombre.charAt(0).toUpperCase()
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{prod.nombre}</p>
                <p className="text-xs text-slate-500"><span className="font-mono">{prod.sku}</span> · stock actual {fmt(stock)} {prod.unidad_medida}</p>
              </div>
              <button type="button" onClick={() => { setProd(null); setTimeout(() => buscarRef.current?.focus(), 0); }} aria-label="Cambiar producto" className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input ref={buscarRef} autoFocus value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre, SKU o código de barras…" className={`${INPUT} pl-9`} />
              {buscando ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" /> : null}
              {resultados.length ? (
                <ul className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  {resultados.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => elegir(p)} disabled={!p.controla_stock} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-[var(--brand-50)] disabled:cursor-not-allowed disabled:opacity-50">
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-800">{p.nombre}</span>
                          <span className="font-mono text-[11px] text-slate-400">{p.sku}</span>
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-slate-500">{p.controla_stock ? `${fmt(Number(p.stock_actual))} ${p.unidad_medida}` : "sin control de stock"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : busqueda.trim() && !buscando ? (
                <p className="mt-1 px-1 text-xs text-slate-400">Ningún producto coincide.</p>
              ) : null}
            </div>
          )}
        </div>

        {/* Tipo */}
        <div>
          <span className={ET}>Tipo de movimiento</span>
          <div className="grid grid-cols-3 gap-2">
            {TIPOS.map(({ v, l, d, icono: Icono }) => {
              const sel = tipo === v;
              return (
                <button key={v} type="button" onClick={() => cambiarTipo(v)} className="rounded-xl border px-3 py-2.5 text-left transition"
                  style={sel ? { borderColor: BRAND, backgroundColor: "var(--brand-50)" } : { borderColor: "#e2e8f0" }}>
                  <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: sel ? BRAND : "#334155" }}>
                    <Icono className="h-4 w-4" /> {l}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-slate-400">{d}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={ET}>{tipo === "AJUSTE" ? "Stock real contado" : "Cantidad"}</span>
            <input inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value.replace(/[^\d.,]/g, ""))} placeholder={tipo === "AJUSTE" ? `Ej: ${fmt(stock)}` : "Ej: 10"} className={`${INPUT} text-right tabular-nums`} />
          </label>
          {tipo === "ENTRADA" ? (
            <label className="block">
              <span className={ET}>Origen</span>
              <Select value={origen} onChange={(v) => setOrigen(v as "compra" | "ajuste_manual")} block options={[["compra", "Compra"], ["ajuste_manual", "Ajuste manual"]]} />
            </label>
          ) : (
            <div>
              <span className={ET}>Origen</span>
              <p className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm text-slate-500">Ajuste manual</p>
            </div>
          )}
        </div>

        {tipo === "ENTRADA" ? (
          <label className="block">
            <span className={ET}>Costo unitario (Gs.) {origen === "compra" ? <span className="font-normal text-slate-400">— recalcula el costo promedio</span> : null}</span>
            <MontoInput value={costo} onChange={setCosto} className={`${INPUT} text-right tabular-nums`} placeholder="0" />
          </label>
        ) : null}

        <label className="block">
          <span className={ET}>Motivo / referencia <span className="font-normal text-slate-400">(opcional)</span></span>
          <input value={referencia} onChange={(e) => setReferencia(e.target.value)} maxLength={150} placeholder={tipo === "ENTRADA" ? "Ej: Factura 001-001-0000123" : tipo === "SALIDA" ? "Ej: Rotura, vencimiento, consumo interno" : "Ej: Inventario de fin de mes"} className={INPUT} />
        </label>

        {/* Vista previa del impacto */}
        {prod && delta != null && !Number.isNaN(delta) ? (
          <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Vista previa del impacto</p>
            <div className="flex justify-between text-slate-600">
              <span>Stock actual</span>
              <span className="font-semibold tabular-nums">{fmt(stock)} {prod.unidad_medida}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>{tipo === "AJUSTE" ? "Diferencia del conteo" : tipo === "ENTRADA" ? "Entrada" : "Salida"}</span>
              <span className={`font-semibold tabular-nums ${delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-600" : "text-slate-500"}`}>
                {delta > 0 ? "+" : delta < 0 ? "−" : ""}{fmt(Math.abs(delta))}
              </span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold text-slate-900">
              <span>Stock resultante</span>
              <span className={`tabular-nums ${resultante != null && resultante < 0 ? "text-red-600" : ""}`}>{fmt(resultante ?? 0)} {prod.unidad_medida}</span>
            </div>
            {motivoInvalido ? <p className="pt-1 text-xs font-medium text-red-600">{motivoInvalido}</p> : null}
          </div>
        ) : null}

        <p className="text-xs text-slate-400">La fecha, la hora y el usuario se registran automáticamente al guardar.</p>
        {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
      </form>
    </Drawer>
  );
}
