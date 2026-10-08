/** Reporte "Stock mínimo" — lado servidor (función reporte_stock_minimo de la base). */
import type { TenantDb } from "@/lib/api/tenant-db";

export type ItemStockMinimo = {
  id: string; nombre: string; sku: string | null; codigo_barras: string | null; unidad_medida: string;
  imagen_url: string | null; stock_actual: number; stock_minimo: number; faltante: number; costo: number;
  costo_reposicion: number; categoria: string | null; vendido_30d: number;
};
export type ReporteStockMinimo = {
  items: ItemStockMinimo[];
  totales: { productos: number; sin_stock: number; costo_reposicion: number; sin_costo: number };
};

const RE_UUID = /^[0-9a-f-]{36}$/i;

export function categoriaDeUrl(sp: URLSearchParams): string | null {
  const c = sp.get("categoria") ?? "";
  return c === "__sin__" || RE_UUID.test(c) ? c : null;
}

/** soloSinStock filtra después (en la base no hace falta: son pocos productos). */
export async function reporteStockMinimo(db: TenantDb, categoria: string | null, soloSinStock = false): Promise<ReporteStockMinimo> {
  const { data, error } = await db.rpc<ReporteStockMinimo>("reporte_stock_minimo", { p_categoria: categoria });
  if (error || !data) throw new Error(error?.message ?? "sin datos");
  if (!soloSinStock) return data;
  const items = data.items.filter((i) => Number(i.stock_actual) <= 0);
  return {
    items,
    totales: {
      productos: items.length,
      sin_stock: items.length,
      costo_reposicion: items.reduce((a, i) => a + Number(i.costo_reposicion), 0),
      sin_costo: items.filter((i) => !Number(i.costo)).length,
    },
  };
}
