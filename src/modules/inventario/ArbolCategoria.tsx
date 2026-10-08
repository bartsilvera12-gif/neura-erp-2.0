"use client";

/**
 * Árbol de una categoría (se despliega al tocarla en /inventario/categorias): la
 * categoría → cada subcategoría con cuántos productos tiene. Los productos en sí se ven
 * en Inventario; acá solo la estructura. Si hay productos directo en la categoría (sin
 * subcategoría), se muestran como un grupo más.
 */
import type { Categoria, tonosDe } from "@/modules/inventario/categorias";

const nProductos = (n: number) => (n === 1 ? "1 producto" : `${n} productos`);

export function ArbolCategoria({ categoria, hijas, conteo, tono }: {
  categoria: Categoria;
  hijas: Categoria[];
  conteo: Record<string, number>;
  tono: ReturnType<typeof tonosDe>;
}) {
  const directos = conteo[categoria.id] ?? 0;
  const grupos = [
    ...hijas.map((h) => ({ id: h.id, nombre: h.nombre, activo: h.activo, cantidad: conteo[h.id] ?? 0, directo: false })),
    ...(directos ? [{ id: "directos", nombre: `Directo en ${categoria.nombre}`, activo: true, cantidad: directos, directo: true }] : []),
  ];

  if (grupos.length === 0) {
    return <p className="px-4 py-3 text-xs text-slate-400">Esta categoría todavía no tiene subcategorías.</p>;
  }

  return (
    <ul className="space-y-1.5 px-4 py-3">
      {grupos.map((g, i) => {
        const ultimo = i === grupos.length - 1;
        return (
          <li key={g.id} className="relative flex items-center gap-2 pl-6">
            {/* Línea del árbol: baja desde la categoría y dobla hacia cada subcategoría */}
            <span aria-hidden className={`absolute left-1.5 top-0 w-0.5 ${ultimo ? "h-1/2" : "h-[calc(100%+0.375rem)]"}`} style={{ backgroundColor: tono.borde }} />
            <span aria-hidden className="absolute left-1.5 top-1/2 h-0.5 w-3.5" style={{ backgroundColor: tono.borde }} />
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${g.activo ? "" : "border-dashed opacity-60"}`}
              style={{ backgroundColor: g.directo ? "transparent" : tono.fondo, borderColor: tono.borde, color: tono.texto }}
            >
              {g.nombre}
              {!g.activo ? <span className="ml-1 font-normal opacity-70">(inactiva)</span> : null}
            </span>
            <span className="text-xs text-slate-500">{nProductos(g.cantidad)}</span>
          </li>
        );
      })}
    </ul>
  );
}
