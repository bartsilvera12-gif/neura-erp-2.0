/**
 * Búsqueda inteligente para listados que filtra PostgREST (ventas, kardex): cada tabla
 * tiene una columna `busqueda` con su texto ya normalizado (sin tildes, minúsculas, con
 * y sin separadores; ver db/canonical/19_busqueda.sql) y la base sugiere variantes para
 * los errores de tipeo ("yerva" → "yerba"). Cada palabra tiene que aparecer, en
 * cualquier orden, como ella misma o como alguna de sus variantes.
 * Solo servidor.
 */
import type { TenantDb } from "@/lib/api/tenant-db";

/** Grupos de variantes por palabra: [["yerva","yerba"], ["1kg"]]. Vacío si no hay búsqueda. */
export async function variantesBusqueda(db: TenantDb, q: string | null | undefined): Promise<string[][]> {
  const texto = (q ?? "").trim();
  if (!texto) return [];
  const { data, error } = await db.rpc<string[][]>("variantes_busqueda", { p_q: texto.slice(0, 200) });
  if (error || !Array.isArray(data)) {
    // Si la base no responde, al menos palabra por palabra sin tildes.
    return texto
      .normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
      .split(/[^a-z0-9]+/).filter(Boolean).slice(0, 8).map((t) => [t]);
  }
  // Solo letras y números (las genera la base así): seguras dentro de un or=(...).
  return data.map((g) => g.filter((v) => /^[a-z0-9]+$/.test(v))).filter((g) => g.length);
}

/**
 * Condición or=(...) de PostgREST para un grupo: la palabra o cualquiera de sus variantes
 * dentro de `columna`, más condiciones extra opcionales (ej. total exacto).
 */
export function condicionGrupo(grupo: string[], columna = "busqueda", extra: string[] = []): string {
  return [...grupo.map((v) => `${columna}.ilike.*${v}*`), ...extra].join(",");
}
