/** Reporte "Deudores" — lado servidor (función reporte_deudores). */
import type { TenantDb } from "@/lib/api/tenant-db";

export type FilaDeudor = {
  id: string; nombre: string; razon_social: string | null; documento: string | null; telefono: string | null; ciudad: string | null;
  limite_credito: number; deuda: number; vencido: number; por_vencer: number; d1_30: number; d31_60: number; d61_90: number; d90: number;
  max_atraso: number; cuentas: number; ultimo_cobro: string | null; ultimo_cobro_monto: number | null; saldo_favor: number;
};
export type ReporteDeudores = {
  rows: FilaDeudor[];
  totales: { clientes: number; deuda: number; vencido: number; por_vencer: number; d1_30: number; d31_60: number; d61_90: number; d90: number };
};

export async function reporteDeudores(db: TenantDb, soloVencidos: boolean): Promise<ReporteDeudores> {
  const { data, error } = await db.rpc<ReporteDeudores>("reporte_deudores", { p_solo_vencidos: soloVencidos });
  if (error || !data) throw new Error(error?.message ?? "sin datos");
  return data;
}
