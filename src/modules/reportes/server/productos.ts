/** Reporte "Productos vendidos" — lado servidor (funciones reporte_productos_vendidos*). */
import type { TenantDb } from "@/lib/api/tenant-db";
import { hoyPY } from "@/lib/fecha/paraguay";

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_UUID = /^[0-9a-f-]{36}$/i;

export type FiltrosProductos = {
  desde: string;
  hasta: string;
  categoria: string | null;
  producto: string | null;
  sinVentas: boolean;
};

export function filtrosProductos(sp: URLSearchParams): FiltrosProductos {
  const hoy = hoyPY();
  let desde = RE_FECHA.test(sp.get("desde") ?? "") ? sp.get("desde")! : `${hoy.slice(0, 7)}-01`;
  let hasta = RE_FECHA.test(sp.get("hasta") ?? "") ? sp.get("hasta")! : hoy;
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  const cat = sp.get("categoria") ?? "";
  return {
    desde,
    hasta,
    categoria: cat === "__sin__" || RE_UUID.test(cat) ? cat : null,
    producto: RE_UUID.test(sp.get("producto") ?? "") ? sp.get("producto") : null,
    sinVentas: sp.get("sin_ventas") === "1",
  };
}

export type ItemProducto = {
  producto_id: string | null; nombre: string; sku: string | null; categoria: string | null; unidad_medida: string | null;
  imagen_url: string | null; unidades: number; ventas: number; total: number; costo: number; ganancia: number;
  sin_costo: boolean; precio_promedio: number; stock_actual: number | null; controla_stock: boolean | null; valor_stock: number;
};
export type ResumenProductos = {
  items: ItemProducto[];
  totales: { productos_vendidos: number; productos_sin_ventas: number; unidades: number; total: number; ganancia: number; valor_stock_sin_ventas: number };
};
export type LineaProducto = {
  id: string; venta_id: string; numero: string; fecha: string; tipo: string; producto_id: string | null; producto: string;
  sku: string | null; cantidad: number; precio: number; precio_lista: number; total: number; ganancia: number;
  cajero: string | null; cliente: string | null;
};

export async function resumenProductos(db: TenantDb, f: FiltrosProductos): Promise<ResumenProductos> {
  const { data, error } = await db.rpc<ResumenProductos>("reporte_productos_vendidos", {
    p_desde: f.desde, p_hasta: f.hasta, p_categoria: f.categoria, p_producto: f.producto, p_incluir_sin_ventas: f.sinVentas,
  });
  if (error || !data) throw new Error(error?.message ?? "sin datos");
  return data;
}

export async function detalleProductos(db: TenantDb, f: FiltrosProductos, limite: number, desde: number) {
  const { data, error } = await db.rpc<{ total: number; rows: LineaProducto[] }>("reporte_productos_vendidos_detalle", {
    p_desde: f.desde, p_hasta: f.hasta, p_categoria: f.categoria, p_producto: f.producto, p_limit: limite, p_offset: desde,
  });
  if (error || !data) throw new Error(error?.message ?? "sin datos");
  return data;
}
