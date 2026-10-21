/**
 * Secretos de SIFEN (solo servidor): cifrado de la contraseña del .p12, del CSC y de la clave
 * tributaria de clientes, lectura del .p12 y lectura de la tabla `sifen_secretos`.
 *
 *   · Cifrado AES-256-GCM con una clave derivada (scrypt) de SIFEN_SECRETS_KEY — mismo formato
 *     que sistemas-propio (`neura:v1:<iv>:<tag>:<datos>`), así un secreto migrado sigue sirviendo.
 *     La clave vive SOLO en el entorno del servidor: la base guarda el texto cifrado.
 *   · `sifen_secretos` no tiene ningún privilegio para la sesión del usuario (ni SELECT): se
 *     escribe por las funciones SECURITY DEFINER de la receta 61 y se lee acá con el cliente de
 *     sistema, SIEMPRE filtrado por la empresa que resolvió withTenant. Nada de esto se manda
 *     al navegador: las rutas devuelven solo "cargado / configurada" y metadatos.
 *   · Lectura del .p12 con el propio TLS de Node (createSecureContext): valida la contraseña y
 *     devuelve titular, RUC (serialNumber) y vencimiento del certificado.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, X509Certificate } from "node:crypto";
import { createSecureContext } from "node:tls";
import { systemClient } from "@/lib/supabase/clients";

const KDF_SALT = "neura-sifen-kdf-v1";
const PREFIX = "neura:v1:";
const IV_LEN = 16;

export class FaltaClaveSecretos extends Error {
  constructor() {
    super("Falta configurar SIFEN_SECRETS_KEY en el servidor (mínimo 32 caracteres aleatorios): sin ella no se pueden guardar contraseñas ni el CSC.");
  }
}

let claveCache: { raw: string; key: Buffer } | null = null;
function clave(): Buffer {
  const raw = process.env.SIFEN_SECRETS_KEY?.trim();
  if (!raw || raw.length < 16) throw new FaltaClaveSecretos();
  if (claveCache?.raw !== raw) claveCache = { raw, key: scryptSync(raw, KDF_SALT, 32, { N: 16384, r: 8, p: 1 }) };
  return claveCache.key;
}

export function hayClaveSecretos(): boolean {
  const raw = process.env.SIFEN_SECRETS_KEY?.trim();
  return Boolean(raw && raw.length >= 16);
}

export function cifrar(texto: string): string {
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv("aes-256-gcm", clave(), iv);
  const enc = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return `${PREFIX}${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

export function descifrar(guardado: string): string {
  if (!guardado.startsWith(PREFIX)) throw new Error("Secreto con formato desconocido");
  const [iv, tag, datos] = guardado.slice(PREFIX.length).split(":");
  if (!iv || !tag || !datos) throw new Error("Secreto cifrado dañado");
  const d = createDecipheriv("aes-256-gcm", clave(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(datos, "base64")), d.final()]).toString("utf8");
}

// ── .p12 ─────────────────────────────────────────────────────────────────────
export type DatosCertificado = { titular: string; ruc: string | null; vencimiento: string; emisor: string };

/** Abre el .p12 con la contraseña. Error con mensaje claro si la contraseña no es o el archivo no sirve. */
export function leerP12(p12: Buffer, password: string): DatosCertificado {
  let der: Buffer | undefined;
  try {
    const ctx = createSecureContext({ pfx: p12, passphrase: password });
    der = (ctx.context as unknown as { getCertificate?: () => Buffer | null }).getCertificate?.() ?? undefined;
  } catch (e) {
    const m = (e as Error).message || "";
    if (/mac verify|bad decrypt|wrong password|invalid password/i.test(m)) throw new Error("La contraseña no corresponde al certificado .p12");
    throw new Error("No se pudo abrir el certificado: revisá que sea un .p12 / .pfx válido");
  }
  if (!der) throw new Error("El .p12 no tiene un certificado dentro");
  const x = new X509Certificate(der);
  const campo = (dn: string, k: string) => dn.split("\n").map((l) => l.trim()).find((l) => l.toUpperCase().startsWith(`${k.toUpperCase()}=`))?.slice(k.length + 1) ?? null;
  const cn = campo(x.subject, "CN") ?? x.subject.replace(/\n/g, ", ");
  const serial = campo(x.subject, "serialNumber");
  const ruc = serial?.match(/(\d{3,8}-?\d)/)?.[1] ?? null;
  const venc = new Date(x.validTo);
  return {
    titular: cn,
    ruc,
    vencimiento: Number.isNaN(venc.getTime()) ? "" : venc.toISOString().slice(0, 10),
    emisor: campo(x.issuer, "CN") ?? x.issuer.replace(/\n/g, ", "),
  };
}

// ── Lectura de sifen_secretos (cliente de sistema, siempre acotado a la empresa) ──
function bytea(v: unknown): Buffer | null {
  if (typeof v !== "string" || !v) return null;
  return v.startsWith("\\x") ? Buffer.from(v.slice(2), "hex") : Buffer.from(v, "base64");
}

export async function leerSecretos(empresaId: string): Promise<{ p12: Buffer | null; passwordCifrada: string | null; kudeLogo: Buffer | null }> {
  if (!empresaId) throw new Error("leerSecretos requiere la empresa");
  const { data, error } = await systemClient()
    .from("sifen_secretos")
    .select("certificado_p12, certificado_password_cifrada, kude_logo_png")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as { certificado_p12?: string; certificado_password_cifrada?: string | null; kude_logo_png?: string };
  return { p12: bytea(r.certificado_p12), passwordCifrada: r.certificado_password_cifrada ?? null, kudeLogo: bytea(r.kude_logo_png) };
}
