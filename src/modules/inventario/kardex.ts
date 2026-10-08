/** Kardex: etiquetas compartidas (pantalla y Excel). */
export type TipoMovimiento = "ENTRADA" | "SALIDA";
export type OrigenMovimiento = "inventario_inicial" | "ajuste_manual" | "venta" | "anulacion_venta" | "compra" | "anulacion_compra";

export type Movimiento = {
  id: string;
  producto_id: string;
  producto_nombre: string | null;
  producto_sku: string | null;
  tipo: TipoMovimiento;
  cantidad: number;
  costo_unitario: number;
  origen: OrigenMovimiento;
  referencia: string | null;
  proveedor?: string | null;
  numero_factura?: string | null;
  usuario_nombre: string | null;
  fecha: string;
};

export const ORIGEN_LABEL: Record<string, string> = {
  compra: "Compra",
  venta: "Venta",
  anulacion_venta: "Anulación de venta",
  anulacion_compra: "Anulación de compra",
  ajuste_manual: "Ajuste manual",
  inventario_inicial: "Inventario inicial",
};
