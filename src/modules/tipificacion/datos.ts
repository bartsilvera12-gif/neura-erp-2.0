/**
 * Tipificación — datos del lado del navegador: el contexto del formulario (cacheado y
 * precargable), el historial de un cliente (stale-while-revalidate) y el borrador que se
 * conserva si el formulario se cierra sin guardar.
 */
import { apiFetchCache, invalidar, precargar } from "@/lib/api/cache-cliente";
import type { ContextoTipificacion } from "@/modules/tipificacion/dominio";

export const URL_CONTEXTO = "/api/tipificaciones/contexto";
export const urlHistorial = (clienteId: string) => `/api/clientes/${encodeURIComponent(clienteId)}/tipificaciones`;

/** El catálogo casi no cambia: 5 minutos en memoria (lo invalida la pantalla del catálogo). */
const TTL_CONTEXTO = 5 * 60_000;

// Último contexto visto (sincrónico): el formulario pinta en el primer render, sin esperar.
let ultimoContexto: { data: ContextoTipificacion; at: number } | null = null;

export function cargarContexto(fresco = false): Promise<ContextoTipificacion> {
  return apiFetchCache<ContextoTipificacion>(URL_CONTEXTO, { ttlMs: TTL_CONTEXTO, fresco }).then((d) => {
    ultimoContexto = { data: d, at: Date.now() };
    return d;
  });
}

/** El contexto ya cargado (si hay), para el estado inicial. */
export function contextoAlInstante(): ContextoTipificacion | null {
  return ultimoContexto && Date.now() - ultimoContexto.at < TTL_CONTEXTO ? ultimoContexto.data : null;
}

/** Deja listo lo del formulario (al pasar el mouse por "Tipificación" o al abrir un cliente). */
export function precargarTipificacion(clienteId?: string | null) {
  void cargarContexto().catch(() => {});
  if (clienteId) void precargar(urlHistorial(clienteId));
}

/** Después de guardar: lo que muestra historiales y Actividad del cliente queda viejo. */
export function invalidarCliente(clienteId: string) {
  invalidar(urlHistorial(clienteId));
  invalidar(`/api/clientes/${clienteId}/historial`);
  invalidar("/api/tipificaciones/registro");
}

/** Después de tocar el catálogo. */
export function invalidarCatalogo() {
  invalidar("/api/tipificaciones");
  invalidar(URL_CONTEXTO);
  ultimoContexto = null;
}

// ── Borrador por cliente ─────────────────────────────────────────────────────
export type Borrador = {
  estadoId: string;
  subestadoId: string;
  observacion: string;
  clasificacion: string;
  agendar: boolean;
  agenda: { inicio: string; duracion_min: number; responsable_id: string; ubicacion: string };
  at: number;
};
const CLAVE = (clienteId: string) => `neura:tipificacion:borrador:${clienteId}`;
/** Un borrador de más de 3 días ya no sirve. */
const VIGENCIA_MS = 3 * 24 * 3600_000;

export function leerBorrador(clienteId: string): Borrador | null {
  try {
    const raw = window.localStorage.getItem(CLAVE(clienteId));
    if (!raw) return null;
    const b = JSON.parse(raw) as Borrador;
    if (!b || Date.now() - (b.at ?? 0) > VIGENCIA_MS) { window.localStorage.removeItem(CLAVE(clienteId)); return null; }
    return b;
  } catch {
    return null;
  }
}

export function guardarBorrador(clienteId: string, b: Omit<Borrador, "at">) {
  try {
    const vacio = !b.observacion.trim() && !b.subestadoId && !b.agenda.inicio;
    if (vacio) window.localStorage.removeItem(CLAVE(clienteId));
    else window.localStorage.setItem(CLAVE(clienteId), JSON.stringify({ ...b, at: Date.now() }));
  } catch {
    /* sin almacenamiento (modo privado): el borrador vive solo en memoria */
  }
}

export function borrarBorrador(clienteId: string) {
  try { window.localStorage.removeItem(CLAVE(clienteId)); } catch { /* nada */ }
}
