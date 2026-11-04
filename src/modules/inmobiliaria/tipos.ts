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
