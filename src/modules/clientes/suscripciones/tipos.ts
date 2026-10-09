/** Suscripciones: lo que devuelven /api/planes, /api/suscripciones y /api/clientes/[id]/facturacion. */

export type Moneda = "GS" | "USD";
export type TipoIva = "10%" | "5%" | "exenta";
export type EstadoSuscripcion = "activa" | "pausada" | "cancelada";
export type EstadoMes = "proyectada" | "emitida" | "vencida" | "pagada";
export type ModoCambioPlan = "proximo_mes" | "inmediato" | "actualizar_cuota_pendiente";

export type Plan = {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: number;
  moneda: Moneda;
  tipo_iva: TipoIva;
  activo: boolean;
  /** suscripciones no canceladas que lo usan */
  suscripciones?: number;
};

/** Un mes del "Estado de facturación". */
export type MesFacturacion = {
  periodo: string; // YYYY-MM-01
  nombre: string; // "Octubre 2026"
  venta_id: string | null;
  numero: string | null;
  monto: number;
  saldo: number | null;
  vencimiento: string;
  estado: EstadoMes;
};

/** Una suscripción del cliente con sus meses (facturacion_suscripciones). */
export type SuscripcionCliente = {
  suscripcion_id: string;
  plan: string;
  precio: number;
  moneda: Moneda;
  estado: EstadoSuscripcion;
  dia_facturacion: number;
  dia_vencimiento: number;
  fecha_inicio: string;
  duracion_meses: number | null;
  plan_pendiente: string | null;
  precio_pendiente: number | null;
  pendiente_desde: string | null;
  meses: MesFacturacion[];
};

/** Fila de la pantalla Suscripciones (listar_suscripciones). */
export type FilaSuscripcion = {
  id: string;
  cliente_id: string;
  cliente_nombre: string;
  cliente_codigo: string | null;
  plan_id: string | null;
  plan_nombre: string;
  precio: number;
  moneda: Moneda;
  tipo_iva: TipoIva;
  fecha_inicio: string;
  duracion_meses: number | null;
  dia_facturacion: number;
  dia_vencimiento: number;
  estado: EstadoSuscripcion;
  observacion: string | null;
  plan_pendiente_nombre: string | null;
  precio_pendiente: number | null;
  pendiente_desde: string | null;
  cancelada_motivo: string | null;
  cuota_venta_id: string | null;
  cuota_numero: string | null;
  cuota_estado: string | null;
  cuota_saldo: number | null;
  corresponde_mes: boolean;
};

export type KpisSuscripciones = {
  activas: number;
  pausadas: number;
  canceladas: number;
  mensual_gs: number;
  mensual_usd: number;
  por_emitir: number;
  emitidas_mes: number;
};

export type ListadoSuscripciones = { periodo: string; rows: FilaSuscripcion[]; kpis: KpisSuscripciones };

export type ResultadoEmitirMes = { periodo: string; emitidas: number; total: number; errores: { cliente: string; error: string }[] };
