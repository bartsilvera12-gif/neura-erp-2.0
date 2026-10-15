/**
 * Consulta de la pantalla Vencimientos (reporte_vencimientos, recetas 44 y 50), compartida
 * por el listado y la exportación a Excel. Solo servidor.
 */
import type { TenantDb } from "@/lib/api/tenant-db";
import type { ReporteVencimientos } from "@/modules/inventario/vencimientos";
import { uuidONull } from "@/modules/inventario/server/rpc";

export const DIAS_VENCIMIENTO = [7, 15, 30, 60] as const;

export function filtrosVencimientos(sp: URLSearchParams) {
  const n = Number(sp.get("dias"));
  const dias = (DIAS_VENCIMIENTO as readonly number[]).includes(n) ? n : 30;
  const estado = sp.get("estado");
  return {
    dias,
    q: (sp.get("q") ?? "").trim().slice(0, 100),
    estado: estado === "vencido" || estado === "por_vencer" ? estado : null,
    deposito: uuidONull(sp.get("deposito")),
  };
}

export async function consultarVencimientos(db: TenantDb, f: ReturnType<typeof filtrosVencimientos>) {
  const { data, error } = await db.rpc<ReporteVencimientos>("reporte_vencimientos", {
    p_dias: f.dias,
    p_q: f.q || null,
    p_estado: f.estado,
    p_deposito: f.deposito,
  });
  if (error || !data) throw new Error("db");
  return data;
}
