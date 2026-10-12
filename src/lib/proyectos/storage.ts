/**
 * Storage del módulo Proyectos: bucket PRIVADO "proyectos" (50 MB por archivo).
 *
 * Igual que Soporte: el bucket no tiene políticas para la sesión del usuario, así que
 * las URLs firmadas (subida y descarga) las emite el cliente de sistema, SIEMPRE dentro
 * del prefijo `<empresa>/<proyecto>/` que arma el servidor (la ruta nunca la decide el
 * navegador).
 */
import { systemClient } from "@/lib/supabase/clients";

export const PROYECTOS_BUCKET = "proyectos";
const URL_TTL_S = 60 * 10;

export function prefijoArchivosProyecto(empresaId: string, proyectoId: string): string {
  return `${empresaId}/${proyectoId}/`;
}

export function pathArchivoProyecto(empresaId: string, proyectoId: string, nombre: string): string {
  const limpio =
    (nombre || "archivo")
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 90)
      .toLowerCase() || "archivo";
  return `${prefijoArchivosProyecto(empresaId, proyectoId)}${crypto.randomUUID()}-${limpio}`;
}

function bucket() {
  return systemClient().storage.from(PROYECTOS_BUCKET);
}

/** URL firmada para que el navegador suba UN archivo directo al bucket. */
export async function firmarSubida(path: string): Promise<{ path: string; token: string } | { error: string }> {
  const { data, error } = await bucket().createSignedUploadUrl(path);
  if (error || !data) return { error: error?.message ?? "No se pudo preparar la subida" };
  return { path, token: data.token };
}

/** ¿Existe el objeto? Devuelve su tamaño (o null si no está). */
export async function objetoSubido(path: string): Promise<{ size: number | null } | null> {
  const carpeta = path.slice(0, path.lastIndexOf("/"));
  const archivo = path.slice(path.lastIndexOf("/") + 1);
  const { data } = await bucket().list(carpeta, { search: archivo, limit: 5 });
  const obj = (data ?? []).find((o) => o.name === archivo);
  if (!obj) return null;
  return { size: Number((obj.metadata as { size?: number } | null)?.size ?? 0) || null };
}

export async function borrarObjeto(path: string): Promise<void> {
  await bucket().remove([path]).catch(() => {});
}

/**
 * URLs firmadas de varios archivos en UNA llamada (para ver); la de descarga es la
 * misma con `download=<nombre>` (Storage la sirve como adjunto con ese nombre).
 */
export async function urlsFirmadasLote(items: { path: string; nombre: string }[]): Promise<Map<string, { url: string | null; url_descarga: string | null }>> {
  const out = new Map<string, { url: string | null; url_descarga: string | null }>();
  if (!items.length) return out;
  const { data } = await bucket().createSignedUrls(items.map((i) => i.path), URL_TTL_S);
  const porPath = new Map((data ?? []).map((d) => [d.path ?? "", d.signedUrl ?? null]));
  for (const i of items) {
    const url = porPath.get(i.path) ?? null;
    out.set(i.path, { url, url_descarga: url ? `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(i.nombre)}` : null });
  }
  return out;
}
