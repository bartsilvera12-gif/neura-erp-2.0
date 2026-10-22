import type { TipoIva } from "@/modules/caja/lib";

/** Producto tal como lo gestiona Inventario (más campos que el de la caja). */
export type ProductoInventario = {
  id: string;
  nombre: string;
  sku: string;
  codigo_barras: string | null;
  categoria_principal_id: string | null;
  proveedor_principal_id?: string | null;
  costo_promedio: number | null;
  precio_venta: number;
  precio_mayorista: number | null;
  precio_distribuidor: number | null;
  descuento_pct: number | null;
  stock_actual: number;
  stock_minimo: number;
  unidad_medida: string;
  tipo_iva: TipoIva;
  controla_stock: boolean;
  /** lotes con vencimiento (perecibles): cada entrada lleva lote + vencimiento; salida FEFO */
  controla_lotes?: boolean;
  es_vendible: boolean;
  /** receta 68: sale en el menú QR de las mesas (viene en el detalle, no en la lista) */
  en_menu_qr?: boolean;
  activo: boolean;
  imagen_url: string | null;
  /** lista paginada de Inventario: unidades por depósito (solo los que tienen) */
  stock_depositos?: { d: string; c: number }[];
};
