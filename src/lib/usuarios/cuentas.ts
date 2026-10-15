/**
 * Cuentas de acceso (GoTrue) de los usuarios del ERP. SOLO SERVIDOR: usa el cliente de
 * servicio (service role), que nunca llega al navegador.
 *
 * El servidor de auth es COMPARTIDO por toda la flota (cada cliente tiene su schema, pero
 * las cuentas son las mismas). Por eso:
 *   · el alta es por INVITACIÓN: la persona recibe un link y pone su contraseña; el admin
 *     nunca escribe ni ve contraseñas.
 *   · si el email ya tiene cuenta (la usa otro sistema), no se toca: solo se la vincula a
 *     esta empresa (fila en usuarios) y entra con la contraseña que ya tiene.
 *   · los links que se copian (WhatsApp) solo se generan para cuentas creadas desde esta
 *     empresa: con un link de otra cuenta, un admin podría entrar como esa persona en el
 *     otro sistema. Para cuentas vinculadas, el restablecimiento va por email a su dueño.
 */
import type { NextRequest } from "next/server";
import { authOnlyClient, systemClient } from "@/lib/supabase/clients";
import { tenantSchema } from "@/lib/tenant/schema";

export type CuentaExistente = {
  auth_user_id?: string;
  email?: string;
  confirmado?: boolean;
  usuario?: { id: string; empresa_id: string; activo: boolean } | null;
};

export type InfoCuenta = {
  usuario_id?: string;
  auth_user_id?: string;
  nombre?: string;
  origen?: string;
  activo?: boolean;
  email?: string;
  existe?: boolean;
  confirmado?: boolean;
  ultimo_ingreso?: string | null;
};

/** ¿Hay una cuenta con este email en el servidor de auth? (y si ya es usuario de este schema) */
export async function buscarCuenta(email: string): Promise<CuentaExistente | null> {
  const { data, error } = await systemClient(tenantSchema()).rpc("auth_buscar_email", { p_email: email });
  if (error) throw new Error(error.message);
  const c = data as CuentaExistente | null;
  return c?.auth_user_id ? c : null;
}

/** Datos de la cuenta de un usuario de la empresa. */
export async function infoCuenta(usuarioId: string, empresaId: string): Promise<InfoCuenta | null> {
  const { data, error } = await systemClient(tenantSchema()).rpc("auth_usuario_info", { p_usuario: usuarioId, p_empresa: empresaId });
  if (error) throw new Error(error.message);
  const c = data as InfoCuenta | null;
  return c?.usuario_id ? c : null;
}

/**
 * URL pública de la app (para los links). NEXT_PUBLIC_SITE_URL / APP_URL si está; si no, la
 * del pedido (detrás del proxy, x-forwarded-*).
 */
export function urlBase(req: NextRequest): string {
  const env = (process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (/^https?:\/\//.test(env)) return env;
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "") || "https";
  return host ? `${proto}://${host}` : req.nextUrl.origin;
}

const errorAuth = (e: { message?: string; status?: number } | null | undefined, porDefecto: string) => {
  const m = e?.message ?? "";
  if (/rate limit|too many/i.test(m)) return "Se mandaron demasiados emails seguidos. Esperá unos minutos o copiá el link.";
  if (/smtp|sending|mail/i.test(m)) return "El servidor de correo no está configurado o falló. Usá \"Copiar link\" y mandalo por WhatsApp.";
  return m ? `${porDefecto} (${m})` : porDefecto;
};

/** Invita por email (GoTrue manda el correo). Crea la cuenta si no existe. */
export async function invitarPorEmail(email: string, redirectTo: string, nombre: string): Promise<{ authUserId: string }> {
  const { data, error } = await systemClient().auth.admin.inviteUserByEmail(email, { redirectTo, data: { nombre } });
  if (error || !data.user?.id) throw new Error(errorAuth(error, "No se pudo mandar la invitación"));
  return { authUserId: data.user.id };
}

/**
 * Link de invitación o de restablecer contraseña, para mandar por WhatsApp. No manda email.
 * El link apunta a /bienvenida de ESTA app con el token (no depende de la lista de URLs
 * permitidas del servidor de auth compartido).
 */
export async function generarLink(tipo: "invite" | "recovery", email: string, base: string, nombre?: string): Promise<{ authUserId: string; link: string }> {
  const sb = systemClient();
  const { data, error } =
    tipo === "invite"
      ? await sb.auth.admin.generateLink({ type: "invite", email, options: { redirectTo: `${base}/bienvenida`, data: nombre ? { nombre } : undefined } })
      : await sb.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: `${base}/bienvenida` } });
  const hash = data?.properties?.hashed_token;
  if (error || !data?.user?.id || !hash) throw new Error(errorAuth(error, "No se pudo generar el link"));
  const q = new URLSearchParams({ token_hash: hash, type: tipo });
  return { authUserId: data.user.id, link: `${base}/bienvenida?${q.toString()}` };
}

/** Email para restablecer la contraseña (le llega a su dueño; el admin no ve nada). */
export async function enviarRestablecer(email: string, base: string): Promise<void> {
  const { error } = await authOnlyClient().auth.resetPasswordForEmail(email, { redirectTo: `${base}/bienvenida` });
  if (error) throw new Error(errorAuth(error, "No se pudo mandar el email"));
}

/**
 * Borra una cuenta que se ACABA de crear acá y no llegó a quedar como usuario (falló el
 * alta). Nunca se usa para cuentas que ya existían.
 */
export async function borrarCuentaNueva(authUserId: string): Promise<void> {
  await systemClient().auth.admin.deleteUser(authUserId).catch(() => undefined);
}
