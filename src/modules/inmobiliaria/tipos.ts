/** Rubro Inmobiliaria (receta 130): tipos compartidos cliente/servidor. */

export type Gestion = "venta" | "alquiler" | "venta_alquiler";
export type EstadoPropiedad = "disponible" | "reservada" | "vendida" | "alquilada" | "retirada";
export type Documentacion = "al_dia" | "en_tramite" | "con_observaciones" | "sin_titulo";
export type TipoIvaPropiedad = "EXENTA" | "5%" | "10%";

export const GESTIONES: [Gestion, string][] = [["venta", "Venta"], ["alquiler", "Alquiler"], ["venta_alquiler", "Venta y alquiler"]];
export const ESTADOS: [EstadoPropiedad, string][] = [
  ["disponible", "Disponible"], ["reservada", "Reservada"], ["vendida", "Vendida"], ["alquilada", "Alquilada"], ["retirada", "Retirada"],
];
export const DOCUMENTACION: [Documentacion, string][] = [
  ["al_dia", "Al día"], ["en_tramite", "En trámite"], ["con_observaciones", "Con observaciones"], ["sin_titulo", "Sin título"],
];

export const nombreDe = <T extends string>(lista: [T, string][], v: T | null | undefined) => lista.find(([k]) => k === v)?.[1] ?? "";

export type PropiedadFila = {
  id: string;
  codigo: string;
  titulo: string;
  tipo: string | null;
  gestion: Gestion;
  estado: EstadoPropiedad;
  ciudad: string | null;
  barrio: string | null;
  direccion: string | null;
  superficie_terreno: number | null;
  superficie_construida: number | null;
  precio_venta: number;
  precio_alquiler: number | null;
  documentacion: Documentacion;
  propia: boolean;
  propietario: string | null;
  imagen_url: string | null;
  lote: string | null;
  manzana: string | null;
};

export type ListaPropiedades = {
  total: number;
  por_estado: Partial<Record<EstadoPropiedad, number>>;
  ciudades: string[];
  items: PropiedadFila[];
};

export type Propiedad = PropiedadFila & {
  producto_id: string;
  descripcion: string | null;
  tipo_iva: TipoIvaPropiedad;
  tipo_id: string | null;
  cuenta_catastral: string | null;
  finca: string | null;
  documentacion_nota: string | null;
  propietario_id: string | null;
  propietario_documento: string | null;
  comision_venta_pct: number | null;
  comision_alquiler_pct: number | null;
  notas: string | null;
};

export type TipoPropiedad = { id: string; nombre: string; activo: boolean; usos: number };

/** Receta 133: contratos de alquiler. */
export type EstadoContrato = "vigente" | "finalizado" | "rescindido";

export type ContratoFila = {
  id: string; numero: string; estado: EstadoContrato; propiedad: string; propiedad_codigo: string; propiedad_id: string;
  inquilino: string; inquilino_id: string; propietario: string | null; monto_actual: number; dia_vencimiento: number;
  fecha_inicio: string; meses: number | null; emitido_mes: boolean; deuda: number;
};

export type CuotaAlquiler = {
  id: string; periodo: string; mes: string; monto: number; numero: string; venta_id: string; vencimiento: string | null;
  cobrado: number; saldo: number; estado: "pendiente" | "parcial" | "pagada" | "anulada"; comision_pct: number; liquidada: boolean;
};

export type Contrato = ContratoFila & {
  direccion: string; inquilino_documento: string | null; inquilino_telefono: string | null; propietario_id: string | null;
  comision_pct: number; monto: number; tipo_iva: TipoIvaPropiedad; fecha_termina: string | null; garantia: number;
  ajuste_pct: number; ajuste_cada_meses: number; fecha_fin: string | null; notas: string | null; cuotas: CuotaAlquiler[];
};

export type PendienteDueno = {
  propietario_id: string; propietario: string; propietario_documento: string | null; cobrado: number; comision: number; neto: number;
  cuotas: { id: string; contrato: string; propiedad: string; mes: string; cobrado: number; comision: number; neto: number }[];
};

/** Receta 134: lo que busca un cliente y su ficha inmobiliaria. */
export type Busqueda = {
  id: string; gestion: "venta" | "alquiler"; tipo_id: string | null; tipo: string | null; ciudad: string | null;
  precio_max: number | null; superficie_min: number | null; notas: string | null; activa: boolean; created_at: string;
  coincidencias: { id: string; codigo: string; titulo: string; ciudad: string | null; precio_venta: number; precio_alquiler: number | null; gestion: Gestion; imagen_url: string | null }[];
};

export type FichaInmobiliaria = {
  como_dueno: { id: string; codigo: string; titulo: string; estado: EstadoPropiedad; gestion: Gestion; precio_venta: number; precio_alquiler: number | null; comision_venta_pct: number | null; comision_alquiler_pct: number | null }[];
  compradas: { id: string; codigo: string; titulo: string; venta: string; fecha: string; total: number; cuotas: number; entrega: number; saldo: number }[];
  contratos: ContratoFila[];
  busquedas: Busqueda[];
};

/** Receta 140: aviso a un interesado (propiedad × búsqueda), con lo necesario para armar el WhatsApp. */
export type EstadoAviso = "pendiente" | "enviado" | "descartado";
export type AvisoInteresado = {
  id: string; estado: EstadoAviso; canal: "whatsapp" | "otro" | null; created_at: string; resuelto_at: string | null;
  propiedad_id: string; codigo: string; titulo: string; ciudad: string | null; barrio: string | null;
  gestion: "venta" | "alquiler"; precio_venta: number | null; precio_alquiler: number | null; imagen_url: string | null;
  cliente_id: string; cliente: string; telefono: string | null; email: string | null; notas: string | null; empresa: string | null;
};

export type Interesado = { cliente_id: string; cliente: string; telefono: string | null; email: string | null; gestion: "venta" | "alquiler"; precio_max: number | null; notas: string | null };

export type Liquidacion = { id: string; numero: string; fecha: string; propietario: string; cobrado: number; comision: number; neto: number; medio: string; referencia: string | null; cuotas: number };
