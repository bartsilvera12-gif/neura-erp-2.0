"use client";

/** /comedor/cantina — Cargar productos extra a la cuenta del funcionario (descuenta subsidio → excedente). */
import { useCallback, useEffect, useMemo, useState } from "react";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { apiFetch } from "@/lib/api/client-fetch";
import { Check, Loader2, Minus, Plus, Search, Trash2, UserRound } from "lucide-react";

type Saldo = { subsidio: number; disponible: number; excedente: number };
type Funcionario = { funcionario: { id: string; nombre: string }; saldo: Saldo };
type Producto = { id: string; nombre: string; precio_venta: number };
type Linea = { producto: Producto; cantidad: number };

const gs = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-PY");

export default function CantinaPage() {
  const [documento, setDocumento] = useState("");
  const [func, setFunc] = useState<Funcionario | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [q, setQ] = useState("");
  const [cesta, setCesta] = useState<Linea[]>([]);
  const [registrando, setRegistrando] = useState(false);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    void apiFetch<Producto[]>("/api/productos?pos=1").then((p) => setProductos(p)).catch(() => {});
  }, []);

  const buscar = useCallback(async () => {
    setBuscando(true); setError(null); setListo(false);
    try {
      setFunc(await apiFetch<Funcionario>(`/api/comedor/cantina?documento=${encodeURIComponent(documento.trim())}`));
      setCesta([]);
    } catch (e) { setError((e as Error).message); setFunc(null); }
    finally { setBuscando(false); }
  }, [documento]);

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return productos.slice(0, 12);
    return productos.filter((p) => p.nombre.toLowerCase().includes(t)).slice(0, 20);
  }, [q, productos]);

  const agregar = (p: Producto) => setCesta((c) => {
    const i = c.findIndex((l) => l.producto.id === p.id);
    if (i >= 0) { const n = [...c]; n[i] = { ...n[i], cantidad: n[i].cantidad + 1 }; return n; }
    return [...c, { producto: p, cantidad: 1 }];
  });
  const cambiar = (id: string, delta: number) => setCesta((c) => c.flatMap((l) => l.producto.id === id ? (l.cantidad + delta <= 0 ? [] : [{ ...l, cantidad: l.cantidad + delta }]) : [l]));
  const total = cesta.reduce((a, l) => a + l.producto.precio_venta * l.cantidad, 0);

  async function registrar() {
    if (!func || !cesta.length) return;
    setRegistrando(true); setError(null);
    try {
      const r = await apiFetch<{ saldo: Saldo }>("/api/comedor/cantina", {
        method: "POST",
        body: JSON.stringify({ funcionario_id: func.funcionario.id, items: cesta.map((l) => ({ producto_id: l.producto.id, cantidad: l.cantidad })) }),
      });
      setFunc({ ...func, saldo: r.saldo });
      setCesta([]); setListo(true);
    } catch (e) { setError((e as Error).message); }
    finally { setRegistrando(false); }
  }

  return (
    <div className="space-y-5">
      <EncabezadoPagina kicker="Comedor" titulo="Cantina" subtitulo="Cargá productos a la cuenta del funcionario. Descuenta su subsidio del mes; lo que pasa, queda como excedente." volver={{ href: "/comedor/panel", label: "Comedor" }} />

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      {/* Identificar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-medium text-slate-700">Cédula del funcionario</label>
        <div className="mt-2 flex gap-2">
          <input value={documento} inputMode="numeric" onChange={(e) => setDocumento(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && documento.trim().length >= 3) void buscar(); }} placeholder="Cédula (sin puntos)" className="min-h-11 w-full rounded-xl border border-slate-200 px-4 text-base outline-none focus:border-[var(--brand)] sm:max-w-xs" />
          <button onClick={() => void buscar()} disabled={buscando || documento.trim().length < 3} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-[var(--brand)] px-5 text-sm font-semibold text-white disabled:opacity-50">
            {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Buscar
          </button>
        </div>
      </div>

      {func ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 min-w-0">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--brand-50)] text-[var(--brand)]"><UserRound className="h-5 w-5" /></span>
              <p className="truncate font-semibold text-slate-800">{func.funcionario.nombre}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Saldo del mes</p>
              <p className="font-semibold tabular-nums text-[var(--brand-700)]">Gs {gs(func.saldo.disponible)}</p>
            </div>
          </div>

          {listo ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-700">✓ Cargado. Saldo actualizado.</div> : null}

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Productos */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto…" className="min-h-10 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-[var(--brand)]" />
              </div>
              <div className="max-h-80 space-y-1 overflow-y-auto">
                {filtrados.map((p) => (
                  <button key={p.id} onClick={() => agregar(p)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-left text-sm transition hover:border-[var(--brand)]/50 hover:bg-[var(--brand-50)]">
                    <span className="min-w-0 truncate text-slate-700">{p.nombre}</span>
                    <span className="shrink-0 tabular-nums text-slate-500">Gs {gs(p.precio_venta)}</span>
                  </button>
                ))}
                {filtrados.length === 0 ? <p className="py-4 text-center text-sm text-slate-400">Sin resultados.</p> : null}
              </div>
            </div>

            {/* Cesta */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">A cargar</h2>
              {cesta.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">Tocá un producto para agregarlo.</p>
              ) : (
                <div className="space-y-2">
                  {cesta.map((l) => (
                    <div key={l.producto.id} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{l.producto.nombre}</span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => cambiar(l.producto.id, -1)} className="grid h-7 w-7 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50"><Minus className="h-3.5 w-3.5" /></button>
                        <span className="w-6 text-center text-sm tabular-nums">{l.cantidad}</span>
                        <button onClick={() => cambiar(l.producto.id, 1)} className="grid h-7 w-7 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50"><Plus className="h-3.5 w-3.5" /></button>
                      </div>
                      <span className="w-20 shrink-0 text-right text-sm tabular-nums text-slate-600">Gs {gs(l.producto.precio_venta * l.cantidad)}</span>
                      <button onClick={() => cambiar(l.producto.id, -l.cantidad)} aria-label="Quitar" className="text-slate-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-sm font-semibold text-slate-800"><span>Total</span><span className="tabular-nums">Gs {gs(total)}</span></div>
                </div>
              )}
              <button onClick={registrar} disabled={registrando || cesta.length === 0} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] text-base font-semibold text-white disabled:opacity-50">
                {registrando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />} Cargar a la cuenta
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
