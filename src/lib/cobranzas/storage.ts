/**
 * Storage de los comprobantes de transferencias (Conciliación bancaria): bucket PRIVADO
 * "cobros-comprobantes" (8 MB por archivo, JPG/PNG/WebP/PDF).
 *
 * Igual que los comprobantes de compra: el archivo lo sube el SERVIDOR con el cliente de
 * sistema y para verlo se emite una URL firmada de 1 hora. La ruta la arma siempre el
 * servidor dentro de `{empresa}/{cobro}/`: nunca la decide el navegador.
 */
import { systemClient } from "@/lib/supabase/clients";
import { contenidoCoincide } from "@/lib/compras/storage";

export const COBROS_BUCKET = "cobros-comprobantes";
export const COMPROBANTE_COBRO_MAX_BYTES = 8 * 1024 * 1024;
const URL_TTL_S = 60 * 60;

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
const POR_EXTENSION: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };

/** Tipo final del archivo o null si no se acepta (solo JPG, PNG, WebP y PDF). */
export function mimeComprobanteCobro(nombre: string, tipo: string): string | null {
  const t = (tipo || "").toLowerCase();
  if (EXT[t]) return t;
  const ext = nombre.toLowerCase().split(".").pop() ?? "";
  if ((!t || t === "application/octet-stream") && POR_EXTENSION[ext]) return POR_EXTENSION[ext];
  return null;
}

export type ArchivoValidado = { datos: Uint8Array; mime: string; nombre: string };

/** Valida un archivo de form-data: tamaño, tipo y firma del contenido. */
export async function validarComprobanteCobro(f: File): Promise<ArchivoValidado | { error: string }> {
  const nombre = (f.name || "comprobante").slice(0, 200);
  if (f.size === 0) return { error: `«${nombre}» está vacío.` };
  if (f.size > COMPROBANTE_COBRO_MAX_BYTES) return { error: `«${nombre}» supera los 8 MB.` };
  const mime = mimeComprobanteCobro(nombre, f.type);
  if (!mime) return { error: `«${nombre}» no es una foto (JPG, PNG, WebP) ni un PDF.` };
  const datos = new Uint8Array(await f.arrayBuffer());
  if (!contenidoCoincide(datos, mime)) return { error: `«${nombre}» no parece ser un ${mime === "application/pdf" ? "PDF" : "archivo de imagen"} válido.` };
  return { datos, mime, nombre };
}

export function prefijoComprobanteCobro(empresaId: string, cobroId: string): string {
  return `${empresaId}/${cobroId}/`;
}

/** Ruta dentro del bucket: {empresa}/{cobro}/comprobante.{ext}. */
export function pathComprobanteCobro(empresaId: string, cobroId: string, mime: string): string {
  return `${prefijoComprobanteCobro(empresaId, cobroId)}comprobante.${EXT[mime] ?? "bin"}`;
}

function bucket() {
  return systemClient().storage.from(COBROS_BUCKET);
}

export async function subirComprobanteCobro(path: string, datos: Uint8Array, mime: string): Promise<{ error?: string }> {
  const { error } = await bucket().upload(path, datos, { contentType: mime, upsert: false });
  return error ? { error: error.message } : {};
}

export async function borrarComprobanteCobro(path: string): Promise<void> {
  await bucket().remove([path]).catch(() => {});
}

/** URL firmada (1 h) para ver el comprobante. */
export async function urlComprobanteCobro(path: string): Promise<string | null> {
  const { data } = await bucket().createSignedUrl(path, URL_TTL_S);
  return data?.signedUrl ?? null;
}
