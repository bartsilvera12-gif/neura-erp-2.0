/**
 * Conversaciones — lo que necesita service-role (vive en lib/ a propósito: el cliente de
 * sistema no se importa desde una ruta).
 *
 *   · Bucket PRIVADO "chat": subida de adjuntos y URLs firmadas. La ruta del objeto la arma
 *     el servidor (<empresa>/<conversación>/<uuid>-<nombre>), nunca el navegador.
 *   · chat_registrar_entrante (solo service_role): el simulador y el procesador del webhook.
 *   · chat_eventos (cola cruda del webhook, solo service_role).
 *
 * Cada función recibe la empresa (o el canal, que la determina) y filtra por ella.
 */
import { systemClient } from "@/lib/supabase/clients";

export const CHAT_BUCKET = "chat";
const URL_TTL_S = 60 * 60;

function bucket() {
  return systemClient().storage.from(CHAT_BUCKET);
}

export function pathAdjuntoChat(empresaId: string, conversacionId: string, nombre: string): string {
  const limpio =
    (nombre || "archivo")
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 90)
      .toLowerCase() || "archivo";
  return `${empresaId}/${conversacionId}/${crypto.randomUUID()}-${limpio}`;
}

export async function subirAdjuntoChat(path: string, datos: Buffer, contentType: string): Promise<{ error: string | null }> {
  const { error } = await bucket().upload(path, datos, { contentType, upsert: false });
  return { error: error?.message ?? null };
}

export async function borrarAdjuntoChat(path: string): Promise<void> {
  await bucket().remove([path]).catch(() => {});
}

/**
 * URLs firmadas en UN viaje para varios objetos. Solo se firman rutas del prefijo de la
 * empresa (el llamador ya validó con la sesión del usuario que los mensajes son suyos).
 */
export async function firmarAdjuntosChat(empresaId: string, paths: string[], ttl = URL_TTL_S): Promise<Map<string, string>> {
  const propios = [...new Set(paths.filter((p) => p.startsWith(`${empresaId}/`)))];
  const out = new Map<string, string>();
  if (!propios.length) return out;
  const { data } = await bucket().createSignedUrls(propios, ttl);
  for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
  return out;
}

// ── Canales ──────────────────────────────────────────────────────────────────
export type CanalChat = { id: string; empresa_id: string; nombre: string; tipo: string; proveedor: string; identificador: string | null; activo: boolean };
const COLS_CANAL = "id, empresa_id, nombre, tipo, proveedor, identificador, activo";

export async function canalSimulador(empresaId: string): Promise<CanalChat | null> {
  const { data } = await systemClient()
    .from("chat_canales")
    .select(COLS_CANAL)
    .eq("empresa_id", empresaId)
    .eq("proveedor", "simulador")
    .eq("activo", true)
    .order("created_at")
    .limit(1);
  return ((data ?? [])[0] as CanalChat | undefined) ?? null;
}

export async function canalPorId(id: string): Promise<CanalChat | null> {
  const { data } = await systemClient().from("chat_canales").select(COLS_CANAL).eq("id", id).limit(1);
  return ((data ?? [])[0] as CanalChat | undefined) ?? null;
}

export async function canalPorIdentificador(proveedor: string, identificador: string): Promise<CanalChat | null> {
  const { data } = await systemClient()
    .from("chat_canales")
    .select(COLS_CANAL)
    .eq("proveedor", proveedor)
    .eq("identificador", identificador)
    .limit(1);
  return ((data ?? [])[0] as CanalChat | undefined) ?? null;
}

/** Config del conector (tokens). Solo servidor; nunca viaja al navegador. */
export async function secretosDelCanal(canalId: string): Promise<Record<string, unknown>> {
  const { data } = await systemClient().from("chat_canal_secretos").select("config").eq("canal_id", canalId).limit(1);
  return ((data?.[0] as { config?: Record<string, unknown> } | undefined)?.config ?? {}) as Record<string, unknown>;
}

// ── Entrantes ────────────────────────────────────────────────────────────────
export type Entrante = {
  canal_id: string;
  telefono: string;
  nombre?: string | null;
  externo_id?: string | null;
  tipo?: string;
  contenido?: string | null;
  media_path?: string | null;
  media_mime?: string | null;
  media_nombre?: string | null;
  fecha?: string | null;
};

/** chat_registrar_entrante (idempotente por externo_id; crea contacto y conversación). */
export async function registrarEntrante(e: Entrante): Promise<{ mensaje_id: string; conversacion_id: string; duplicado: boolean }> {
  const { data, error } = await systemClient().rpc("chat_registrar_entrante", {
    p_canal: e.canal_id,
    p_telefono: e.telefono,
    p_nombre: e.nombre ?? null,
    p_externo_id: e.externo_id ?? null,
    p_tipo: e.tipo ?? "texto",
    p_contenido: e.contenido ?? null,
    p_media_path: e.media_path ?? null,
    p_media_mime: e.media_mime ?? null,
    p_media_nombre: e.media_nombre ?? null,
    p_fecha: e.fecha ?? null,
  });
  if (error || !data) throw new Error(error?.message ?? "No se pudo registrar el mensaje");
  return data as { mensaje_id: string; conversacion_id: string; duplicado: boolean };
}

// ── Cola cruda del webhook ───────────────────────────────────────────────────
export async function guardarEventoChat(proveedor: string, payload: unknown, canal?: CanalChat | null): Promise<number | null> {
  const { data, error } = await systemClient()
    .from("chat_eventos")
    .insert({ proveedor, payload, canal_id: canal?.id ?? null, empresa_id: canal?.empresa_id ?? null })
    .select("id")
    .limit(1);
  if (error) {
    console.error("[chat/webhook] guardar evento", error.message);
    return null;
  }
  return Number((data?.[0] as { id?: number } | undefined)?.id ?? 0) || null;
}

export async function marcarEventoChat(id: number, estado: "procesado" | "error" | "ignorado", error?: string | null): Promise<void> {
  await systemClient()
    .from("chat_eventos")
    .update({ estado, error: error ?? null, procesado_at: new Date().toISOString() })
    .eq("id", id);
}
