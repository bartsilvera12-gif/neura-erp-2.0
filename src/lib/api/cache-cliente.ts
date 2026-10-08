/**
 * Cache chico del lado del cliente para GETs que casi no cambian (/api/me, categorías…).
 *
 *   const r = await apiFetchCache<{ categorias: Categoria[] }>("/api/inventario/categorias");
 *   invalidar("/api/inventario/categorias");   // después de crear/editar/borrar
 *
 * - TTL corto (60 s por defecto): pasado ese tiempo se vuelve a pedir.
 * - Dedupe: si dos pantallas piden lo mismo a la vez, sale UN solo request.
 * - La clave incluye el usuario de la sesión: si cambia el usuario (logout/login en la
 *   misma pestaña) nunca se le muestran datos del anterior.
 * - Los errores no se guardan: el próximo pedido reintenta.
 */
import { browserClient } from "@/lib/supabase/browser";
import { apiFetch } from "@/lib/api/client-fetch";

const TTL_MS = 60_000;

type Entrada = { hasta: number; promesa: Promise<unknown> };
const cache = new Map<string, Entrada>();

async function usuarioActual(): Promise<string> {
  try {
    const { data } = await browserClient().auth.getSession();
    return data.session?.user.id ?? "anon";
  } catch {
    return "anon";
  }
}

/**
 * GET con cache + dedupe. Para cualquier otro método usar apiFetch directo.
 * `fresco: true` ignora lo guardado, pide de nuevo y deja el resultado en el cache.
 */
export async function apiFetchCache<T = unknown>(url: string, opts: { ttlMs?: number; fresco?: boolean } = {}): Promise<T> {
  const ttlMs = opts.ttlMs ?? TTL_MS;
  const clave = `${await usuarioActual()}|${url}`;
  const ahora = Date.now();
  const hit = cache.get(clave);
  if (!opts.fresco && hit && hit.hasta > ahora) return hit.promesa as Promise<T>;

  const promesa = apiFetch<T>(url);
  const entrada: Entrada = { hasta: ahora + ttlMs, promesa };
  cache.set(clave, entrada);
  promesa.catch(() => {
    // Un error no queda cacheado (solo si nadie la reemplazó mientras tanto).
    if (cache.get(clave) === entrada) cache.delete(clave);
  });
  return promesa;
}

/**
 * Olvida una URL cacheada (para todos los usuarios de la pestaña). Sin query string
 * también borra sus variantes: invalidar("/api/inventario/categorias") borra
 * "/api/inventario/categorias?todas=1&conteo=1".
 */
export function invalidar(url: string) {
  for (const clave of [...cache.keys()]) {
    const u = clave.slice(clave.indexOf("|") + 1);
    if (u === url || (!url.includes("?") && u.startsWith(`${url}?`))) cache.delete(clave);
  }
}

/** Vacía todo el cache (al cerrar sesión). */
export function limpiarCache() {
  cache.clear();
}
