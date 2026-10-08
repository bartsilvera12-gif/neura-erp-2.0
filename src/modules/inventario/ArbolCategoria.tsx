"use client";

/**
 * Árbol de una categoría (se despliega al tocarla en /inventario/categorias):
 * la categoría → cada subcategoría → sus productos, con SKU, stock y precio.
 * Los productos que están directo en la categoría (sin subcategoría) van en su grupo.
 */
import { useEffect, useState } from "react";
import { Loader2, Package } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import type { Categoria, tonosDe } from "@/modules/inventario/categorias";

type ProductoArbol = {
  id: string;
  nombre: string;
  sku: string;
  stock_actual: number;
  stock_minimo: number | null;
  precio_venta: number;
  unidad_medida: string | null;
  controla_stock: boolean | null;
  categoria_principal_id: string | null;
  imagen_url: string | null;
};

const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const num = (v: number) => Number(v || 0).toLocaleString("es-PY", { maximumFractionDigits: 3 });

export function ArbolCategoria({ categoria, hijas, tono }: { categoria: Categoria; hijas: Categoria[]; tono: ReturnType<typeof tonosDe> }) {
  const [productos, setProductos] = useState<ProductoArbol[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    // El filtro por categoría ya incluye a sus subcategorías.
    apiFetch<{ rows: ProductoArbol[] }>(`/api/productos?paginado=1&por_pagina=200&categoria=${categoria.id}`)
      .then((r) => vivo && setProductos(r.rows))
      .catch((e) => vivo && setError((e as Error).message));
    return () => { vivo = false; };
  }, [categoria.id]);

  if (error) return <p className="px-4 py-3 text-xs text-rose-600">{error}</p>;
  if (!productos) {
    return (
      <p className="flex items-center gap-2 px-4 py-4 text-xs text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando productos...
      </p>
    );
  }

  const directos = productos.filter((p) => p.categoria_principal_id === categoria.id);
  const grupos = [
    ...hijas.map((h) => ({ id: h.id, nombre: h.nombre, activo: h.activo, items: productos.filter((p) => p.categoria_principal_id === h.id) })),
    ...(directos.length ? [{ id: "directos", nombre: `Directo en ${categoria.nombre}`, activo: true, items: directos }] : []),
  ];

  if (grupos.length === 0) {
    return <p className="px-4 py-4 text-xs text-slate-400">Esta categoría todavía no tiene subcategorías ni productos.</p>;
  }

  return (
    <div className="space-y-3 p-4">
      {grupos.map((g, i) => {
        const ultimo = i === grupos.length - 1;
        return (
          <div key={g.id} className="relative pl-6">
            {/* Línea del árbol: baja desde la categoría y dobla hacia cada grupo */}
            <span aria-hidden className={`absolute left-1.5 top-0 w-0.5 ${ultimo ? "h-3.5" : "h-[calc(100%+0.75rem)]"}`} style={{ backgroundColor: tono.borde }} />
            <span aria-hidden className="absolute left-1.5 top-3.5 h-0.5 w-3.5" style={{ backgroundColor: tono.borde }} />

            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${g.activo ? "" : "border-dashed opacity-60"}`}
                style={{ backgroundColor: g.id === "directos" ? "transparent" : tono.fondo, borderColor: tono.borde, color: tono.texto }}
              >
                {g.nombre}
              </span>
              <span className="text-[11px] text-slate-400">{g.items.length === 1 ? "1 producto" : `${g.items.length} productos`}</span>
            </div>

            {g.items.length === 0 ? (
              <p className="mt-1.5 pl-1 text-xs text-slate-400">Sin productos todavía.</p>
            ) : (
              <ul className="mt-1.5 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
                {g.items.map((p) => {
                  const bajo = p.controla_stock !== false && Number(p.stock_minimo) > 0 && Number(p.stock_actual) < Number(p.stock_minimo);
                  return (
                    <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500">
                        {p.imagen_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.imagen_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <Package className="h-3.5 w-3.5" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">{p.nombre}</p>
                        <p className="font-mono text-[11px] text-slate-500">{p.sku}</p>
                      </div>
                      <span className={`hidden whitespace-nowrap text-xs tabular-nums sm:inline ${bajo ? "font-semibold text-rose-600" : "text-slate-500"}`}>
                        {p.controla_stock === false ? "Sin control" : `${num(p.stock_actual)} ${p.unidad_medida === "Unidad" || !p.unidad_medida ? "u." : p.unidad_medida}`}
                        {bajo ? " · stock bajo" : ""}
                      </span>
                      <span className="w-24 whitespace-nowrap text-right text-sm font-semibold tabular-nums text-slate-800">{gs(p.precio_venta)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
