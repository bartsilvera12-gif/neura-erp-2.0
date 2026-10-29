/**
 * Producción (receta 97): fabricar por tanda. Tipos compartidos por /inventario/produccion, el
 * modal Fabricar y sus rutas de API. Los costos vienen en null si el perfil no "ve costos".
 */

export type EstadoProduccion = "confirmada" | "anulada";

export const ESTADO_PRODUCCION: Record<EstadoProduccion, { label: string; clase: string }> = {
  confirmada: { label: "Fabricada", clase: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
  anulada: { label: "Anulada", clase: "bg-slate-100 text-slate-500 ring-1 ring-slate-200" },
};

type ProductoRef = { id: string; nombre: string; sku: string | null; unidad_medida: string | null };
type DepositoRef = { id: string; nombre: string; sucursal: string };

export type FilaProduccion = {
  id: string;
  numero: string;
  estado: EstadoProduccion;
  created_at: string;
  usuario_nombre: string | null;
  producto: ProductoRef;
  deposito: DepositoRef;
  cantidad_planeada: number;
  cantidad_obtenida: number;
  /** planeada − obtenida (negativa = salió más de lo planeado) */
  merma: number;
  costo_total: number | null;
  costo_unitario: number | null;
  lote_numero: string | null;
  vencimiento: string | null;
  insumos: number;
};

export type ListaProducciones = {
  rows: FilaProduccion[];
  total: number;
  ver_costos: boolean;
  puede_fabricar: boolean;
  totales: { producciones: number; costo: number | null };
};

export type DetalleProduccion = Omit<FilaProduccion, "insumos" | "producto"> & {
  producto: ProductoRef & { tipo_producto: string | null };
  merma_pct: number | null;
  notas: string | null;
  anulado_por_nombre: string | null;
  anulado_at: string | null;
  anulado_motivo: string | null;
  ver_costos: boolean;
  puede_anular: boolean;
  repetido?: boolean;
  items: {
    insumo_id: string; nombre: string; sku: string | null; unidad_medida: string | null; cantidad: number; movio_stock: boolean;
    costo_unitario: number | null; costo_total: number | null;
    lotes: { numero: string; vencimiento: string; cantidad: number }[] | null;
  }[];
};

/** Producto que se puede fabricar (Fabricado o preparación por tanda, con receta). */
export type Fabricable = {
  id: string;
  nombre: string;
  sku: string;
  tipo_producto: "fabricado" | "materia_prima";
  unidad_medida: string;
  rendimiento: number;
  controla_lotes: boolean;
  imagen_url: string | null;
  stock: number;
  /** cuánto alcanza la materia prima del depósito (null = ningún ingrediente controla stock) */
  alcanza: number | null;
};

export type PreviaFabricar = {
  producto: { id: string; nombre: string; sku: string; tipo_producto: string; unidad_medida: string; controla_lotes: boolean; rendimiento: number; stock: number };
  deposito: DepositoRef;
  cantidad: number;
  alcanza: number | null;
  faltantes: number;
  ver_costos: boolean;
  costo_estimado: number | null;
  items: {
    insumo_id: string; nombre: string; sku: string; unidad_medida: string; cantidad: number;
    controla_stock: boolean; controla_lotes: boolean;
    hay: number | null; reservado: number | null; falta: number | null;
    costo_unitario: number | null; costo: number | null;
  }[];
};

/** Decimales para mostrar una cantidad según la unidad (Unidad → enteros). */
export const decimalesDe = (unidad: string | null | undefined) => (unidad === "Unidad" || !unidad ? 0 : 3);
