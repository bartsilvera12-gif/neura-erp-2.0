/**
 * Logo de la empresa (Configuración › Datos de la empresa › Logo de los documentos). Solo servidor.
 *
 *   · Bucket PÚBLICO `empresas-logos` (receta 62): un logo no es sensible y lo usa también el
 *     link público del presupuesto. Escribe SOLO el servidor con el cliente de sistema; la ruta
 *     la arma siempre el servidor: {schema}/{empresa}/logo-<marca>.{png|jpg}.
 *   · Lo que sube el usuario (PNG / JPG / WEBP ≤ 2 MB) se normaliza con sharp: se endereza
 *     (EXIF), se achica a lado mayor ≤ 600 px y queda en PNG si tiene transparencia o en
 *     JPEG (fondo blanco) si no la tiene. jsPDF no dibuja SVG ni WEBP: por eso no se aceptan
 *     tal cual. Así los PDF no pesan y siempre tienen ancho/alto conocidos.
 */
import { randomBytes } from "node:crypto";
import { systemClient } from "@/lib/supabase/clients";
import { tenantSchema } from "@/lib/tenant/schema";

export const LOGOS_BUCKET = "empresas-logos";
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LADO_MAX = 600;
const SALIDA_MAX_BYTES = 1024 * 1024; // límite del bucket

export type LogoNormalizado = { datos: Buffer; mime: "image/png" | "image/jpeg"; ext: "png" | "jpg"; ancho: number; alto: number };

/** Valida y normaliza la imagen. Devuelve { error } con un mensaje para el usuario si no sirve. */
export async function normalizarLogo(entrada: Buffer): Promise<LogoNormalizado | { error: string }> {
  if (entrada.length < 1) return { error: "El archivo está vacío." };
  if (entrada.length > LOGO_MAX_BYTES) return { error: "El logo no puede superar 2 MB." };
  const sharp = (await import("sharp")).default;
  let meta;
  try {
    meta = await sharp(entrada, { limitInputPixels: 40_000_000 }).metadata();
  } catch {
    return { error: "No se pudo leer la imagen: subí un PNG, JPG o WEBP válido." };
  }
  if (!meta.format || !["png", "jpeg", "webp"].includes(meta.format)) return { error: "Formato no aceptado: subí un PNG, JPG o WEBP (SVG no)." };
  if ((meta.pages ?? 1) > 1) return { error: "El logo no puede ser animado." };
  try {
    const base = () =>
      sharp(entrada, { limitInputPixels: 40_000_000 }).rotate().resize({ width: LADO_MAX, height: LADO_MAX, fit: "inside", withoutEnlargement: true });
    const { isOpaque } = await base().stats();
    const opaco = isOpaque || !meta.hasAlpha;
    let out = opaco
      ? await base().flatten({ background: "#ffffff" }).jpeg({ quality: 88, mozjpeg: true }).toBuffer({ resolveWithObject: true })
      : await base().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer({ resolveWithObject: true });
    if (!opaco && out.data.length > SALIDA_MAX_BYTES) out = await base().png({ palette: true, compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
    if (out.data.length > SALIDA_MAX_BYTES) return { error: "El logo es demasiado pesado aun achicado: probá con una imagen más simple." };
    return { datos: out.data, mime: opaco ? "image/jpeg" : "image/png", ext: opaco ? "jpg" : "png", ancho: out.info.width, alto: out.info.height };
  } catch {
    return { error: "No se pudo procesar la imagen: probá con otro archivo." };
  }
}

const prefijo = (empresaId: string) => `${tenantSchema()}/${empresaId}/`;
const bucket = () => systemClient().storage.from(LOGOS_BUCKET);

/** Sube el logo ya normalizado a una ruta nueva (cada versión su URL: sin cachés viejas). */
export async function subirLogoEmpresa(empresaId: string, logo: LogoNormalizado): Promise<{ path: string; url: string } | { error: string }> {
  if (!empresaId) return { error: "Falta la empresa" };
  const path = `${prefijo(empresaId)}logo-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}.${logo.ext}`;
  const { error } = await bucket().upload(path, logo.datos, { contentType: logo.mime, upsert: false, cacheControl: "31536000" });
  if (error) return { error: `No se pudo guardar el logo: ${error.message}` };
  return { path, url: bucket().getPublicUrl(path).data.publicUrl };
}

/** Borra una versión vieja del logo (solo dentro de la carpeta de ESA empresa). */
export async function borrarLogoEmpresa(empresaId: string, path: string | null | undefined): Promise<void> {
  if (!path || !empresaId || !path.startsWith(prefijo(empresaId))) return;
  await bucket().remove([path]).catch(() => {});
}

/** URL pública esperada para un logo de este bucket (los PDF solo bajan de acá). */
export function esUrlLogoPropia(url: string): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
  return !!base && url.startsWith(`${base}/storage/v1/object/public/${LOGOS_BUCKET}/`);
}
