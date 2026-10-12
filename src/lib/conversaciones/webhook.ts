/**
 * Webhook de proveedores de chat (público, sin sesión):
 *   1. valida la firma del proveedor (placeholder hasta conectar uno real),
 *   2. guarda el payload CRUDO en chat_eventos y responde 200 al instante,
 *   3. procesa en segundo plano (after()): normaliza → chat_registrar_entrante / estados.
 * Solo el simulador tiene normalizador; el resto queda en la cola como 'ignorado' (TODO).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { systemClient } from "@/lib/supabase/clients";
import { canalPorId, canalPorIdentificador, guardarEventoChat, marcarEventoChat, registrarEntrante, type CanalChat } from "@/lib/conversaciones/servidor";
import { normalizar } from "@/modules/conversaciones/conectores/normalizadores";

export const PROVEEDORES = ["meta", "ycloud", "baileys", "simulador"] as const;
export type ProveedorWebhook = (typeof PROVEEDORES)[number];
export const esProveedor = (v: string): v is ProveedorWebhook => (PROVEEDORES as readonly string[]).includes(v);

function igual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Firma del proveedor. Sin el secreto configurado en el entorno el webhook queda CERRADO
 * (no se guarda nada): así nadie puede llenar la cola mientras no hay proveedor.
 *   · meta:      X-Hub-Signature-256 = sha256=HMAC(META_APP_SECRET, body)
 *   · ycloud:    TODO verificar YCloud-Signature (t=…,s=HMAC(t.body)) con YCLOUD_WEBHOOK_SECRET
 *   · baileys:   X-Chat-Secret = BAILEYS_WEBHOOK_SECRET
 *   · simulador: X-Chat-Secret = CHAT_SIMULADOR_SECRET
 */
export function firmaValida(proveedor: ProveedorWebhook, headers: Headers, cuerpo: string): { ok: true } | { ok: false; status: number } {
  const env = (n: string) => process.env[n]?.trim() || "";
  switch (proveedor) {
    case "meta": {
      const secreto = env("META_APP_SECRET");
      if (!secreto) return { ok: false, status: 503 };
      const firma = headers.get("x-hub-signature-256") ?? "";
      const esperado = `sha256=${createHmac("sha256", secreto).update(cuerpo).digest("hex")}`;
      return igual(firma, esperado) ? { ok: true } : { ok: false, status: 401 };
    }
    case "ycloud": {
      const secreto = env("YCLOUD_WEBHOOK_SECRET");
      if (!secreto) return { ok: false, status: 503 };
      // TODO: validar la firma real de YCloud. Por ahora solo exige que venga la cabecera.
      return headers.get("ycloud-signature") ? { ok: true } : { ok: false, status: 401 };
    }
    case "baileys":
    case "simulador": {
      const secreto = env(proveedor === "baileys" ? "BAILEYS_WEBHOOK_SECRET" : "CHAT_SIMULADOR_SECRET");
      if (!secreto) return { ok: false, status: 503 };
      return igual(headers.get("x-chat-secret") ?? "", secreto) ? { ok: true } : { ok: false, status: 401 };
    }
  }
}

/** Verificación de suscripción de Meta (GET hub.challenge). */
export function verificarSuscripcionMeta(sp: URLSearchParams): string | null {
  const token = process.env.META_VERIFY_TOKEN?.trim();
  if (!token) return null;
  return sp.get("hub.mode") === "subscribe" && sp.get("hub.verify_token") === token ? sp.get("hub.challenge") : null;
}

export async function encolarEvento(proveedor: ProveedorWebhook, payload: unknown): Promise<number | null> {
  return guardarEventoChat(proveedor, payload, null);
}

/** Procesa un evento guardado (se llama desde after(), nunca bloquea la respuesta). */
export async function procesarEvento(eventoId: number, proveedor: ProveedorWebhook, payload: unknown): Promise<void> {
  try {
    const n = normalizar(proveedor, payload);
    if (!n.entrantes.length && !n.estados.length) {
      await marcarEventoChat(eventoId, "ignorado", proveedor === "simulador" ? "Payload sin teléfono/texto" : "Normalizador pendiente (TODO)");
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
      if (!canal || canal.proveedor !== proveedor || !canal.activo) throw new Error("Canal no encontrado para el evento");
      await registrarEntrante({
        canal_id: canal.id,
        telefono: e.telefono,
        nombre: e.nombre,
        externo_id: e.externo_id,
        tipo: e.tipo,
        contenido: e.contenido,
        fecha: e.fecha,
      });
    }
    // Estados de entrega por id externo (enviado → entregado → leído / fallido).
    for (const s of n.estados) {
      await systemClient()
        .from("chat_mensajes")
        .update({ estado_entrega: s.estado, error: s.error ?? null })
        .eq("externo_id", s.externo_id)
        .eq("from_me", true);
    }
    await marcarEventoChat(eventoId, "procesado");
  } catch (e) {
    console.error("[chat/webhook] procesar", (e as Error).message);
    await marcarEventoChat(eventoId, "error", (e as Error).message).catch(() => {});
  }
}
