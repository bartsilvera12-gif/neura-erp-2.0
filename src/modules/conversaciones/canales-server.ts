/**
 * Canales de WhatsApp reales (receta 126) — lado servidor de la pantalla Omnicanal › Canales.
 * Las claves viven en chat_canal_secretos (service role): acá solo se dice si están, nunca su valor
 * (salvo el verify token de Meta, que hay que pegar en Meta, y los datos del puente de WhatsApp por
 * QR, que el ADMIN tiene que pegar en las variables del puente).
 */
import { systemClient } from "@/lib/supabase/clients";

export type ProveedorReal = "ycloud" | "meta" | "baileys";
export const CLAVES: Record<ProveedorReal, string[]> = {
  ycloud: ["api_key", "webhook_secret"],
  meta: ["access_token", "app_secret", "verify_token"],
  // WhatsApp por QR: dónde está el puente y el secreto que comparten.
  baileys: ["bridge_url", "bridge_secret"],
};

/** Las claves que el entorno ya resuelve para toda la app (el canal no las necesita). */
export const DEL_ENTORNO: Record<string, string> = {
  webhook_secret: "YCLOUD_WEBHOOK_SECRET", app_secret: "META_APP_SECRET", verify_token: "META_VERIFY_TOKEN", bridge_secret: "BAILEYS_BRIDGE_SECRET",
};
export const enEntorno = (k: string) => !!(DEL_ENTORNO[k] && process.env[DEL_ENTORNO[k]]?.trim());

type FilaCanal = {
  id: string; nombre: string; tipo: string; proveedor: string; identificador: string | null; numero: string | null; activo: boolean;
  ultimo_evento_at: string | null; ultimo_error: string | null; ultimo_error_at: string | null;
};

export async function listarCanales(empresaId: string, base: string) {
  const db = systemClient();
  const { data, error } = await db
    .from("chat_canales")
    .select("id, nombre, tipo, proveedor, identificador, numero, activo, ultimo_evento_at, ultimo_error, ultimo_error_at")
    .eq("empresa_id", empresaId)
    .eq("tipo", "whatsapp")
    .order("created_at");
  if (error) throw new Error(error.message);
  const filas = (data ?? []) as FilaCanal[];
  const { data: sec } = filas.length
    ? await db.from("chat_canal_secretos").select("canal_id, config").in("canal_id", filas.map((f) => f.id))
    : { data: [] };
  const conf = new Map(((sec ?? []) as { canal_id: string; config: Record<string, unknown> }[]).map((s) => [s.canal_id, s.config ?? {}]));
  return filas.map((f) => {
    const c = conf.get(f.id) ?? {};
    const lista = CLAVES[f.proveedor as ProveedorReal] ?? [];
    const texto = (k: string) => (typeof c[k] === "string" && c[k] ? String(c[k]) : null);
    return {
      ...f,
      claves: Object.fromEntries(lista.map((k) => [k, typeof c[k] === "string" && !!c[k] ? "canal" : enEntorno(k) ? "entorno" : null])) as Record<string, "canal" | "entorno" | null>,
      webhook: f.proveedor === "simulador" || f.proveedor === "baileys" ? null : `${base}/api/webhooks/chat/${f.proveedor}`,
      verify_token: f.proveedor === "meta" && typeof c.verify_token === "string" ? c.verify_token : null,
      // WhatsApp por QR: lo que va en las variables de entorno del puente de este número.
      puente: f.proveedor === "baileys"
        ? { url: texto("bridge_url"), entrada: `${base}/api/webhooks/baileys/inbound`, secreto: texto("bridge_secret"), canal_id: f.id, empresa_id: empresaId }
        : null,
    };
  });
}

/** Las claves que le faltan a un canal para poder prenderlo. */
export function clavesQueFaltan(proveedor: string, config: Record<string, unknown>): string[] {
  return (CLAVES[proveedor as ProveedorReal] ?? []).filter((k) => !(typeof config[k] === "string" && config[k]) && !enEntorno(k));
}
