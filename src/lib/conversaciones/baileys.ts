/**
 * Lado ERP del puente de WhatsApp por QR (Baileys, repo neura-whatsapp-bridge). Solo servidor.
 * El puente es UNO por número y le habla al ERP con la cabecera x-bridge-secret:
 *   · /inbound            mensaje entrante (JSON)          → cola chat_eventos + procesarEvento
 *   · /inbound/media      el archivo de ese mensaje        → erp-chat + se completa el mensaje
 *   · /inbound/telefonos  código interno (@lid) → teléfono → corrige el número del contacto
 *   · /status             tildes de lo que mandamos        → estado_entrega
 * El secreto es el del CANAL (chat_canal_secretos.bridge_secret) o, si está, BAILEYS_BRIDGE_SECRET.
 */
import { timingSafeEqual } from "node:crypto";
import { systemClient } from "@/lib/supabase/clients";
import { canalPorId, pathAdjuntoChat, secretosDelCanal, subirAdjuntoChat, type CanalChat } from "@/lib/conversaciones/servidor";
import { CARTEL_MEDIA } from "@/modules/conversaciones/conectores/normalizadores";
import { botVendedor } from "@/lib/bot-vendedor/bot";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const esUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const COLS_CANAL = "id, empresa_id, nombre, tipo, proveedor, identificador, activo";

function igual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function secretoSirve(canalId: string, recibido: string): Promise<boolean> {
  const c = await secretosDelCanal(canalId);
  const delCanal = typeof c.bridge_secret === "string" ? c.bridge_secret.trim() : "";
  const delEntorno = process.env.BAILEYS_BRIDGE_SECRET?.trim() || "";
  return [delCanal, delEntorno].some((s) => !!s && igual(recibido, s));
}

/**
 * El canal por QR al que pertenece el pedido del puente, o null si el secreto no corresponde.
 * /inbound y /inbound/media traen channelId; /status y /inbound/telefonos solo empresaId (se busca
 * entre los canales por QR de esa empresa el que tenga ese secreto).
 */
export async function canalDelPuente(headers: Headers, ids: { canalId?: unknown; empresaId?: unknown }): Promise<CanalChat | null> {
  const recibido = headers.get("x-bridge-secret")?.trim() ?? "";
  if (!recibido) return null;
  if (esUuid(ids.canalId)) {
    const canal = await canalPorId(ids.canalId);
    return canal && canal.proveedor === "baileys" && (await secretoSirve(canal.id, recibido)) ? canal : null;
  }
  if (!esUuid(ids.empresaId)) return null;
  const { data } = await systemClient().from("chat_canales").select(COLS_CANAL).eq("empresa_id", ids.empresaId).eq("proveedor", "baileys");
  for (const canal of (data ?? []) as CanalChat[]) if (await secretoSirve(canal.id, recibido)) return canal;
  return null;
}

const TIPO_DE_CLASE: Record<string, string> = { image: "imagen", video: "video", audio: "audio", document: "documento", sticker: "sticker" };
const CARTELES = new Set(Object.values(CARTEL_MEDIA));
export const MAX_MEDIA_PUENTE = 100 * 1024 * 1024;

/**
 * Completa un mensaje entrante con su archivo. "pendiente" = el mensaje todavía no se registró
 * (el puente reintenta solo a los pocos segundos).
 */
export async function adjuntarMediaEntrante(
  canal: CanalChat, externoId: string, clase: string, archivo: { datos: Buffer; mime: string; nombre: string },
): Promise<"ok" | "pendiente" | "repetido"> {
  const db = systemClient();
  const { data } = await db.from("chat_mensajes").select("id, conversacion_id, contenido, media_path").eq("empresa_id", canal.empresa_id).eq("externo_id", externoId).limit(1);
  const m = (data?.[0] ?? null) as { id: string; conversacion_id: string; contenido: string | null; media_path: string | null } | null;
  if (!m) return "pendiente";
  if (m.media_path) return "repetido";
  const mime = archivo.mime.split(";")[0].trim().toLowerCase() || "application/octet-stream";
  const path = pathAdjuntoChat(canal.empresa_id, m.conversacion_id, archivo.nombre);
  const { error } = await subirAdjuntoChat(path, archivo.datos, mime);
  if (error) throw new Error(error);
  const tipo = TIPO_DE_CLASE[clase] ?? "documento";
  const { error: errUpd } = await db
    .from("chat_mensajes")
    .update({ tipo, media_path: path, media_mime: mime, media_nombre: archivo.nombre, media_size: archivo.datos.length, contenido: m.contenido && CARTELES.has(m.contenido) ? null : m.contenido })
    .eq("id", m.id);
  if (errUpd) throw new Error(errUpd.message);
  // Que el chat abierto vuelva a pedir el mensaje (ahora con su archivo). Si falla, se ve al recargar.
  try {
    await db.rpc("chat_avisar", { p_topic: `chat:conv:${m.conversacion_id}`, p_evento: "mensaje", p_payload: { id: m.id } });
  } catch {
    /* solo es el aviso en vivo */
  }
  // Por QR la foto llega después del mensaje: recién ahora el bot vendedor puede tomarla (ej. el
  // comprobante de una transferencia). Va en segundo plano para no demorar al puente.
  const contenido = m.contenido && CARTELES.has(m.contenido) ? null : m.contenido;
  // Audios y videos ya se contestaron con el cartel (el bot no los escucha ni los mira).
  if (tipo === "imagen" || tipo === "documento") {
    void botVendedor({ conversacion_id: m.conversacion_id, mensaje_id: m.id, tipo, contenido, media_path: path, media_mime: mime, archivoTardio: true });
  }
  return "ok";
}

const ESTADO: Record<string, string> = { sent: "enviado", delivered: "entregado", read: "leido", failed: "fallido" };
// Los avisos pueden llegar desordenados: un estado nunca vuelve atrás.
const ANTES: Record<string, string[]> = {
  enviado: ["pendiente"], entregado: ["pendiente", "enviado"], leido: ["pendiente", "enviado", "entregado"], fallido: ["pendiente", "enviado", "entregado"],
};

export async function anotarEstadoSaliente(empresaId: string, externoId: string, status: string): Promise<void> {
  const estado = ESTADO[status];
  if (!estado) return;
  await systemClient()
    .from("chat_mensajes")
    .update({ estado_entrega: estado })
    .eq("empresa_id", empresaId)
    .eq("externo_id", externoId)
    .eq("from_me", true)
    .in("estado_entrega", ANTES[estado]);
}

/**
 * WhatsApp a veces entrega el chat con un código interno (@lid) en vez del teléfono. Cuando el
 * puente aprende la equivalencia, se corrige el número del contacto. No crea ni fusiona contactos:
 * si ya hay otro con ese teléfono, se deja como está.
 */
export async function corregirTelefonos(empresaId: string, pares: { lid: string; telefono: string }[]): Promise<number> {
  const db = systemClient();
  const porLid = new Map(pares.map((p) => [p.lid, p.telefono]));
  const { data } = await db.from("chat_contactos").select("id, telefono").eq("empresa_id", empresaId).in("telefono", [...porLid.keys()]);
  const conLid = (data ?? []) as { id: string; telefono: string }[];
  if (!conLid.length) return 0;
  const { data: ya } = await db.from("chat_contactos").select("telefono").eq("empresa_id", empresaId).in("telefono", conLid.map((c) => porLid.get(c.telefono)!));
  const ocupados = new Set(((ya ?? []) as { telefono: string }[]).map((c) => c.telefono));
  let corregidos = 0;
  for (const c of conLid) {
    const tel = porLid.get(c.telefono)!;
    if (ocupados.has(tel)) continue;
    const { error } = await db.from("chat_contactos").update({ telefono: tel, updated_at: new Date().toISOString() }).eq("id", c.id).eq("telefono", c.telefono);
    if (!error) {
      corregidos++;
      ocupados.add(tel);
    }
  }
  return corregidos;
}
