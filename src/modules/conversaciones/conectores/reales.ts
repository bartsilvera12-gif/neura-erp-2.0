/**
 * Conectores REALES de WhatsApp (solo servidor). Leen las claves del canal de chat_canal_secretos:
 *   · ycloud: { api_key, webhook_secret }                — api.ycloud.com/v2/whatsapp/messages
 *   · meta:   { access_token, app_secret, verify_token } — graph.facebook.com/<versión>/<phone_number_id>/messages
 * El identificador del canal es el número de negocio (YCloud) o el phone_number_id (Meta).
 * También bajan la media entrante (foto del comprobante) y prueban las credenciales.
 */
import { secretosDelCanal } from "@/lib/conversaciones/servidor";
import type { MediaEntrante } from "./normalizadores";
import type { ConectorChat, DestinoChat, MediaSaliente, OpcionesEnvio, ResultadoEnvio } from "./tipos";

export const GRAPH = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION?.trim() || "v21.0"}`;
const YCLOUD = "https://api.ycloud.com/v2";
const TIEMPO = 20_000;

type Config = Record<string, unknown>;
const clave = (c: Config, k: string) => (typeof c[k] === "string" ? (c[k] as string).trim() : "");
const e164 = (digitos: string | null | undefined) => {
  const d = (digitos ?? "").replace(/\D/g, "");
  return d.length >= 8 ? `+${d}` : null;
};

async function pedir(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(TIEMPO) });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const e = (j.error ?? {}) as Record<string, unknown>;
    const msg = String(e.message ?? j.message ?? `HTTP ${r.status}`);
    if (r.status === 401 || /invalid_api_key|invalid oauth|access token/i.test(msg)) throw new Error("La clave del proveedor no es válida o venció");
    throw new Error(msg.slice(0, 300));
  }
  return j;
}

// ── YCloud ───────────────────────────────────────────────────────────────────
async function ycloudEnviar(d: DestinoChat, cuerpo: Record<string, unknown>, o?: OpcionesEnvio): Promise<ResultadoEnvio> {
  const c = await secretosDelCanal(d.canal.id);
  const key = clave(c, "api_key");
  if (!key) throw new Error("Falta la API key de YCloud en el canal");
  const from = e164(d.canal.identificador);
  const to = e164(d.telefono);
  if (!from || !to) throw new Error("Falta el número de negocio o el del cliente");
  const j = await pedir(`${YCLOUD}/whatsapp/messages`, {
    method: "POST",
    headers: { "X-API-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, ...cuerpo, ...(o?.respondeAExterno ? { context: { message_id: o.respondeAExterno } } : {}) }),
  });
  if (String(j.status ?? "").toLowerCase() === "failed") throw new Error(String(j.errorMessage ?? "YCloud marcó el mensaje como fallido"));
  return { externo_id: (typeof j.wamid === "string" && j.wamid) || (typeof j.id === "string" ? j.id : null) };
}

function cuerpoMedia(m: MediaSaliente, link: string): Record<string, unknown> {
  const tipo = m.tipo === "imagen" ? "image" : m.tipo === "video" ? "video" : m.tipo === "audio" ? "audio" : "document";
  const parte: Record<string, unknown> = { link };
  if (tipo !== "audio" && m.caption) parte.caption = m.caption;
  if (tipo === "document") parte.filename = (m.nombre || "archivo").slice(0, 240);
  return { type: tipo, [tipo]: parte };
}

function cuerpoPlantilla(p: { id: string; idioma: string; variables: string[] }) {
  return {
    type: "template",
    template: {
      name: p.id,
      language: { code: p.idioma },
      ...(p.variables.length ? { components: [{ type: "body", parameters: p.variables.map((t) => ({ type: "text", text: t })) }] } : {}),
    },
  };
}

export const conectorYcloud: ConectorChat = {
  proveedor: "ycloud",
  enviarTexto: (d, texto, o) => ycloudEnviar(d, { type: "text", text: { body: texto, preview_url: true } }, o),
  enviarMedia: async (d, m, o) => ycloudEnviar(d, cuerpoMedia(m, await m.url()), o),
  enviarPlantilla: (d, p) => ycloudEnviar(d, cuerpoPlantilla(p)),
  async marcarLeido(d, externo) {
    const key = clave(await secretosDelCanal(d.canal.id), "api_key");
    if (!key || !externo) return;
    await pedir(`${YCLOUD}/whatsapp/inboundMessages/${encodeURIComponent(externo)}/markAsRead`, { method: "POST", headers: { "X-API-Key": key } }).catch(() => {});
  },
};

// ── Meta (WhatsApp Cloud API) ────────────────────────────────────────────────
async function metaEnviar(d: DestinoChat, cuerpo: Record<string, unknown>, o?: OpcionesEnvio): Promise<ResultadoEnvio> {
  const token = clave(await secretosDelCanal(d.canal.id), "access_token");
  if (!token) throw new Error("Falta el token de Meta en el canal");
  const to = (d.telefono ?? "").replace(/\D/g, "");
  if (!d.canal.identificador || to.length < 8) throw new Error("Falta el phone_number_id o el número del cliente");
  const j = await pedir(`${GRAPH}/${encodeURIComponent(d.canal.identificador)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...cuerpo, ...(o?.respondeAExterno ? { context: { message_id: o.respondeAExterno } } : {}) }),
  });
  const m = Array.isArray(j.messages) ? (j.messages[0] as Record<string, unknown> | undefined) : undefined;
  return { externo_id: typeof m?.id === "string" ? m.id : null };
}

export const conectorMeta: ConectorChat = {
  proveedor: "meta",
  enviarTexto: (d, texto, o) => metaEnviar(d, { type: "text", text: { body: texto, preview_url: true } }, o),
  enviarMedia: async (d, m, o) => metaEnviar(d, cuerpoMedia(m, await m.url()), o),
  enviarPlantilla: (d, p) => metaEnviar(d, cuerpoPlantilla(p)),
  async marcarLeido(d, externo) {
    const token = clave(await secretosDelCanal(d.canal.id), "access_token");
    if (!token || !externo || !d.canal.identificador) return;
    await pedir(`${GRAPH}/${encodeURIComponent(d.canal.identificador)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: externo }),
    }).catch(() => {});
  },
};

// ── Media entrante ───────────────────────────────────────────────────────────
const MAX_MEDIA = 16 * 1024 * 1024;

async function bajar(url: string, headers: Record<string, string>): Promise<{ datos: Buffer; mime: string | null }> {
  // En producción solo https; en desarrollo se acepta http (pruebas locales).
  if (!/^https:\/\//i.test(url) && !(process.env.NODE_ENV !== "production" && /^http:\/\//i.test(url))) throw new Error("Link de media inválido");
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(TIEMPO) });
  if (!r.ok) throw new Error(`No se pudo bajar el archivo (HTTP ${r.status})`);
  const largo = Number(r.headers.get("content-length") ?? 0);
  if (largo > MAX_MEDIA) throw new Error("Archivo demasiado grande");
  const datos = Buffer.from(await r.arrayBuffer());
  if (datos.length > MAX_MEDIA) throw new Error("Archivo demasiado grande");
  return { datos, mime: r.headers.get("content-type")?.split(";")[0]?.trim() || null };
}

/** Baja la media de un mensaje entrante con la clave del canal. */
export async function bajarMediaEntrante(proveedor: string, canalId: string, m: MediaEntrante): Promise<{ datos: Buffer; mime: string }> {
  const c = await secretosDelCanal(canalId);
  if (proveedor === "ycloud") {
    const key = clave(c, "api_key");
    if (!m.link) throw new Error("El mensaje no trae el link del archivo");
    const r = await bajar(m.link, key ? { "X-API-Key": key } : {});
    return { datos: r.datos, mime: m.mime || r.mime || "application/octet-stream" };
  }
  if (proveedor === "meta") {
    const token = clave(c, "access_token");
    if (!token || !m.id) throw new Error("Falta el token de Meta o el id del archivo");
    const info = await pedir(`${GRAPH}/${encodeURIComponent(m.id)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (typeof info.url !== "string") throw new Error("Meta no devolvió el link del archivo");
    const r = await bajar(info.url, { Authorization: `Bearer ${token}` });
    return { datos: r.datos, mime: m.mime || (typeof info.mime_type === "string" ? info.mime_type : null) || r.mime || "application/octet-stream" };
  }
  throw new Error("Proveedor sin media");
}

/** Prueba las credenciales del canal sin mandar mensajes. Devuelve qué número respondió. */
export async function probarCredenciales(proveedor: string, identificador: string, c: Config): Promise<string> {
  if (proveedor === "ycloud") {
    const key = clave(c, "api_key");
    if (!key) throw new Error("Falta la API key");
    const j = await pedir(`${YCLOUD}/whatsapp/phoneNumbers?limit=100`, { headers: { "X-API-Key": key } });
    const items = Array.isArray(j.items) ? (j.items as Record<string, unknown>[]) : [];
    const n = items.find((x) => String(x.phoneNumber ?? "").replace(/\D/g, "") === identificador.replace(/\D/g, ""));
    if (!n) throw new Error(`La API key anda, pero el número ${identificador} no está en esa cuenta de YCloud`);
    return `${n.phoneNumber}${n.verifiedName ? ` · ${n.verifiedName}` : ""}${n.status ? ` · ${n.status}` : ""}`;
  }
  if (proveedor === "meta") {
    const token = clave(c, "access_token");
    if (!token) throw new Error("Falta el token");
    const j = await pedir(`${GRAPH}/${encodeURIComponent(identificador)}?fields=display_phone_number,verified_name,quality_rating`, { headers: { Authorization: `Bearer ${token}` } });
    return `${j.display_phone_number ?? identificador}${j.verified_name ? ` · ${j.verified_name}` : ""}`;
  }
  throw new Error("Proveedor no soportado");
}
