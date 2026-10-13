/**
 * Ids de las rutas de Inventario (/api/productos/[id]/…, /api/inventario/…/[id]). Solo servidor.
 * Un id que no es uuid ("undefined", "abc") se corta con 400 ANTES de ir a la base: antes
 * llegaba a PostgREST y volvía 500 (uuid inválido).
 */
import { fail } from "@/lib/api/responses";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El segmento que sigue a `despuesDe` en la URL (".../productos/<id>/costos" → "<id>"). */
export function idDeRuta(url: string, despuesDe: string): string | null {
  const segs = new URL(url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf(despuesDe);
  return i >= 0 ? (segs[i + 1] ?? null) : null;
}

/** 400 con un mensaje claro si el id no es un uuid válido. */
export const idInvalido = (que = "producto") => fail(`Id de ${que} inválido`, 400, "invalid_id");

/** true si la base todavía no tiene la función (receta sin aplicar en este schema). */
export function faltaFuncion(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return !!e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message ?? ""));
}
