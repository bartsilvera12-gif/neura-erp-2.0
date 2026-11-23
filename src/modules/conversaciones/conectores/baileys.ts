/**
 * Conector de WhatsApp por QR (solo servidor): habla por HTTP con el puente Baileys
 * (repo neura-whatsapp-bridge), un servicio aparte que mantiene la sesión de UN número.
 *   · Claves del canal (chat_canal_secretos): { bridge_url, bridge_secret }
 *   · ERP → puente: POST /send, POST /send-media, GET /status   (cabecera x-bridge-secret)
 *   · puente → ERP: /api/webhooks/baileys/inbound | inbound/media | inbound/telefonos | status
 * Por QR no hay plantillas ni ventana de 24 h: una plantilla sale como texto común.
 */
import { secretosDelCanal } from "@/lib/conversaciones/servidor";
import type { ConectorChat, DestinoChat, MediaSaliente, OpcionesEnvio, ResultadoEnvio } from "./tipos";

const TIEMPO = 30_000;
type Config = Record<string, unknown>;
const clave = (c: Config, k: string) => (typeof c[k] === "string" ? (c[k] as string).trim() : "");

/**
 * La URL del puente la carga el ADMIN y el servidor le pega: solo https (http en desarrollo) y
 * nunca a la propia red del servidor.
 */
export function urlPuenteValida(valor: string): string | null {
  let u: URL;
  try {
    u = new URL(valor.trim());
  } catch {
    return null;
  }
  const dev = process.env.NODE_ENV !== "production";
  if (u.protocol !== "https:" && !(dev && u.protocol === "http:")) return null;
  if (u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  const interna = h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.includes(":") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
  if (interna && !dev) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

function puenteDe(c: Config): { url: string; secreto: string } {
  const url = urlPuenteValida(clave(c, "bridge_url"));
  const secreto = clave(c, "bridge_secret") || process.env.BAILEYS_BRIDGE_SECRET?.trim() || "";
  if (!url) throw new Error("Falta la URL del puente de WhatsApp en el canal");
  if (!secreto) throw new Error("Falta el secreto del puente de WhatsApp en el canal");
  return { url, secreto };
}

async function pedir(c: Config, ruta: string, cuerpo?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const p = puenteDe(c);
  let r: Response;
  try {
    r = await fetch(`${p.url}${ruta}`, {
      method: cuerpo ? "POST" : "GET",
      headers: { "x-bridge-secret": p.secreto, ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(TIEMPO),
      cache: "no-store",
    });
  } catch {
    throw new Error("El puente de WhatsApp no responde. Revisá que esté prendido y que la URL sea la correcta.");
  }
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (r.status === 401) throw new Error("El puente rechazó el secreto: tiene que ser el mismo en el canal y en el puente (ERP_SHARED_SECRET).");
  if (!r.ok) throw new Error(String(j.error ?? `El puente de WhatsApp respondió ${r.status}`).slice(0, 300));
  return j;
}

const soloDigitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

async function enviar(d: DestinoChat, ruta: string, cuerpo: Record<string, unknown>): Promise<ResultadoEnvio> {
  const to = soloDigitos(d.telefono);
  if (to.length < 8) throw new Error("Falta el número del cliente");
  const j = await pedir(await secretosDelCanal(d.canal.id), ruta, { to, ...cuerpo });
  return { externo_id: typeof j.id === "string" && j.id ? j.id : null };
}

const TIPO_PUENTE: Record<MediaSaliente["tipo"], string> = { imagen: "image", video: "video", audio: "audio", documento: "document" };

export const conectorBaileys: ConectorChat = {
  proveedor: "baileys",
  enviarTexto: (d, texto, o?: OpcionesEnvio) => enviar(d, "/send", { text: texto, replyTo: o?.respondeAExterno ?? null }),
  enviarMedia: async (d, m) =>
    enviar(d, "/send-media", { url: await m.url(), tipo: TIPO_PUENTE[m.tipo] ?? "document", caption: m.caption ?? null, filename: m.nombre, mimetype: m.mime }),
  // Por QR no existen las plantillas: va el texto ya armado.
  enviarPlantilla: (d, p) => enviar(d, "/send", { text: p.texto }),
  // El puente no marca leídos (a propósito: no le roba las notificaciones al celular).
  async marcarLeido() {},
  // Necesita la rama del puente con POST /presence; un puente viejo responde 404 y no pasa nada.
  async escribiendo(d, activo) {
    const to = soloDigitos(d.telefono);
    if (to.length < 8) return;
    await pedir(await secretosDelCanal(d.canal.id), "/presence", { to, estado: activo ? "composing" : "paused" }).catch(() => {});
  },
};

export type EstadoPuente = { conexion: "conectado" | "qr" | "desconectado"; qr: string | null; numero: string | null };

/** Estado del puente: conectado, esperando que escaneen el QR (y cuál), o caído. */
export async function estadoPuente(c: Config): Promise<EstadoPuente> {
  const j = await pedir(c, "/status");
  const con = String(j.connection ?? "");
  const numero = soloDigitos(String(j.meNumber ?? "").split(/[:@]/)[0]) || null;
  if (con === "open") return { conexion: "conectado", qr: null, numero };
  const qr = typeof j.lastQr === "string" && j.lastQr ? j.lastQr : null;
  return { conexion: qr ? "qr" : "desconectado", qr, numero: null };
}

/** "Probar conexión" del canal por QR: llega al puente, el secreto sirve y hay un número vinculado. */
export async function probarPuente(identificador: string, c: Config): Promise<string> {
  const e = await estadoPuente(c);
  if (e.conexion === "qr") throw new Error("El puente responde, pero todavía no hay un número vinculado: tocá Vincular con QR y escanealo.");
  if (e.conexion !== "conectado") throw new Error("El puente responde, pero WhatsApp está reconectando. Probá de nuevo en un minuto.");
  const esperado = soloDigitos(identificador);
  if (e.numero && esperado && e.numero !== esperado) return `+${e.numero} vinculado (ojo: el canal dice ${esperado})`;
  return `+${e.numero ?? esperado} vinculado`;
}
