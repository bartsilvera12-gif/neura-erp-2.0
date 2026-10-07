/**
 * Reporte "Ventas del período" — lado servidor: filtros desde la URL y llamadas a las
 * funciones de la base (reporte_ventas_resumen / reporte_ventas_detalle).
 */
import type { TenantDb } from "@/lib/api/tenant-db";
import { hoyPY } from "@/lib/fecha/paraguay";

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_UUID = /^[0-9a-f-]{36}$/i;
const MEDIOS = ["efectivo", "tarjeta", "pos", "transferencia", "cheque", "otro", "credito"];

export type FiltrosVentas = {
  desde: string;
  hasta: string;
  cajero: string | null;
  tipo: string | null;
  medio: string | null;
  categoria: string | null;
};

/** Sin fechas: del 1° del mes en curso hasta hoy (Paraguay). */
export function filtrosVentas(sp: URLSearchParams): FiltrosVentas {
  const hoy = hoyPY();
  let desde = RE_FECHA.test(sp.get("desde") ?? "") ? sp.get("desde")! : `${hoy.slice(0, 7)}-01`;
  let hasta = RE_FECHA.test(sp.get("hasta") ?? "") ? sp.get("hasta")! : hoy;
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  const cat = sp.get("categoria") ?? "";
  return {
    desde,
    hasta,
    cajero: RE_UUID.test(sp.get("cajero") ?? "") ? sp.get("cajero") : null,
    tipo: ["CONTADO", "CREDITO"].includes(sp.get("tipo") ?? "") ? sp.get("tipo") : null,
    medio: MEDIOS.includes(sp.get("medio") ?? "") ? sp.get("medio") : null,
    categoria: cat === "__sin__" || RE_UUID.test(cat) ? cat : null,
  };
}

const params = (f: FiltrosVentas) => ({
  p_desde: f.desde,
  p_hasta: f.hasta,
  p_cajero: f.cajero,
  p_tipo: f.tipo,
  p_medio: f.medio,
  p_categoria: f.categoria,
});

export type ResumenVentas = {
  kpis: {
    ventas_netas: number; cantidad_ventas: number; unidades: number; costo: number;
    ganancia: number; iva_total: number; productos_sin_costo: number;
  };
  iva: { tipo: string; total: number; iva: number; gravado: number }[];
  anuladas: { cantidad: number; monto: number };
  por_dia: { dia: string; ventas: number; cantidad: number; ganancia: number }[];
  por_medio: { medio: string; monto: number; ventas: number }[];
  por_cajero: { cajero_id: string | null; nombre: string; ventas: number; cantidad: number; ganancia: number; anuladas: number }[];
  productos: { producto_id: string | null; nombre: string; sku: string | null; unidades: number; monto: number; ganancia: number; sin_costo: boolean }[];
  por_categoria: { categoria_id: string | null; nombre: string; unidades: number; monto: number; ganancia: number }[];
};

export type VentaDetalle = {
  id: string; numero: string; fecha: string; tipo: string; estado: string; total: number; iva: number;
  cliente: string | null; cajero: string | null; items: number; ganancia: number; medios: string[];
};

export async function resumenVentas(db: TenantDb, f: FiltrosVentas): Promise<ResumenVentas> {
  const { data, error } = await db.rpc<ResumenVentas>("reporte_ventas_resumen", params(f));
  if (error || !data) throw new Error(error?.message ?? "sin datos");
  return data;
}

export async function detalleVentas(db: TenantDb, f: FiltrosVentas, limite: number, desde: number) {
  const { data, error } = await db.rpc<{ total: number; rows: VentaDetalle[] }>("reporte_ventas_detalle", {
    ...params(f),
    p_limit: limite,
    p_offset: desde,
  });
  if (error || !data) throw new Error(error?.message ?? "sin datos");
  return data;
}

export const MEDIO_NOMBRE: Record<string, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  pos: "POS",
  transferencia: "Transferencia",
  cheque: "Cheque",
  otro: "Otros",
  credito: "Crédito",
};

/** Texto de los filtros aplicados (para el PDF y el Excel). */
export function describirFiltros(f: FiltrosVentas, nombres: { cajero?: string | null; categoria?: string | null }) {
  const d = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  const partes = [`${d(f.desde)} al ${d(f.hasta)}`];
  if (f.cajero) partes.push(`Cajero: ${nombres.cajero ?? "—"}`);
  if (f.tipo) partes.push(f.tipo === "CREDITO" ? "Solo crédito" : "Solo contado");
  if (f.medio) partes.push(`Medio: ${MEDIO_NOMBRE[f.medio] ?? f.medio}`);
  if (f.categoria) partes.push(`Categoría: ${f.categoria === "__sin__" ? "Sin categoría" : (nombres.categoria ?? "—")}`);
  return partes.join(" · ");
}
