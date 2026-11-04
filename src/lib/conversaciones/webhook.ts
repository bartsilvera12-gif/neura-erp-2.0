/**
 * Webhook de proveedores de chat (público, sin sesión):
 *   1. valida la firma del proveedor con el secreto del CANAL (chat_canal_secretos) o, si está,
 *      con el del entorno (un secreto para toda la app),
 *   2. guarda el payload CRUDO en chat_eventos y responde 200 al instante,
 *   3. procesa en segundo plano (after()): normaliza → baja la media → chat_registrar_entrante →
 *      bot de Sorteos; y los estados de entrega de lo que mandamos.
 * Sin secreto (ni del canal ni del entorno) el webhook queda CERRADO: nadie puede llenar la cola.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { systemClient } from "@/lib/supabase/clients";
import {
  canalPorId, canalPorIdentificador, guardarEventoChat, marcarEventoChat, pathAdjuntoChat, registrarEntrante, secretosDelCanal,
  subirAdjuntoChat, type CanalChat,
} from "@/lib/conversaciones/servidor";
import { bajarMediaEntrante, identificadoresDe, normalizar } from "@/modules/conversaciones/conectores";
import { botSorteos } from "@/lib/sorteos/bot";

export const PROVEEDORES = ["meta", "ycloud", "baileys", "simulador"] as const;
export type ProveedorWebhook = (typeof PROVEEDORES)[number];
export const esProveedor = (v: string): v is ProveedorWebhook => (PROVEEDORES as readonly string[]).includes(v);

const env = (n: string) => process.env[n]?.trim() || "";

function igual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** YCloud-Signature: t=<timestamp>,s=<hex de HMAC-SHA256(secreto, "<t>.<body>")>. */
function firmaYcloud(cabecera: string, cuerpo: string, secreto: string): boolean {
  let t = "";
  let s = "";
  for (const p of cabecera.split(",")) {
    const x = p.trim();
    if (x.startsWith("t=")) t = x.slice(2);
    else if (x.startsWith("s=")) s = x.slice(2).toLowerCase();
  }
  if (!t || !s) return false;
  return [`${t}.${cuerpo}`, `${t}.${cuerpo}.`].some((base) => igual(s, createHmac("sha256", secreto).update(base, "utf8").digest("hex")));
}

/** X-Hub-Signature-256: sha256=<hex de HMAC-SHA256(app_secret, body)>. */
const firmaMeta = (cabecera: string, cuerpo: string, secreto: string) =>
  igual(cabecera, `sha256=${createHmac("sha256", secreto).update(cuerpo).digest("hex")}`);

/** Secretos de los canales a los que va el payload (por su identificador). */
async function secretosDe(proveedor: ProveedorWebhook, payload: unknown, campo: string): Promise<string[]> {
  const out: string[] = [];
  for (const id of identificadoresDe(proveedor, payload)) {
    const canal = await canalPorIdentificador(proveedor, id);
    if (!canal) continue;
    const c = await secretosDelCanal(canal.id);
    if (typeof c[campo] === "string" && c[campo]) out.push(String(c[campo]).trim());
  }
  return out;
}

/**
 * Firma del proveedor.
 *   · meta:      X-Hub-Signature-256 con META_APP_SECRET o el app_secret del canal
 *   · ycloud:    YCloud-Signature con YCLOUD_WEBHOOK_SECRET o el webhook_secret del canal
 *   · baileys:   X-Chat-Secret = BAILEYS_WEBHOOK_SECRET
 *   · simulador: X-Chat-Secret = CHAT_SIMULADOR_SECRET
 */
export async function firmaValida(proveedor: ProveedorWebhook, headers: Headers, cuerpo: string, payload: unknown): Promise<{ ok: true } | { ok: false; status: number }> {
  switch (proveedor) {
    case "meta":
    case "ycloud": {
      const cabecera = headers.get(proveedor === "meta" ? "x-hub-signature-256" : "ycloud-signature") ?? "";
      const secretos = [env(proveedor === "meta" ? "META_APP_SECRET" : "YCLOUD_WEBHOOK_SECRET"), ...(await secretosDe(proveedor, payload, proveedor === "meta" ? "app_secret" : "webhook_secret"))].filter(Boolean);
      if (!secretos.length) return { ok: false, status: 503 };
      if (!cabecera) return { ok: false, status: 401 };
      const ok = secretos.some((s) => (proveedor === "meta" ? firmaMeta(cabecera, cuerpo, s) : firmaYcloud(cabecera, cuerpo, s)));
      return ok ? { ok: true } : { ok: false, status: 401 };
    }
    case "baileys":
    case "simulador": {
      const secreto = env(proveedor === "baileys" ? "BAILEYS_WEBHOOK_SECRET" : "CHAT_SIMULADOR_SECRET");
      if (!secreto) return { ok: false, status: 503 };
      return igual(headers.get("x-chat-secret") ?? "", secreto) ? { ok: true } : { ok: false, status: 401 };
    }
  }
}

/** Verificación de suscripción de Meta (GET hub.challenge): META_VERIFY_TOKEN o el verify_token de un canal. */
export async function verificarSuscripcionMeta(sp: URLSearchParams): Promise<string | null> {
  const token = sp.get("hub.verify_token") ?? "";
  if (sp.get("hub.mode") !== "subscribe" || !token) return null;
  if (env("META_VERIFY_TOKEN") && igual(token, env("META_VERIFY_TOKEN"))) return sp.get("hub.challenge");
  const { data } = await systemClient()
    .from("chat_canal_secretos")
    .select("canal_id, canal:chat_canales!canal_id(proveedor)")
    .eq("config->>verify_token", token)
    .limit(1);
  const fila = (data?.[0] ?? null) as { canal?: { proveedor?: string } | null } | null;
  return fila?.canal?.proveedor === "meta" ? sp.get("hub.challenge") : null;
}

export async function encolarEvento(proveedor: ProveedorWebhook, payload: unknown): Promise<number | null> {
  return guardarEventoChat(proveedor, payload, null);
}

async function anotarCanal(canalId: string, error: string | null) {
  const ahora = new Date().toISOString();
  await systemClient()
    .from("chat_canales")
    .update(error ? { ultimo_evento_at: ahora, ultimo_error: error.slice(0, 500), ultimo_error_at: ahora } : { ultimo_evento_at: ahora })
    .eq("id", canalId);
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf", "audio/ogg": "ogg", "audio/mpeg": "mp3", "video/mp4": "mp4" };

/** Procesa un evento guardado (se llama desde after(), nunca bloquea la respuesta). */
export async function procesarEvento(eventoId: number, proveedor: ProveedorWebhook, payload: unknown, base = ""): Promise<void> {
  try {
    const n = normalizar(proveedor, payload);
    if (!n.entrantes.length && !n.estados.length) {
      await marcarEventoChat(eventoId, "ignorado", "Evento sin mensajes ni estados (otro tipo de aviso)");
      return;
    }
    const canales = new Map<string, CanalChat | null>();
    for (const e of n.entrantes) {
      const clave = e.canal_id ?? `${proveedor}:${e.canal_identificador ?? ""}`;
      if (!canales.has(clave)) {
        canales.set(
          clave,
          e.canal_id ? await canalPorId(e.canal_id) : e.canal_identificador ? await canalPorIdentificador(proveedor, e.canal_identificador) : null,
        );
      }
      const canal = canales.get(clave);
      if (!canal || canal.proveedor !== proveedor) throw new Error("Canal no encontrado para el evento");
      if (!canal.activo) {
        await anotarCanal(canal.id, "Llegó un mensaje pero el canal está apagado");
        continue;
      }

      // Foto, PDF o audio: se baja con la clave del canal y se guarda en erp-chat.
      let media: { path: string; mime: string; nombre: string } | null = null;
      let errorMedia: string | null = null;
      if (e.media && (e.media.id || e.media.link)) {
        try {
          const b = await bajarMediaEntrante(proveedor, canal.id, e.media);
          const mime = b.mime.split(";")[0].trim().toLowerCase();
          const nombre = e.media.nombre || `${e.tipo ?? "archivo"}.${EXT[mime] ?? "bin"}`;
          const path = pathAdjuntoChat(canal.empresa_id, "entrantes", nombre);
          const { error } = await subirAdjuntoChat(path, b.datos, mime);
          if (error) throw new Error(error);
          media = { path, mime, nombre };
        } catch (err) {
          errorMedia = `No se pudo bajar el archivo: ${(err as Error).message}`;
          console.error("[chat/webhook] media", errorMedia);
        }
      }

      const r = await registrarEntrante({
        canal_id: canal.id,
        telefono: e.telefono,
        nombre: e.nombre,
        externo_id: e.externo_id,
        tipo: media ? e.tipo : e.media ? "texto" : e.tipo,
        contenido: media || !e.media ? e.contenido ?? null : [e.contenido, `[${e.tipo ?? "archivo"} sin descargar]`].filter(Boolean).join(" "),
        media_path: media?.path ?? null,
        media_mime: media?.mime ?? null,
        media_nombre: media?.nombre ?? null,
        // La hora del proveedor, pero nunca en el futuro (si no, el chat se desordena).
        fecha: e.fecha && Date.parse(e.fecha) < Date.now() ? e.fecha : null,
      });
      await anotarCanal(canal.id, errorMedia);
      // Rubro Sorteos: el bot de venta contesta si está prendido (nunca rompe el procesamiento).
      if (!r.duplicado) {
        await botSorteos(
          {
            conversacion_id: r.conversacion_id, mensaje_id: r.mensaje_id, tipo: media ? e.tipo ?? "texto" : "texto", contenido: e.contenido ?? null,
            media_path: media?.path ?? null, media_mime: media?.mime ?? null, anuncio: e.anuncio ?? null,
          },
          { base },
        );
      }
    }
    // Estados de entrega por id externo (enviado → entregado → leído / fallido). Los avisos pueden
    // llegar desordenados: un estado nunca vuelve atrás.
    const ANTES: Record<string, string[]> = {
      enviado: ["pendiente"], entregado: ["pendiente", "enviado"], leido: ["pendiente", "enviado", "entregado"],
      fallido: ["pendiente", "enviado", "entregado"],
    };
    for (const s of n.estados) {
      await systemClient()
        .from("chat_mensajes")
        .update({ estado_entrega: s.estado, error: s.error ?? null })
        .eq("externo_id", s.externo_id)
        .eq("from_me", true)
        .in("estado_entrega", ANTES[s.estado] ?? []);
    }
    await marcarEventoChat(eventoId, "procesado");
  } catch (e) {
    console.error("[chat/webhook] procesar", (e as Error).message);
    await marcarEventoChat(eventoId, "error", (e as Error).message).catch(() => {});
  }
}
