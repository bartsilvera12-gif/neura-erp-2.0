/** Categorías de productos: tipos y helpers compartidos (cliente y servidor). */
export type Categoria = {
  id: string;
  nombre: string;
  codigo: string | null;
  descripcion: string | null;
  parent_id: string | null;
  activo: boolean;
};

export const COLS_CATEGORIA = "id, nombre, codigo, descripcion, parent_id, activo, created_at, updated_at";

/** Código a partir del nombre: minúsculas, sin acentos, _ como separador (máx. 60). */
export function slugCodigo(nombre: string): string {
  const s = nombre.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return s || "categoria";
}

/**
 * Color consistente por categoría (hash del nombre): cada categoría queda con el suyo
 * y el ojo agrupa rápido la columna. Paleta de Ferretería.
 */
const PALETA = [
  { dot: "#0ea5e9", bg: "#f0f9ff" }, { dot: "#10b981", bg: "#ecfdf5" }, { dot: "#f59e0b", bg: "#fffbeb" },
  { dot: "#8b5cf6", bg: "#f5f3ff" }, { dot: "#ec4899", bg: "#fdf2f8" }, { dot: "#06b6d4", bg: "#ecfeff" },
  { dot: "#ef4444", bg: "#fef2f2" }, { dot: "#14b8a6", bg: "#f0fdfa" }, { dot: "#a855f7", bg: "#faf5ff" },
  { dot: "#f97316", bg: "#fff7ed" }, { dot: "#84cc16", bg: "#f7fee7" }, { dot: "#6366f1", bg: "#eef2ff" },
];
export function colorCategoria(nombre: string) {
  let h = 0;
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) >>> 0;
  return PALETA[h % PALETA.length];
}

/**
 * Subcategorías: el producto apunta a la hoja (subcategoría si tiene, si no la categoría).
 * Devuelve la categoría madre y la subcategoría de un id.
 */
export function partesCategoria(id: string | null | undefined, porId: Map<string, Categoria>) {
  const c = id ? porId.get(id) : undefined;
  if (!c) return { madre: undefined, sub: undefined };
  const madre = c.parent_id ? porId.get(c.parent_id) : undefined;
  return madre ? { madre, sub: c } : { madre: c, sub: undefined };
}

/** "Bebidas › Gaseosas" (o solo "Bebidas" si no tiene subcategoría). */
export function rutaCategoria(id: string | null | undefined, porId: Map<string, Categoria>) {
  const { madre, sub } = partesCategoria(id, porId);
  if (!madre) return undefined;
  return sub ? `${madre.nombre} › ${sub.nombre}` : madre.nombre;
}

/** Opciones de filtro: cada categoría seguida de sus subcategorías ("Bebidas › Gaseosas").
 *  Filtrar por la categoría incluye también a sus subcategorías. */
export function opcionesFiltroCategoria(categorias: Categoria[]): [string, string][] {
  const orden = [...categorias].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return orden.filter((c) => !c.parent_id).flatMap((m): [string, string][] => [
    [m.id, m.nombre],
    ...orden.filter((c) => c.parent_id === m.id).map((c): [string, string] => [c.id, `${m.nombre} › ${c.nombre}`]),
  ]);
}
