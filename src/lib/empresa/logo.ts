/**
 * Logo de la empresa (Configuración › Datos de la empresa › Logo de los documentos). Solo servidor.
 *
 *   · Bucket PÚBLICO `empresas-logos` (receta 62): un logo no es sensible y lo usa también el
 *     link público del presupuesto. Escribe SOLO el servidor con el cliente de sistema; la ruta
 *     la arma siempre el servidor: {schema}/{empresa}/logo-<marca>.{png|jpg} (el que usan los
 *     PDF) y {schema}/{empresa}/original-<marca>.{png|jpg} (receta 63: el original normalizado,
 *     para volver a la imagen con fondo o volver a quitárselo).
 *   · Lo que sube el usuario (PNG / JPG / WEBP ≤ 2 MB) se normaliza con sharp
 *     (src/lib/empresa/logo-imagen.ts): original enderezado ≤ 1200 px y, a partir de él, el logo
 *     ≤ 600 px; al subir se le quita el fondo liso automáticamente (PNG con transparencia). Si
 *     no se detecta un fondo liso se guarda tal cual (PNG si tiene transparencia, si no JPEG).
 *     jsPDF no dibuja SVG ni WEBP: por eso no se aceptan tal cual.
 */
import { randomBytes } from "node:crypto";
import { systemClient } from "@/lib/supabase/clients";
import { tenantSchema } from "@/lib/tenant/schema";
import { logoDesdeOriginal, prepararOriginal, type FondoLogo, type LogoNormalizado } from "@/lib/empresa/logo-imagen";

export type { FondoLogo, LogoNormalizado };
export const LOGOS_BUCKET = "empresas-logos";
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** Valida lo que subió el usuario, arma el original y el logo (con el fondo quitado si corresponde). */
export async function procesarLogoSubido(entrada: Buffer) {
  const original = await prepararOriginal(entrada, LOGO_MAX_BYTES);
  if ("error" in original) return original;
  const r = await logoDesdeOriginal(original.datos, "auto");
  if ("error" in r) return r;
  return { original, ...r };
}

/** A partir del original guardado: con o sin el fondo (lo eligió el usuario). */
export const logoDesdeOriginalGuardado = (original: Buffer, quitarFondo: boolean) =>
  logoDesdeOriginal(original, quitarFondo ? "quitar" : "original");

const prefijo = (empresaId: string) => `${tenantSchema()}/${empresaId}/`;
const bucket = () => systemClient().storage.from(LOGOS_BUCKET);
const marca = () => `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;

/** Sube un archivo a una ruta nueva (cada versión su URL: sin cachés viejas). */
async function subir(empresaId: string, tipo: "logo" | "original", img: LogoNormalizado): Promise<{ path: string; url: string } | { error: string }> {
  if (!empresaId) return { error: "Falta la empresa" };
  const path = `${prefijo(empresaId)}${tipo}-${marca()}.${img.ext}`;
  const { error } = await bucket().upload(path, img.datos, { contentType: img.mime, upsert: false, cacheControl: "31536000" });
  if (error) return { error: `No se pudo guardar el logo: ${error.message}` };
  return { path, url: bucket().getPublicUrl(path).data.publicUrl };
}

export const subirLogoEmpresa = (empresaId: string, logo: LogoNormalizado) => subir(empresaId, "logo", logo);
export const subirOriginalEmpresa = (empresaId: string, original: LogoNormalizado) => subir(empresaId, "original", original);

/** Baja el original guardado (solo de la carpeta de ESA empresa). */
export async function bajarOriginalEmpresa(empresaId: string, path: string | null | undefined): Promise<Buffer | null> {
  if (!path || !empresaId || !path.startsWith(prefijo(empresaId)) || !/\/original-[0-9a-z-]+\.(png|jpg)$/.test(path)) return null;
  const { data, error } = await bucket().download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/** Borra versiones viejas (logo u original; solo dentro de la carpeta de ESA empresa). */
export async function borrarLogoEmpresa(empresaId: string, ...paths: (string | null | undefined)[]): Promise<void> {
  const propias = paths.filter((p): p is string => !!p && !!empresaId && p.startsWith(prefijo(empresaId)));
  if (propias.length) await bucket().remove(propias).catch(() => {});
}

/** URL pública esperada para un logo de este bucket (los PDF solo bajan de acá). */
export function esUrlLogoPropia(url: string): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
  return !!base && url.startsWith(`${base}/storage/v1/object/public/${LOGOS_BUCKET}/`);
}
