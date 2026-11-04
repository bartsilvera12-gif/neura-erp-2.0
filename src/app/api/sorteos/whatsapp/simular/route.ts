/**
 * Probar el bot de Sorteos sin WhatsApp (receta 125, Administrador). Usa el canal "simulador" de la
 * empresa: el mensaje entra a la bandeja como uno real y el bot contesta en el momento.
 *   GET  /api/sorteos/whatsapp/simular?telefono=595981… → el chat de ese teléfono
 *   POST multipart { telefono, nombre?, texto?, archivo? (foto o PDF del comprobante), lectura? (JSON) }
 *        → el chat con la respuesta del bot. `lectura` reemplaza a la lectura automática del comprobante
 *        (para probar la confirmación automática sin el lector configurado).
 */
import { randomUUID } from "node:crypto";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { canalSimulador, firmarAdjuntosChat, registrarEntrante, subirAdjuntoChat } from "@/lib/conversaciones/servidor";
import { botSorteos } from "@/lib/sorteos/bot";
import { esquemaLectura } from "@/lib/sorteos/lector-comprobante";
import { systemClient } from "@/lib/supabase/clients";
import { urlBase } from "@/lib/usuarios/cuentas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIPOS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

const normalizarTelefono = (v: string) => {
  const d = v.replace(/\D/g, "");
  return /^09\d{8}$/.test(d) ? `595${d.slice(1)}` : d;
};

type FilaMsg = { id: string; from_me: boolean; tipo: string; contenido: string | null; media_path: string | null; media_mime: string | null; estado_entrega: string; autor_usuario_id: string | null; created_at: string };

async function chat(empresaId: string, canalId: string, telefono: string) {
  const db = systemClient();
  const { data: contacto } = await db.from("chat_contactos").select("id").eq("empresa_id", empresaId).eq("telefono", telefono).maybeSingle();
  if (!contacto) return { conversacion_id: null, paso: null, mensajes: [] };
  const { data: conv } = await db
    .from("chat_conversaciones")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("canal_id", canalId)
    .eq("contacto_id", (contacto as { id: string }).id)
    .maybeSingle();
  if (!conv) return { conversacion_id: null, paso: null, mensajes: [] };
  const convId = (conv as { id: string }).id;
  const [{ data: msgs }, { data: ses }] = await Promise.all([
    db
      .from("chat_mensajes")
      .select("id, from_me, tipo, contenido, media_path, media_mime, estado_entrega, autor_usuario_id, created_at")
      .eq("conversacion_id", convId)
      .neq("tipo", "nota")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(60),
    db.from("sorteo_bot_sesiones").select("paso").eq("conversacion_id", convId).maybeSingle(),
  ]);
  const filas = ((msgs ?? []) as FilaMsg[]).reverse();
  const urls = await firmarAdjuntosChat(empresaId, filas.map((m) => m.media_path).filter((p): p is string => !!p));
  return {
    conversacion_id: convId,
    paso: (ses as { paso: string } | null)?.paso ?? null,
    mensajes: filas.map((m) => ({
      id: m.id,
      from_me: m.from_me,
      tipo: m.tipo,
      contenido: m.contenido,
      media_url: m.media_path ? urls.get(m.media_path) ?? null : null,
      media_mime: m.media_mime,
      de_persona: m.from_me && !!m.autor_usuario_id,
      created_at: m.created_at,
    })),
  };
}

export const GET = withTenant(async (ctx, req) => {
  const canal = await canalSimulador(ctx.empresaId);
  if (!canal) return fail("No hay un canal simulador activo para la empresa.", 409);
  const telefono = normalizarTelefono(new URL(req.url).searchParams.get("telefono") ?? "");
  if (telefono.length < 8 || telefono.length > 15) return fail("Teléfono inválido", 422, "invalid_input");
  return ok(await chat(ctx.empresaId, canal.id, telefono));
}, { permiso: "sorteos_administrar" });

export const POST = withTenant(async (ctx, req) => {
  const canal = await canalSimulador(ctx.empresaId);
  if (!canal) return fail("No hay un canal simulador activo para la empresa.", 409);
  const form = await req.formData().catch(() => null);
  if (!form) return fail("Datos inválidos", 422, "invalid_input");
  const telefono = normalizarTelefono(String(form.get("telefono") ?? ""));
  if (telefono.length < 8 || telefono.length > 15) return fail("Teléfono inválido (ej. 0981 123 456)", 422, "invalid_input");
  const nombre = String(form.get("nombre") ?? "").trim().slice(0, 120) || null;
  const texto = String(form.get("texto") ?? "").trim().slice(0, 4096) || null;
  const archivo = form.get("archivo");
  const hayArchivo = archivo instanceof File && archivo.size > 0;
  if (!texto && !hayArchivo) return fail("Escribí un mensaje o adjuntá el comprobante", 422, "invalid_input");

  let lecturaSimulada: ReturnType<typeof esquemaLectura.parse> | undefined;
  const lecturaTxt = String(form.get("lectura") ?? "").trim();
  if (lecturaTxt) {
    const p = esquemaLectura.safeParse((() => { try { return JSON.parse(lecturaTxt); } catch { return null; } })());
    if (!p.success) return fail("La lectura simulada no es válida", 422, "invalid_input");
    lecturaSimulada = p.data;
  }

  let media: { path: string; mime: string; nombre: string } | null = null;
  if (hayArchivo) {
    const ext = TIPOS[archivo.type];
    if (!ext) return fail("El comprobante tiene que ser una foto (JPG, PNG, WEBP) o un PDF.", 422, "invalid_input");
    if (archivo.size > 8 * 1024 * 1024) return fail("El archivo no puede superar 8 MB.", 422, "invalid_input");
    const path = `${ctx.empresaId}/simulador/${randomUUID()}.${ext}`;
    const { error } = await subirAdjuntoChat(path, Buffer.from(await archivo.arrayBuffer()), archivo.type);
    if (error) return fail("No se pudo guardar el archivo", 502, "storage_error");
    media = { path, mime: archivo.type, nombre: archivo.name.slice(0, 120) || `comprobante.${ext}` };
  }

  try {
    const tipo = media ? (media.mime === "application/pdf" ? "documento" : "imagen") : "texto";
    const r = await registrarEntrante({
      canal_id: canal.id,
      telefono,
      nombre,
      externo_id: `sim-in-${randomUUID()}`,
      tipo,
      contenido: texto,
      media_path: media?.path ?? null,
      media_mime: media?.mime ?? null,
      media_nombre: media?.nombre ?? null,
    });
    const bot = await botSorteos(
      { conversacion_id: r.conversacion_id, mensaje_id: r.mensaje_id, tipo, contenido: texto, media_path: media?.path ?? null, media_mime: media?.mime ?? null },
      { base: urlBase(req), lecturaSimulada },
    );
    return ok({ ...(await chat(ctx.empresaId, canal.id, telefono)), respondio: bot.respondio });
  } catch (e) {
    console.error("[sorteos/simular]", (e as Error).message);
    return fail("No se pudo simular el mensaje.", 500);
  }
}, { permiso: "sorteos_administrar" });
