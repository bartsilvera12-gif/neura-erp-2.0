/**
 * Respuestas de las funciones de stock de la base (Fase 1: sucursales y depósitos). Solo servidor.
 * Los mensajes que levantan las funciones (stock insuficiente, falta el motivo…) están
 * escritos para el usuario: se devuelven tal cual. "Sin permiso" (42501) → 403.
 */
import { fail } from "@/lib/api/responses";

export function falloRpc(error: { message: string; code?: string }) {
  const msg = error.message.replace(/^.*?ERROR:\s*/, "");
  return fail(msg, error.code === "42501" || /^Sin permiso/i.test(msg) ? 403 : 400);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** uuid o null (filtros de URL). */
export const uuidONull = (v: string | null) => (v && UUID.test(v) ? v : null);
/** YYYY-MM-DD o null. */
export const fechaONull = (v: string | null) => (v && FECHA.test(v) ? v : null);
