/** Ayudantes de servidor del rubro Sorteos: errores de la base y ids de la ruta. */
import { fail } from "@/lib/api/responses";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El uuid que sigue a `segmento` en la ruta (/api/sorteos/<id>/…), o null. */
export function idDe(req: { url: string }, segmento: string): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf(segmento);
  const v = i >= 0 ? segs[i + 1] : null;
  return v && UUID_RE.test(v) ? v : null;
}

/** Error de una función de la base → mensaje claro (las funciones ya explican qué pasó). */
export function falloSorteo(error: { message: string; code?: string }, porDefecto = "No se pudo completar la operación") {
  const msg = (error.message ?? "").replace(/^.*?ERROR:\s*/, "").trim();
  if (error.code === "42501" || /^Sin permiso|^Tu perfil no|permission denied/i.test(msg)) {
    return fail(/permission denied/i.test(msg) ? "No tenés permiso para esto" : msg, 403);
  }
  if (error.code === "23505") return fail(msg || "Ya existe un registro igual", 409, "duplicado");
  if (!msg || /syntax|relation .* does not exist|column .* does not exist|function .* does not exist/i.test(msg)) return fail(porDefecto, 400);
  return fail(msg, 400);
}

export const uuidValido = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
