/**
 * Reportes — lado servidor: filtros de la URL (desde / hasta / sucursal) y llamada a las
 * funciones de agregados de la base (receta 54). Solo servidor.
 */
import type { TenantDb } from "@/lib/api/tenant-db";
import { falloRpc, fechaONull, uuidONull } from "@/modules/inventario/server/rpc";
import type { SucursalOpcion } from "@/modules/reportes/tipos";

export type FiltrosRango = { desde: string | null; hasta: string | null; sucursal: string | null };

export function filtrosRango(sp: URLSearchParams): FiltrosRango {
  let desde = fechaONull(sp.get("desde"));
  let hasta = fechaONull(sp.get("hasta"));
  if (desde && hasta && desde > hasta) [desde, hasta] = [hasta, desde];
  return { desde, hasta, sucursal: uuidONull(sp.get("sucursal")) };
}

export const argsRango = (f: FiltrosRango) => ({ p_desde: f.desde, p_hasta: f.hasta, p_sucursal: f.sucursal });

type Resultado<T> = { ok: true; data: T } | { ok: false; res: Response };

/** Llama a una función de reporte; un error de la base vuelve como respuesta lista (400/403). */
export async function leerReporte<T>(db: TenantDb, fn: string, args: Record<string, unknown>): Promise<Resultado<T>> {
  const { data, error } = await db.rpc<T>(fn, args);
  if (error) {
    console.error(`[reportes/${fn}]`, error.message);
    return { ok: false, res: falloRpc(error) };
  }
  if (!data) return { ok: false, res: falloRpc({ message: "Sin datos" }) };
  return { ok: true, data };
}

const dmy = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;

/** "01/10/2026 al 15/10/2026 · Sucursal Luque" para los encabezados de PDF y Excel. */
export function describirRango(r: { desde?: string | null; hasta?: string | null; sucursal_id?: string | null; sucursales?: SucursalOpcion[] }) {
  const partes: string[] = [];
  if (r.desde && r.hasta) partes.push(r.desde === r.hasta ? dmy(r.desde) : `${dmy(r.desde)} al ${dmy(r.hasta)}`);
  partes.push(r.sucursal_id ? (r.sucursales?.find((s) => s.id === r.sucursal_id)?.nombre ?? "Sucursal") : "Todas las sucursales");
  return partes.join(" · ");
}

/** Nombre de archivo seguro: "estado-cuenta_2026-10-01_2026-10-15". */
export const nombreArchivo = (base: string, desde?: string | null, hasta?: string | null) =>
  [base, desde, hasta].filter(Boolean).join("_");
