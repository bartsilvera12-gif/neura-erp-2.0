"use client";

/**
 * Caja por turno — cliente. Portado de O&M (lib/caja/storage), adaptado al 2.0
 * (apiFetch + withTenant). Modelo núcleo: UNA caja abierta por empresa (sin
 * sucursales ni multi-PV). Abrir → vender/mover → arquear → cerrar.
 */
import { apiFetch } from "@/lib/api/client-fetch";

export type CajaTurno = { id: string; numero_caja: number; fecha_apertura: string; monto_apertura: number };

export type TipoMovimientoCaja = "ingreso" | "egreso" | "retiro" | "ajuste";
export type MedioPagoCaja = "efectivo" | "transferencia" | "tarjeta" | "cheque" | "otro";

export type MovimientoCaja = {
  id: string;
  tipo: string;
  concepto: string;
  monto: number;
  medio_pago: string;
  observacion: string | null;
  created_at: string;
};

export type CajaResumen = {
  total_vendido: number;
  cantidad_ventas: number;
  total_efectivo: number;
  total_transferencia: number;
  total_tarjeta: number;
  total_pos: number;
  efectivo_esperado: number;
  ingresos_efectivo: number;
  egresos_efectivo: number;
  retiros_efectivo: number;
  ajustes_efectivo: number;
  /** cobros a clientes (cuenta corriente) que entraron a esta caja */
  cobros_efectivo?: number;
  cobros_otros?: number;
  cantidad_cobros?: number;
  movimientos: MovimientoCaja[];
};

type Res = { success: true } | { success: false; error: string };

export async function getCajaAbierta(): Promise<CajaTurno | null> {
  try {
    const r = await apiFetch<{ caja: CajaTurno | null }>("/api/caja");
    return r.caja ?? null;
  } catch {
    return null;
  }
}

export async function getResumenCaja(): Promise<{ caja: CajaTurno | null; resumen: CajaResumen | null }> {
  try {
    return await apiFetch<{ caja: CajaTurno | null; resumen: CajaResumen | null }>("/api/caja/resumen");
  } catch {
    return { caja: null, resumen: null };
  }
}

export async function abrirCaja(monto: number, observacion: string | null): Promise<Res> {
  try {
    await apiFetch("/api/caja", { method: "POST", body: JSON.stringify({ monto_apertura: monto, observacion }) });
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function cerrarCaja(montoContado: number, observacion: string | null): Promise<Res> {
  try {
    await apiFetch("/api/caja/cierre", {
      method: "POST",
      body: JSON.stringify({ monto_cierre_contado: montoContado, observacion }),
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function registrarMovimiento(m: {
  tipo: TipoMovimientoCaja;
  concepto: string;
  monto: number;
  medio_pago: MedioPagoCaja;
  observacion: string | null;
}): Promise<Res> {
  try {
    await apiFetch("/api/caja/movimientos", { method: "POST", body: JSON.stringify(m) });
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
