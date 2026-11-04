/** Tipos del rubro Sorteos (receta 123). Compartido cliente/servidor. */

export type EstadoSorteo = "borrador" | "activo" | "pausado" | "cerrado" | "sorteado" | "anulado";
export type EstadoOrden = "pendiente_pago" | "en_revision" | "confirmada" | "rechazada" | "anulada" | "vencida";
export type Canal = "manual" | "vendedor" | "web" | "whatsapp";
export type MetodoPago = "transferencia" | "efectivo" | "tarjeta" | "otro";

export type Stats = {
  total: number;
  vendidos: number;
  reservados: number;
  monto: number;
  ordenes: number;
  por_revisar: number;
  hoy_boletas: number;
  hoy_monto: number;
};

export type Combo = { id?: string; cantidad: number; precio: number; etiqueta: string | null; activo?: boolean };
export type CuentaPago = { banco: string; titular: string; cuenta: string; documento?: string; alias?: string };

export type Premio = {
  id: string;
  posicion: number;
  nombre: string;
  descripcion: string | null;
  imagen_url: string | null;
  numero_ganador: string | null;
  ganador: string | null;
  ganador_telefono: string | null;
  ganador_documento: string | null;
  orden_numero: number | null;
  metodo: "digital" | "urna" | "externo" | null;
  nota: string | null;
  sorteado_at: string | null;
};

export type SorteoFila = {
  id: string;
  nombre: string;
  slug: string;
  estado: EstadoSorteo;
  precio: number;
  imagen_url: string | null;
  fecha_sorteo: string | null;
  numero_desde: number;
  numero_hasta: number;
  stats: Stats;
};

export type Sorteo = SorteoFila & {
  descripcion: string | null;
  digitos: number;
  modo_numeros: "aleatorio" | "correlativo";
  permite_elegir: boolean;
  max_por_compra: number | null;
  datos_pago: CuentaPago[];
  reserva_minutos: number;
  confirmacion_auto: boolean;
  mensaje_ticket: string | null;
  /** Link del vivo por redes donde se hace el sorteo (receta 127). */
  vivo_url: string | null;
  numeros_generados: boolean;
  semilla_hash: string | null;
  semilla_revelada: boolean;
  lista_hash: string | null;
  lista_cantidad: number | null;
  activado_at: string | null;
  cerrado_at: string | null;
  created_at: string;
  combos: Combo[];
  premios: Premio[];
};

export type Orden = {
  id: string;
  numero: number;
  token?: string;
  sorteo_id: string;
  sorteo: string;
  estado: EstadoOrden;
  canal: Canal;
  metodo_pago: MetodoPago;
  cantidad: number;
  monto: number;
  precio_lista: number;
  comprador_nombre: string;
  comprador_documento: string | null;
  comprador_telefono: string | null;
  comprador_ciudad: string | null;
  vendedor_id: string | null;
  vendedor: string | null;
  anuncio_id: string | null;
  referencia_pago: string | null;
  comprobante_path: string | null;
  validacion: "manual" | "auto" | null;
  motivo: string | null;
  vence_at: string | null;
  created_at: string;
  revisado_at: string | null;
  numeros: string[];
  repetida?: boolean;
};

export type Vendedor = {
  id: string;
  numero: number;
  nombre: string;
  telefono: string | null;
  codigo: string;
  usuario_id: string | null;
  cupo: number | null;
  comision_pct: number;
  activo: boolean;
  tiene_pin: boolean;
  tiene_link: boolean;
  clicks: number;
  boletas: number;
  monto: number;
  por_rendir: number;
  /** solo al crear: el PIN generado (se muestra una vez) */
  pin?: string | null;
};

export type Cupon = {
  numero: string;
  orden: number;
  nombre: string;
  documento: string | null;
  telefono: string | null;
  ciudad: string | null;
  fecha: string;
  impreso: boolean;
};

export const NOMBRE_ESTADO_SORTEO: Record<EstadoSorteo, string> = {
  borrador: "Borrador",
  activo: "A la venta",
  pausado: "Pausado",
  cerrado: "Venta cerrada",
  sorteado: "Sorteado",
  anulado: "Anulado",
};

export const NOMBRE_ESTADO_ORDEN: Record<EstadoOrden, string> = {
  pendiente_pago: "Esperando pago",
  en_revision: "Por revisar",
  confirmada: "Confirmada",
  rechazada: "Rechazada",
  anulada: "Anulada",
  vencida: "Vencida",
};

export const NOMBRE_CANAL: Record<Canal, string> = {
  manual: "Venta manual",
  vendedor: "Vendedor",
  web: "Página web",
  whatsapp: "WhatsApp",
};

export const NOMBRE_METODO: Record<MetodoPago, string> = {
  transferencia: "Transferencia",
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  otro: "Otro",
};

/** Monto de una cantidad: el combo exacto si hay, si no cantidad × precio (igual que sorteo_precio). */
export function precioDe(s: Pick<Sorteo, "precio" | "combos">, cantidad: number): { monto: number; lista: number; combo: Combo | null } {
  const lista = s.precio * cantidad;
  const combo = s.combos.find((c) => c.cantidad === cantidad && c.activo !== false) ?? null;
  return { monto: combo ? combo.precio : lista, lista, combo };
}

/** % de descuento de un combo frente a precio × cantidad (0 si no hay descuento). */
export const descuentoCombo = (precio: number, c: Combo) => {
  const lista = precio * c.cantidad;
  return lista > c.precio ? Math.round(((lista - c.precio) / lista) * 100) : 0;
};
