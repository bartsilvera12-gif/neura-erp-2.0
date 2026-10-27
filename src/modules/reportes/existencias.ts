/**
 * Reporte "Existencias por depósito": tipos y cálculos compartidos por la pantalla, el Excel y
 * el PDF (sin nada de servidor).
 */
import { filtrar } from "@/lib/busqueda";

export type DepositoExistencias = { id: string; nombre: string; sucursal_id: string; sucursal: string; es_principal: boolean };
export type ItemExistencias = {
  id: string; nombre: string; sku: string | null; codigo_barras: string | null; unidad_medida: string;
  categoria: string | null; tipo_producto: string | null; controla_lotes: boolean; stock_minimo: number;
  imagen_url: string | null; total: number; valor: number | null;
  /** cantidad por depósito (solo los que tienen) */
  c: Record<string, number>;
  /** valor por depósito (null sin "ver costos") */
  v: Record<string, number> | null;
};
export type ReporteExistencias = {
  generado: string;
  ver_costos: boolean;
  recetas: boolean;
  sucursal_id: string | null;
  sucursales: { id: string; nombre: string; es_principal: boolean }[];
  opciones_depositos: { id: string; nombre: string; sucursal: string }[];
  depositos: DepositoExistencias[];
  items: ItemExistencias[];
};

export type CapaCelda = {
  id: string; fecha: string; origen: "compra" | "stock_inicial" | "ajuste" | "traslado" | "anulacion" | "lote"; compra_numero: string | null; proveedor: string | null;
  documento_numero: string | null; deposito_origen: string | null; referencia: string | null;
  costo_unitario: number; compradas: number; quedan: number; valor: number; orden: number | null;
};
export type LoteCelda = {
  id: string; numero: string; vencimiento: string; vencido: boolean; dias: number; cantidad: number;
  costo_unitario: number | null; valor: number | null;
};
export type DetalleCelda = {
  producto: { id: string; nombre: string; sku: string | null };
  deposito: { id: string; nombre: string; sucursal: string };
  cantidad: number; valor: number | null; costo_promedio: number | null; ver_costos: boolean;
  controla_lotes: boolean; unidad_medida: string; stock_minimo: number; hoy: string;
  capas: CapaCelda[]; lotes: LoteCelda[];
};

/** Búsqueda inteligente (la misma de la pantalla): nombre, SKU, código de barras, categoría. */
export const buscarExistencias = (items: ItemExistencias[], q: string) =>
  filtrar(items, q, (i) => ({ principal: i.nombre, otros: [i.categoria], codigos: [i.sku, i.codigo_barras] }));

/** Totales por depósito y generales (unidades y valor) de las filas que se muestran. */
export function totalesExistencias(r: Pick<ReporteExistencias, "depositos" | "ver_costos">, items: ItemExistencias[]) {
  const porDep: Record<string, { unidades: number; valor: number }> = {};
  for (const d of r.depositos) porDep[d.id] = { unidades: 0, valor: 0 };
  let unidades = 0;
  let valor = 0;
  let bajo = 0;
  let sinStock = 0;
  for (const i of items) {
    for (const [k, q] of Object.entries(i.c)) {
      if (!porDep[k]) continue;
      porDep[k].unidades += Number(q);
      porDep[k].valor += Number(i.v?.[k] ?? 0);
    }
    unidades += Number(i.total);
    valor += Number(i.valor ?? 0);
    if (Number(i.stock_minimo) > 0 && Number(i.total) < Number(i.stock_minimo)) bajo++;
    if (Number(i.total) <= 0) sinStock++;
  }
  return { porDep, unidades, valor: r.ver_costos ? valor : null, productos: items.length, bajo, sinStock };
}

/** "dd/mm/aaaa hh:mm" de `generado` ("2026-10-27T10:21", hora de Paraguay). */
export const textoGenerado = (g: string) => `${g.slice(8, 10)}/${g.slice(5, 7)}/${g.slice(0, 4)} ${g.slice(11, 16)}`;
