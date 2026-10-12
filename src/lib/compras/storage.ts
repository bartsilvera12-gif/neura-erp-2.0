/**
 * Storage de los comprobantes de compra: bucket PRIVADO "compras" (20 MB por archivo).
 *
 * El bucket no tiene políticas para la sesión del usuario: el archivo lo sube el
 * servidor y para verlo se emite una URL firmada de corta duración, ambas cosas con el
 * cliente de sistema. Vive en lib/ a propósito (el cliente de sistema no se importa
 * desde una ruta) y SIEMPRE trabaja dentro del prefijo `<empresa>/<compra>/` que arma
 * el servidor: la ruta nunca la decide el navegador.
 */
import { systemClient } from "@/lib/supabase/clients";

export const COMPRAS_BUCKET = "compras";
export const COMPROBANTE_MAX_BYTES = 20 * 1024 * 1024;
const URL_TTL_S = 60 * 5;

/** Tipos aceptados: fotos (jpg/png/webp/heic) y PDF. */
const MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]);
const POR_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  heic: "image/heic", heif: "image/heif", pdf: "application/pdf",
};

/** Tipo final del archivo (algunos navegadores mandan HEIC sin tipo) o null si no se acepta. */
export function mimeComprobante(nombre: string, tipo: string): string | null {
  const t = (tipo || "").toLowerCase();
  if (MIMES.has(t)) return t;
  const ext = nombre.toLowerCase().split(".").pop() ?? "";
  if ((!t || t === "application/octet-stream") && POR_EXTENSION[ext]) return POR_EXTENSION[ext];
  return null;
}

/** Firma mínima del contenido: que un .exe renombrado a .pdf no pase. */
export function contenidoCoincide(buf: Uint8Array, mime: string): boolean {
  const empieza = (...b: number[]) => b.every((x, i) => buf[i] === x);
  switch (mime) {
    case "application/pdf": return empieza(0x25, 0x50, 0x44, 0x46); // %PDF
    case "image/jpeg": return empieza(0xff, 0xd8, 0xff);
    case "image/png": return empieza(0x89, 0x50, 0x4e, 0x47);
    case "image/webp": return empieza(0x52, 0x49, 0x46, 0x46) && buf[8] === 0x57 && buf[9] === 0x45; // RIFF....WE(BP)
    case "image/heic":
    case "image/heif": return buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70; // ....ftyp
    default: return false;
  }
}

export function prefijoComprobantes(empresaId: string, compraId: string): string {
  return `${empresaId}/${compraId}/`;
}

/** Ruta dentro del bucket: {empresa}/{compra}/{uuid}-{nombre-limpio}. */
export function pathComprobante(empresaId: string, compraId: string, nombre: string): string {
  const limpio =
    (nombre || "comprobante")
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 90)
      .toLowerCase() || "comprobante";
  return `${prefijoComprobantes(empresaId, compraId)}${crypto.randomUUID()}-${limpio}`;
}

function bucket() {
  return systemClient().storage.from(COMPRAS_BUCKET);
}

export async function subirComprobante(path: string, datos: Uint8Array, mime: string): Promise<{ error?: string }> {
  const { error } = await bucket().upload(path, datos, { contentType: mime, upsert: false });
  return error ? { error: error.message } : {};
}

export async function borrarComprobante(path: string): Promise<void> {
  await bucket().remove([path]).catch(() => {});
}

/** URL firmada de corta duración para ver el archivo (o bajarlo con su nombre). */
export async function urlComprobante(path: string, descargarComo?: string): Promise<string | null> {
  const { data } = await bucket().createSignedUrl(path, URL_TTL_S, descargarComo ? { download: descargarComo } : undefined);
  return data?.signedUrl ?? null;
}
