/** Envíos (receta 170): tipos compartidos del tablero y la configuración. */

export type EnvioEstado = {
  id: string;
  nombre: string;
  color: string | null;
  orden: number;
  es_inicial: boolean;
  es_final: boolean;
  activo?: boolean;
  usado?: boolean;
};

export type EnvioChofer = {
  id: string;
  nombre: string;
  telefono: string | null;
  documento?: string | null;
  activo?: boolean;
  usado?: boolean;
};

export type EnvioCobro = "na" | "pendiente" | "cobrado";

export type Envio = {
  id: string;
  numero: string | null;
  cliente_nombre: string | null;
  direccion: string | null;
  referencia: string | null;
  telefono: string | null;
  estado_id: string;
  chofer_id: string | null;
  total: number;
  cobro_estado: EnvioCobro;
  notas: string | null;
  /** Cantidad de productos de la venta (receta 176). */
  items: number;
  /** Detalle de productos del pedido (receta 177). */
  productos: { nombre: string; cantidad: number }[];
  /** Hora estimada de entrega "HH:MM" (receta 176). */
  hora_estimada: string | null;
  /** Vendedor que cargó el envío (receta 178). */
  vendedor: string | null;
  creado_at: string;
  entregado_at: string | null;
};

export type EnvioHistorial = { estado_nombre: string | null; usuario_nombre: string | null; at: string };

export type EnviosTablero = {
  estados: EnvioEstado[];
  choferes: Pick<EnvioChofer, "id" | "nombre" | "telefono">[];
  envios: Envio[];
};

export const URL_ENVIOS_TABLERO = "/api/envios/tablero";
export const URL_ENVIOS = "/api/envios";
export const URL_ENVIOS_ESTADOS = "/api/envios/estados";
export const URL_ENVIOS_CHOFERES = "/api/envios/choferes";
export const URL_ENVIOS_HISTORIAL = "/api/envios/historial";
