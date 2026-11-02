/** Comisiones (receta 115): lo que devuelve comisiones_datos y lo que recibe la pantalla. */

export type Origen = "auto" | "factura" | "override_incluir" | "override_excluir";
export type BaseCalculo = "pago_registrado" | "factura_emitida" | "factura_pagada";

export type Escala = { orden: number; desde_monto: number; hasta_monto: number | null; porcentaje_comision: number; premio_fijo: number | null };

export type LineaDatos = {
  tipo: "pago" | "nota_credito" | "factura_emitida" | "factura_pagada";
  cliente_id: string | null;
  cliente_label: string;
  factura_id: string;
  numero_factura: string | null;
  pago_id: string | null;
  fecha: string | null;
  monto_base: number;
  cobrado_periodo: number;
  saldo_pendiente: number;
  pendiente_por_comisionar: number;
  comisionable: boolean | null;
  tiene_suscripcion: boolean;
  cliente_alta: string | null;
  factura_monto_total: number;
  vendedor_usuario_id: string | null;
  monto_suscripcion: number | null;
};

export type ACobrarDatos = {
  cliente_id: string;
  cliente_label: string;
  factura_id: string;
  numero_factura: string | null;
  cxc_id: string | null;
  fecha: string | null;
  monto_total: number;
  saldo_pendiente: number;
  vendedor_usuario_id: string;
  comisionable: boolean | null;
  tiene_suscripcion: boolean;
  monto_suscripcion: number | null;
};

export type RecurrenciaDatos = { cliente_id: string; cliente: string; fecha: string | null; vendedor_usuario_id: string | null; monto: number; plan: string | null };

export type OverrideDatos = { pago_id: string; decision: "incluir" | "excluir"; motivo?: string; decidido_por?: string | null; decidido_at?: string | null };

export type DatosComisiones =
  | { estado: "sin_politica" | "politica_inactiva"; es_admin: boolean; usuario_id: string }
  | {
      estado: "ok";
      es_admin: boolean;
      usuario_id: string;
      politica: { id: string; nombre: string; base_calculo: BaseCalculo };
      escalas: Escala[];
      overrides: OverrideDatos[];
      lineas: LineaDatos[];
      a_cobrar: ACobrarDatos[];
      recurrencia: RecurrenciaDatos[];
      nombres: Record<string, string>;
    };

export type Linea = Omit<LineaDatos, "comisionable" | "tiene_suscripcion"> & {
  comisiona: boolean;
  origen: Origen;
  comision_estimada_linea: number;
  override_motivo: string | null;
  override_por: string | null;
};

export type ACobrarVendedor = {
  vendedor_usuario_id: string;
  vendedor_nombre: string;
  total_a_cobrar: number;
  facturas: ACobrarDatos[];
};

export type RecurrenciaVendedor = { vendedor_usuario_id: string | null; vendedor_nombre: string; total: number; items: RecurrenciaDatos[] };

export type ProgresoEscala = {
  escala_actual_porcentaje: number | null;
  escala_actual_premio_fijo: number | null;
  siguiente_escala_desde: number | null;
  siguiente_escala_porcentaje: number | null;
  falta_para_siguiente_escala: number | null;
  progreso_hacia_siguiente_pct: number | null;
  max_escala_alcanzada: boolean;
};

export type VendedorFila = ProgresoEscala & {
  vendedor_usuario_id: string;
  vendedor_nombre: string;
  cantidad_movimientos: number;
  revenue_base: number;
  porcentaje_tramo: number;
  comision_variable: number;
  premio_fijo_aplicado: number;
  comision_estimada: number;
  a_cobrar_total: number;
  recurrencia_mes: number;
  lineas: Linea[];
  a_cobrar: ACobrarVendedor | null;
  recurrencia_items: RecurrenciaDatos[];
};

export type Kpis = {
  revenue_base_total: number;
  comision_variable_total: number;
  premio_fijo_total: number;
  comision_estimada_total: number;
  a_cobrar_total: number;
  lineas_excluidas: number;
  recurrencia_total: number;
  fuentes_sin_vendedor: number;
};

export type PreviewComisiones = {
  estado: "ok" | "sin_politica" | "politica_inactiva";
  es_admin: boolean;
  mes: string;
  periodo: string;
  politica_nombre: string | null;
  base_calculo: BaseCalculo | null;
  kpis: Kpis | null;
  por_vendedor: VendedorFila[];
};
