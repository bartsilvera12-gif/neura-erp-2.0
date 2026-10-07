"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Pencil, Trash2, Upload } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { ProductoForm } from "@/modules/inventario/ProductoForm";
import { Select } from "@/components/Select";
import { formatGs, type Producto } from "@/modules/caja/lib";

const TEAL = clienteConfig.color;

function margen(costo: number, precio: number) {
  if (!precio) return 0;
  return ((precio - costo) / precio) * 100;
}
function margenColor(m: number) {
  if (m >= 40) return "#16a34a";
  if (m >= 20) return "#ca8a04";
  return "#dc2626";
}

export default function InventarioPage() {
  const [todos, setTodos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState<25 | 50 | 100 | "all">(25);
  const [form, setForm] = useState<{ open: boolean; prod: Producto | null }>({ open: false, prod: null });
  const [porBorrar, setPorBorrar] = useState<Producto | null>(null);
  const [borrando, setBorrando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setTodos(await apiFetch<Producto[]>("/api/productos?scope=inventario"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const filtrados = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return todos;
    const terms = q.split(/\s+/).filter(Boolean);
    return todos.filter((p) => {
      const hay = [p.nombre, p.sku, String(p.costo_promedio), String(p.precio_venta), String(p.stock_actual), p.unidad_medida].join(" ").toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [todos, query]);

  const visibles = pageSize === "all" ? filtrados : filtrados.slice(0, pageSize);

  function exportarExcel() {
    const header = ["Nombre", "SKU", "Costo prom.", "Precio venta", "Stock", "Stock mín.", "Unidad", "IVA"];
    const filas = todos.map((p) => [p.nombre, p.sku, p.costo_promedio ?? 0, p.precio_venta, p.stock_actual, p.stock_minimo, p.unidad_medida, p.tipo_iva]);
    const csv = [header, ...filas]
      .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "inventario.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importarCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) await procesarImport(file);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function procesarImport(file: File) {
    setImportando(true);
    setAviso(null);
    try {
      const text = await file.text();
      const lineas = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
      const cab = lineas.shift()?.split(",").map((h) => h.replace(/"/g, "").trim().toLowerCase()) ?? [];
      let ok = 0;
      let fallo = 0;
      for (const linea of lineas) {
        const celdas = linea.split(",").map((c) => c.replace(/^"|"$/g, "").trim());
        const row: Record<string, string> = {};
        cab.forEach((h, i) => (row[h] = celdas[i] ?? ""));
        const nombre = row["nombre"];
        const sku = row["sku"];
        if (!nombre || !sku) { fallo++; continue; }
        try {
          await apiFetch("/api/productos", {
            method: "POST",
            body: JSON.stringify({
              nombre,
              sku,
              costo_promedio: Number(row["costo_promedio"] || row["costo prom."] || 0) || 0,
              precio_venta: Number(row["precio_venta"] || row["precio venta"] || 0) || 0,
              stock_actual: Number(row["stock_actual"] || row["stock"] || 0) || 0,
              stock_minimo: Number(row["stock_minimo"] || row["stock mín."] || 0) || 0,
              unidad_medida: row["unidad_medida"] || row["unidad"] || "Unidad",
              tipo_iva: ["EXENTA", "5%", "10%"].includes(row["tipo_iva"] || row["iva"]) ? (row["tipo_iva"] || row["iva"]) : "10%",
            }),
          });
          ok++;
        } catch {
          fallo++;
        }
      }
      setAviso(`Importación: ${ok} producto(s) cargado(s)${fallo ? `, ${fallo} con error (nombre/SKU faltante o duplicado)` : ""}.`);
      void cargar();
    } finally {
      setImportando(false);
    }
  }

  async function confirmarBorrado() {
    if (!porBorrar) return;
    setBorrando(true);
    try {
      const r = await apiFetch<{ modo: string; nombre: string }>(`/api/productos/${porBorrar.id}`, { method: "DELETE" });
      setPorBorrar(null);
      setAviso(r.modo === "eliminado" ? `${r.nombre} se borró.` : `${r.nombre} tenía ventas, así que se dio de baja: sale del listado y la caja, pero queda en los informes.`);
      void cargar();
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setBorrando(false);
    }
  }

  const inputF = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-100)]";
  const btnExcel = "inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50";

  return (
    <div className="space-y-6 pb-10">
      {/* Encabezado + acciones Excel */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Operaciones · Stock</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Inventario</h1>
          <p className="mt-1 text-sm text-slate-500">Gestión de productos y control de stock</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={exportarExcel} className={btnExcel}><Download className="h-4 w-4" /> Exportar Excel</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={importarCSV} className="hidden" />
          <button onClick={() => fileRef.current?.click()} disabled={importando} className={btnExcel}>
            <Upload className="h-4 w-4" /> {importando ? "Importando…" : "Importar Excel"}
          </button>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="block h-5 w-1 rounded-full" style={{ backgroundColor: TEAL }} />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">Productos</h2>
          </div>
          <button
            onClick={() => setForm({ open: true, prod: null })}
            className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:brightness-95"
            style={{ backgroundColor: TEAL }}
          >
            + Nuevo producto
          </button>
          <div className="relative min-w-[16rem] flex-1">
            <svg viewBox="0 0 20 20" fill="currentColor" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"><path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clipRule="evenodd" /></svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre, SKU, costo, precio, stock, unidad…" className={`${inputF} w-full pl-9`} />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Filas</label>
            <Select
              value={String(pageSize)}
              onChange={(v) => setPageSize(v === "all" ? "all" : (Number(v) as 25 | 50 | 100))}
              options={[["25", "25"], ["50", "50"], ["100", "100"], ["all", "Todo"]]}
              minWidth={90}
            />
          </div>
          <span className="text-[11px] text-slate-400">
            {cargando ? "Cargando productos…" : `${visibles.length} de ${filtrados.length} productos`}
          </span>
          <p className="hidden text-[11px] text-slate-400 xl:block">Los productos ingresan desde <span className="font-medium text-slate-500">Compras</span></p>
        </div>

        {error ? <p className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-slate-50 text-sm font-medium text-slate-600">
                <th className="py-3 pl-4 pr-4">Nombre</th>
                <th className="py-3 pr-4">SKU</th>
                <th className="py-3 pr-4">Costo Prom.</th>
                <th className="py-3 pr-4">Precio Venta</th>
                <th className="py-3 pr-4 text-center">Stock</th>
                <th className="py-3 pr-4 text-center">Stock Mín.</th>
                <th className="py-3 pr-4">Unidad</th>
                <th className="py-3 pr-4">Ubicación</th>
                <th className="py-3 pr-4 text-right">Margen s/venta</th>
                <th className="py-3 pr-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                [0, 1, 2].map((i) => (
                  <tr key={i} className="border-b border-slate-200"><td colSpan={10} className="py-4"><span className="block h-4 w-full animate-pulse rounded bg-slate-100" /></td></tr>
                ))
              ) : visibles.length === 0 ? (
                <tr><td colSpan={10} className="py-12 text-center text-slate-400">{query ? `Ningún producto coincide con “${query}”.` : "Todavía no hay productos cargados."}</td></tr>
              ) : (
                visibles.map((p) => {
                  const bajo = p.controla_stock && p.stock_actual <= p.stock_minimo;
                  const m = margen(Number(p.costo_promedio ?? 0), p.precio_venta);
                  return (
                    <tr key={p.id} className="border-b border-slate-200 last:border-0 transition-colors hover:bg-slate-50">
                      <td className="py-3 pl-4 pr-4 font-medium text-slate-800">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
                            {p.imagen_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.imagen_url} alt="" className="h-full w-full object-cover" />
                            ) : (
                              p.nombre.charAt(0).toUpperCase()
                            )}
                          </div>
                          <span>{p.nombre}</span>
                        </div>
                      </td>
                      <td className="py-4 pr-4 font-mono text-gray-500">{p.sku}</td>
                      <td className="py-4 pr-4 text-gray-700">{formatGs(Number(p.costo_promedio ?? 0))}</td>
                      <td className="py-4 pr-4 text-gray-700">{formatGs(p.precio_venta)}</td>
                      <td className="py-4 pr-4 text-center">
                        <span className="font-semibold" style={{ color: bajo ? "#dc2626" : "#1f2937" }}>{p.controla_stock ? p.stock_actual : "—"}</span>
                      </td>
                      <td className="py-4 pr-4 text-center text-gray-500">{p.controla_stock ? p.stock_minimo : "—"}</td>
                      <td className="py-4 pr-4 text-gray-600">{p.unidad_medida}</td>
                      <td className="py-4 pr-4 text-gray-300">—</td>
                      <td className="py-4 pr-4 text-right">
                        <span className="font-semibold tabular-nums" style={{ color: margenColor(m) }}>{m.toFixed(2)}%</span>
                      </td>
                      <td className="py-4 pr-4">
                        <div className="flex items-center justify-end gap-3">
                          <button onClick={() => setForm({ open: true, prod: p })} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-[var(--brand)]">
                            <Pencil className="h-3.5 w-3.5" /> Editar
                          </button>
                          <button onClick={() => setPorBorrar(p)} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-rose-600">
                            <Trash2 className="h-3.5 w-3.5" /> Borrar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {aviso ? (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          <span>{aviso}</span>
          <button onClick={() => setAviso(null)} className="shrink-0 text-xs font-medium text-slate-400 hover:text-slate-600">Cerrar</button>
        </div>
      ) : null}

      {form.open ? (
        <ProductoForm producto={form.prod} onClose={() => setForm({ open: false, prod: null })} onSaved={() => { setForm({ open: false, prod: null }); void cargar(); }} />
      ) : null}

      {porBorrar ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">Borrar producto</h2>
            <p className="mt-2 text-sm text-slate-600">¿Borrar <span className="font-semibold text-slate-900">{porBorrar.nombre}</span>? Deja de aparecer en el inventario y en la caja.</p>
            <p className="mt-2 text-xs text-slate-400">Si ya se vendió alguna vez, no se borra: se da de baja, para no dejar los informes hablando de un producto que no existe.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setPorBorrar(null)} disabled={borrando} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
              <button onClick={confirmarBorrado} disabled={borrando} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">{borrando ? "Borrando…" : "Borrar"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
