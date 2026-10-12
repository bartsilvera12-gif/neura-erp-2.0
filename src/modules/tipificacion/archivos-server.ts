/**
 * Evidencias de tickets — lado servidor. Bucket PRIVADO "soporte"; el path lo decide el
 * servidor: soporte/{empresa}/{ticket}/{uuid}-{nombre}. La firma de subida se pide con
 * service-role (el bucket no tiene políticas para el usuario), siempre detrás de withTenant
 * y después de comprobar con ctx.db que el ticket es de la empresa.
 */
import { scopedServiceClient } from "@/lib/supabase/clients";

export const SOPORTE_BUCKET = "soporte";

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

/** URL firmada para subir UN archivo directo al Storage desde el navegador. */
export async function firmarSubida(empresaId: string, path: string): Promise<{ token: string } | { error: string }> {
  const { data, error } = await scopedServiceClient(empresaId).storage.from(SOPORTE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { error: error?.message ?? "No se pudo preparar la subida" };
  return { token: data.token };
}

/** ¿Existe el objeto subido? (para no registrar un archivo que nunca llegó). Devuelve su tamaño. */
export async function objetoSubido(empresaId: string, path: string): Promise<{ size: number | null } | null> {
  const carpeta = path.slice(0, path.lastIndexOf("/"));
  const nombre = path.slice(path.lastIndexOf("/") + 1);
  const { data, error } = await scopedServiceClient(empresaId).storage.from(SOPORTE_BUCKET).list(carpeta, { search: nombre, limit: 5 });
  if (error) return null;
  const f = (data ?? []).find((o) => o.name === nombre);
  if (!f) return null;
  const size = Number((f.metadata as { size?: number } | null)?.size);
  return { size: Number.isFinite(size) ? size : null };
}
