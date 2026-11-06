/** Helpers de la liquidación del comedor (solo servidor). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FilaLiquidacion = {
  funcionario_id: string; funcionario: string; documento: string | null;
  almuerzos: number; cantina_items: number; reservas: number;
  subsidio: number; excedente: number; diferencia: number; total: number;
};
export type Liquidacion = {
  desde: string; hasta: string;
  rows: FilaLiquidacion[];
  totales: { funcionarios: number; almuerzos: number; cantina_items: number; subsidio: number; excedente: number; diferencia: number; total: number };
};

/** desde/hasta (por defecto el mes corriente) y empresa opcional. */
export function rangoLiquidacion(sp: URLSearchParams): { p_desde: string; p_hasta: string; p_empresa: string | null } {
  const hoy = new Date();
  const primero = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const desde = sp.get("desde");
  const hasta = sp.get("hasta");
  const empresa = sp.get("empresa");
  return {
    p_desde: desde && /^\d{4}-\d{2}-\d{2}$/.test(desde) ? desde : iso(primero),
    p_hasta: hasta && /^\d{4}-\d{2}-\d{2}$/.test(hasta) ? hasta : iso(hoy),
    p_empresa: empresa && UUID_RE.test(empresa) ? empresa : null,
  };
}

export const gsPY = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-PY");
