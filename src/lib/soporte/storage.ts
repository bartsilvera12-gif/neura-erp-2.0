/**
 * Storage del módulo Soporte: bucket PRIVADO "soporte" (50 MB por archivo).
 *
 * El bucket no tiene políticas para la sesión del usuario, así que las URLs
 * firmadas (subida y descarga) las emite el cliente de sistema. Vive en lib/ a
 * propósito (el cliente de sistema no se importa desde una ruta) y SIEMPRE
 * trabaja dentro del prefijo `<empresa>/<ticket>/` que arma el servidor: la ruta
 * nunca la decide el navegador.
 */
import { systemClient } from "@/lib/supabase/clients";

export const SOPORTE_BUCKET = "soporte";
const URL_TTL_S = 60 * 10;

export function prefijoArchivosTicket(empresaId: string, ticketId: string): string {
  return `${empresaId}/${ticketId}/`;
}

export function pathArchivoTicket(empresaId: string, ticketId: string, nombre: string): string {
  const limpio =
    (nombre || "archivo")
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 90)
      .toLowerCase() || "archivo";
  return `${prefijoArchivosTicket(empresaId, ticketId)}${crypto.randomUUID()}-${limpio}`;
}

function bucket() {
  return systemClient().storage.from(SOPORTE_BUCKET);
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

/** URLs firmadas de corta duración: para ver y para descargar con su nombre. */
export async function urlsFirmadas(path: string, nombre: string): Promise<{ url: string | null; url_descarga: string | null }> {
  const b = bucket();
  const [ver, bajar] = await Promise.all([
    b.createSignedUrl(path, URL_TTL_S),
    b.createSignedUrl(path, URL_TTL_S, { download: nombre }),
  ]);
  return { url: ver.data?.signedUrl ?? null, url_descarga: bajar.data?.signedUrl ?? null };
}
