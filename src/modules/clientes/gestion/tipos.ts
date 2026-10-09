/** Gestión del Cliente: lo que devuelven /api/clientes/[id]/documentos y el buscador. */

export type TipoDocumento = "suscripcion" | "credito" | "contado";
export type EstadoDocumento = "pagado" | "pendiente" | "parcial" | "vencido" | "anulado";

/** Una venta del cliente (contado, crédito o cuota de suscripción) — documentos_cliente.rows */
export type DocumentoCliente = {
  id: string;
  numero: string;
  tipo: TipoDocumento;
  tipo_venta: "CONTADO" | "CREDITO";
  estado_venta: string;
  moneda: "GS" | "USD" | string;
  monto: number;
  emision: string; // YYYY-MM-DD
  vencimiento: string | null; // YYYY-MM-DD (solo crédito / cuotas)
  saldo: number;
  dias_mora: number;
  estado: EstadoDocumento;
  pago_registrado: string | null; // YYYY-MM-DD
  recibos: number;
  periodo_nombre: string | null;
  suscripcion_id: string | null;
  cxc_id: string | null;
};

export type KpisDocumentos = {
  documentos: number;
  monto_total: number;
  saldo_pendiente: number;
  vencidas: number;
  pendientes: number;
  pagadas: number;
  anuladas: number;
};

export type Documentos = { rows: DocumentoCliente[]; kpis: KpisDocumentos | null };

/** Filtros del panel "Filtros facturas" (como en el sistema actual). */
export type FiltrosDocumentos = {
  emision_desde: string;
  emision_hasta: string;
  venc_desde: string;
  venc_hasta: string;
  incluir_saldo_cero: boolean;
  incluir_contado: boolean;
  moneda: "" | "GS" | "USD";
};

export const FILTROS_VACIOS: FiltrosDocumentos = {
  emision_desde: "",
  emision_hasta: "",
  venc_desde: "",
  venc_hasta: "",
  incluir_saldo_cero: true,
  incluir_contado: true,
  moneda: "",
};

/** Fila del buscador (/api/clientes?q= y ?limit=). */
export type ClienteBuscado = {
  id: string;
  codigo?: string | null;
  nombre: string;
  razon_social?: string | null;
  ruc?: string | null;
  documento?: string | null;
  telefono?: string | null;
};
