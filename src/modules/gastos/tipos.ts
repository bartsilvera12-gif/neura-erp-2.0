/** Gastos y Servicios: tipos y helpers compartidos (cliente). */
export type EstadoGasto = "borrador" | "confirmado" | "anulado";
export type IvaTipo = "10%" | "5%" | "exenta";
export type TipoPago = "contado" | "credito";
export type MedioPagoGasto = "efectivo" | "transferencia" | "cheque" | "tarjeta" | "otro";

export const TIPOS_COMPROBANTE = [
  "Factura", "Factura Electrónica", "Factura Virtual", "Autofactura", "Boleta",
  "Nota de Débito", "Recibo", "Otro",
];

export const MEDIOS_PAGO_GASTO: { v: MedioPagoGasto; l: string }[] = [
  { v: "efectivo", l: "Efectivo (sale de la caja)" },
  { v: "transferencia", l: "Transferencia" },
  { v: "cheque", l: "Cheque" },
  { v: "tarjeta", l: "Tarjeta" },
  { v: "otro", l: "Otro" },
];
export const nombreMedioGasto = (m: string | null | undefined) =>
  m === "efectivo" ? "Efectivo" : MEDIOS_PAGO_GASTO.find((x) => x.v === m)?.l ?? (m || "—");

export const ESTADO_GASTO: Record<EstadoGasto, { t: string; c: string }> = {
  borrador: { t: "Borrador", c: "bg-slate-100 text-slate-600" },
  confirmado: { t: "Confirmado", c: "bg-emerald-50 text-emerald-700" },
  anulado: { t: "Anulado", c: "bg-rose-50 text-rose-600" },
};

/** IVA INCLUIDO (Paraguay): del monto se deduce el IVA (10 % → /11, 5 % → /21). */
export const ivaDe = (monto: number, tipo: IvaTipo) => (tipo === "10%" ? Math.round(monto / 11) : tipo === "5%" ? Math.round(monto / 21) : 0);

/** Timbrado no requerido para Recibo / Otro (la misma regla que la base). */
export const requiereTimbrado = (tipo: string | null | undefined) => !["", "recibo", "otro"].includes((tipo ?? "").trim().toLowerCase());

/** Número de comprobante con guiones automáticos 3-3-7 (001-001-0000001). */
export function formatComprobante(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 13);
  let out = d.slice(0, 3);
  if (d.length > 3) out += "-" + d.slice(3, 6);
  if (d.length > 6) out += "-" + d.slice(6, 13);
  return out;
}

export type CategoriaGasto = { id: string; nombre: string; activo?: boolean; orden?: number };

export type FilaGasto = {
  id: string;
  numero: string | null;
  estado: EstadoGasto;
  fecha: string;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  proveedor_ruc: string | null;
  tipo_comprobante: string | null;
  numero_comprobante: string | null;
  timbrado: string | null;
  descripcion: string | null;
  tipo_pago: TipoPago | null;
  medio_pago: MedioPagoGasto | null;
  fecha_vencimiento: string | null;
  total: number;
  monto_iva: number;
  tiene_comprobante: boolean;
  categorias: string | null;
  cxp: { id: string; saldo: number; pagado: number; estado: string } | null;
  anulado_motivo: string | null;
  usuario_nombre: string | null;
  created_at: string;
};

export type ListaGastos = {
  rows: FilaGasto[];
  total: number;
  total_monto: number;
  resumen: { total: number; borrador: number; confirmado: number; anulado: number };
};

export type ItemGasto = { id?: string; categoria_id: string | null; categoria_nombre?: string | null; descripcion: string; monto: number; iva_tipo: IvaTipo; monto_iva?: number };

export type DetalleGasto = {
  gasto: {
    id: string; numero: string | null; estado: EstadoGasto;
    proveedor_id: string | null; proveedor_nombre: string | null; proveedor_ruc: string | null;
    descripcion: string | null; tipo_comprobante: string | null; numero_comprobante: string | null; timbrado: string | null;
    fecha_comprobante: string | null; tipo_pago: TipoPago | null; plazo_dias: number | null; fecha_vencimiento: string | null;
    medio_pago: MedioPagoGasto | null; referencia_pago: string | null; observacion: string | null;
    total_10: number; iva_10: number; total_5: number; iva_5: number; exenta: number; subtotal: number; monto_iva: number; total: number;
    tiene_comprobante: boolean; comprobante_nombre: string | null; comprobante_mime: string | null; comprobante_size: number | null;
    usuario_nombre: string | null; created_at: string; confirmado_at: string | null; confirmado_por: string | null;
    anulado_at: string | null; anulado_por: string | null; anulado_motivo: string | null;
  };
  items: ItemGasto[];
  cxp: {
    id: string; monto: number; pagado: number; saldo: number; estado: string; vencimiento: string;
    pagos: { id: string; numero: string; fecha: string; monto: number; anulado: boolean }[];
  } | null;
  caja: { caja_id: string; numero_caja: number; monto: number; anulado: boolean } | null;
};

export const gs = (n: number | null | undefined) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
export const fechaCorta = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
