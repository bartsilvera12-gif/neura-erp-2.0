/** Compras: tipos compartidos (cliente y servidor). */
export type CompraItem = {
  id: string;
  producto_id: string;
  producto_nombre: string;
  producto_sku: string | null;
  cantidad: number;
  costo_unitario_original: number;
  costo_unitario: number;
  tipo_iva: string;
  subtotal: number;
  monto_iva: number;
  total: number;
  precio_venta_nuevo: number | null;
};

export type Compra = {
  id: string;
  numero_control: string;
  proveedor_id: string;
  proveedor_nombre: string;
  fecha: string;
  fecha_factura: string | null;
  nro_timbrado: string | null;
  numero_factura: string;
  tipo_pago: "contado" | "credito";
  plazo_dias: number | null;
  vencimiento: string | null;
  moneda: "GS" | "USD";
  tipo_cambio: number;
  subtotal: number;
  monto_iva: number;
  total: number;
  estado: "registrada" | "anulada";
  observacion: string | null;
  usuario_nombre: string | null;
  anulada_at: string | null;
  anulada_por: string | null;
  anulada_motivo: string | null;
  items?: CompraItem[];
  cantidad_items?: number;
};

export const COLS_COMPRA =
  "id, numero_control, proveedor_id, proveedor_nombre, fecha, fecha_factura, nro_timbrado, numero_factura, tipo_pago, plazo_dias, vencimiento, moneda, tipo_cambio, subtotal, monto_iva, total, estado, observacion, usuario_nombre, anulada_at, anulada_por, anulada_motivo";

export const COLS_ITEM =
  "id, producto_id, producto_nombre, producto_sku, cantidad, costo_unitario_original, costo_unitario, tipo_iva, subtotal, monto_iva, total, precio_venta_nuevo";
