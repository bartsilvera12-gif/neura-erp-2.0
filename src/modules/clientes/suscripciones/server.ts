/** Suscripciones — ayudas del lado servidor (rutas /api/planes y /api/suscripciones). Solo servidor. */
import { fail } from "@/lib/api/responses";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Id que viene en la URL justo después de `segmento` (ej. "suscripciones"), o null si no es un uuid. */
export function idDeRuta(req: { url: string }, segmento: string): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf(segmento);
  const id = i >= 0 ? segs[i + 1] : undefined;
  return id && UUID_RE.test(id) ? id : null;
}

/** "2026-10" o "2026-10-15" → "2026-10-01" (1° del mes); cualquier otra cosa → null. */
export function periodoDe(v: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec((v ?? "").trim());
  if (!m) return null;
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

/**
 * Error de la base → respuesta 422 con el motivo en castellano que levanta la función
 * (raise exception '…'). Los errores técnicos (sin texto útil) quedan como genéricos.
 */
export function errorDb(error: { message: string; code?: string } | null | undefined, porDefecto = "No se pudo completar la operación") {
  const msg = (error?.message ?? "").replace(/^.*?ERROR:\s*/, "").trim();
  if (error?.code === "23505" || /duplicate key|uq_ventas_suscripcion_periodo/i.test(msg)) {
    return fail("Ya existe un registro igual (¿la cuota de ese mes ya está emitida?)", 422);
  }
  if (!msg || /violates|syntax|relation|column|function .* does not exist|permission denied/i.test(msg)) {
    return fail(porDefecto, 422);
  }
  return fail(msg, 422);
}
