/**
 * Conversaciones — lado servidor (detrás de withTenant). Lectura de una conversación
 * (fila de la lista), mensajes del hilo y el ENVÍO saliente:
 *   insert chat_mensajes (pendiente) → conector → enviado | fallido
 *   (+ simulador: entregado/leído en segundo plano con after()).
 */
import { after } from "next/server";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { TenantContext } from "@/lib/api/with-tenant";
import type { TenantDb } from "@/lib/api/tenant-db";
import { firmarAdjuntosChat } from "@/lib/conversaciones/servidor";
import { idDeRuta } from "@/modules/tipificacion/server";
import { conectorPara, type DestinoChat } from "@/modules/conversaciones/conectores";
import {
  COLS_MENSAJE, PLANTILLAS, rellenarPlantilla, ventanaAbierta,
  type EstadoEntrega, type FilaBandeja, type Mensaje, type TipoMedia,
} from "@/modules/conversaciones/dominio";

export const idConversacion = (req: { url: string }) => idDeRuta(req, "conversaciones");

// ── Fila de la lista (una sola conversación) ─────────────────────────────────
const COLS_RESUMEN =
  "id, estado, asignado_id, canal_id, prioridad, ultimo_mensaje_at, ultimo_preview, ultimo_from_me, ultimo_tipo, no_leidos, " +
  "ventana_expira_at, sla_vence_at, primera_respuesta_at, etiquetas, contacto_id, cola_id, " +
  "contacto:chat_contactos!contacto_id(nombre, telefono, avatar_url, cliente_id, prospecto_id), " +
  "canal:chat_canales!canal_id(tipo, nombre), asignado:usuarios!asignado_id(nombre), cola:chat_colas!cola_id(nombre)";

type FilaCruda = Record<string, unknown> & {
  contacto: { nombre: string | null; telefono: string | null; avatar_url: string | null; cliente_id: string | null; prospecto_id: string | null } | null;
  canal: { tipo: string; nombre: string } | null;
  asignado: { nombre: string } | null;
  cola: { nombre: string } | null;
};

export async function leerResumen(db: TenantDb, id: string): Promise<FilaBandeja | null> {
  const { data, error } = await db.select("chat_conversaciones", COLS_RESUMEN).eq("id", id).limit(1);
  if (error) throw new Error(error.message);
  const r = (data?.[0] ?? null) as unknown as FilaCruda | null;
  if (!r) return null;
  return {
    id: String(r.id),
    estado: r.estado as FilaBandeja["estado"],
    asignado_id: (r.asignado_id as string | null) ?? null,
    asignado_nombre: r.asignado?.nombre ?? null,
    canal_id: String(r.canal_id),
    canal_tipo: r.canal?.tipo ?? "whatsapp",
    canal_nombre: r.canal?.nombre ?? "",
    cola_id: (r.cola_id as string | null) ?? null,
    cola_nombre: r.cola?.nombre ?? null,
    prioridad: Number(r.prioridad ?? 0),
    ultimo_mensaje_at: (r.ultimo_mensaje_at as string | null) ?? null,
    ultimo_preview: (r.ultimo_preview as string | null) ?? null,
    ultimo_from_me: (r.ultimo_from_me as boolean | null) ?? null,
    ultimo_tipo: (r.ultimo_tipo as string | null) ?? null,
    no_leidos: Number(r.no_leidos ?? 0),
    ventana_expira_at: (r.ventana_expira_at as string | null) ?? null,
    sla_vence_at: (r.sla_vence_at as string | null) ?? null,
    primera_respuesta_at: (r.primera_respuesta_at as string | null) ?? null,
    etiquetas: (r.etiquetas as string[] | null) ?? [],
    contacto_id: String(r.contacto_id),
    contacto_nombre: r.contacto?.nombre ?? null,
    contacto_telefono: r.contacto?.telefono ?? null,
    avatar_url: r.contacto?.avatar_url ?? null,
    cliente_id: r.contacto?.cliente_id ?? null,
    prospecto_id: r.contacto?.prospecto_id ?? null,
  };
}

// ── Mensajes ─────────────────────────────────────────────────────────────────
export function aMensaje(r: Record<string, unknown>): Mensaje {
  const autor = r.autor as { nombre?: string } | null | undefined;
  return {
    id: String(r.id),
    from_me: r.from_me === true,
    tipo: r.tipo as Mensaje["tipo"],
    contenido: (r.contenido as string | null) ?? null,
    media_path: (r.media_path as string | null) ?? null,
    media_mime: (r.media_mime as string | null) ?? null,
    media_nombre: (r.media_nombre as string | null) ?? null,
    media_size: r.media_size == null ? null : Number(r.media_size),
    responde_a: (r.responde_a as string | null) ?? null,
    estado_entrega: r.estado_entrega as EstadoEntrega,
    error: (r.error as string | null) ?? null,
    autor_usuario_id: (r.autor_usuario_id as string | null) ?? null,
    autor_nombre: autor?.nombre ?? (r.autor_nombre as string | null) ?? null,
    created_at: String(r.created_at),
  };
}

// ── Conversación para enviar ─────────────────────────────────────────────────
type ConvEnvio = {
  id: string;
  estado: string;
  asignado_id: string | null;
  ventana_expira_at: string | null;
  contacto: { telefono: string | null; externo_id: string | null } | null;
  canal: { id: string; tipo: string; proveedor: string; identificador: string | null; activo: boolean } | null;
};

export async function leerConversacionEnvio(db: TenantDb, id: string): Promise<ConvEnvio | null> {
  const { data } = await db
    .select(
      "chat_conversaciones",
      "id, estado, asignado_id, ventana_expira_at, contacto:chat_contactos!contacto_id(telefono, externo_id), canal:chat_canales!canal_id(id, tipo, proveedor, identificador, activo)",
    )
    .eq("id", id)
    .limit(1);
  return ((data?.[0] ?? null) as unknown as ConvEnvio | null) ?? null;
}

export type Saliente =
  | { tipo: "texto"; contenido: string; responde_a?: string | null }
  | { tipo: "nota"; contenido: string }
  | { tipo: "plantilla"; plantilla_id: string; variables: Record<string, string> }
  | {
      tipo: TipoMedia;
      contenido?: string | null;
      responde_a?: string | null;
      media: { path: string; mime: string; nombre: string; size: number; notaDeVoz?: boolean };
    };

export type ResultadoSaliente = { ok: true; mensaje: Mensaje } | { ok: false; status: number; mensaje: string };

/**
 * Envía (o registra, si es nota interna) un mensaje saliente.
 * Regla de 24 h: en WhatsApp, fuera de la ventana solo plantillas (y notas internas).
 * Si la conversación no tiene asignado, quien responde la toma.
 */
export async function enviarSaliente(ctx: TenantContext, conv: ConvEnvio, s: Saliente): Promise<ResultadoSaliente> {
  const canal = conv.canal;
  if (!canal) return { ok: false, status: 404, mensaje: "Canal no encontrado" };
  const esNota = s.tipo === "nota";
  if (!esNota) {
    if (!canal.activo) return { ok: false, status: 409, mensaje: "El canal está inactivo." };
    if (s.tipo !== "plantilla" && !ventanaAbierta({ canal_tipo: canal.tipo, ventana_expira_at: conv.ventana_expira_at })) {
      return { ok: false, status: 409, mensaje: "Pasaron más de 24 h desde el último mensaje del cliente: solo se puede enviar una plantilla." };
    }
  }

  let contenido: string | null = null;
  let plantilla: (typeof PLANTILLAS)[number] | null = null;
  let variables: string[] = [];
  if (s.tipo === "plantilla") {
    plantilla = PLANTILLAS.find((p) => p.id === s.plantilla_id) ?? null;
    if (!plantilla) return { ok: false, status: 422, mensaje: "La plantilla no existe." };
    contenido = rellenarPlantilla(plantilla.texto, s.variables);
    if (/\{\{\s*\w+\s*\}\}/.test(contenido)) return { ok: false, status: 422, mensaje: "Completá todas las variables de la plantilla." };
    variables = Object.keys(s.variables)
      .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
      .map((k) => s.variables[k]);
  } else {
    contenido = ("contenido" in s ? s.contenido : null)?.trim() || null;
  }
  const media = "media" in s ? s.media : null;
  const respondeA = "responde_a" in s ? s.responde_a ?? null : null;

  const [ins] = await Promise.all([
    ctx.db.insert("chat_mensajes", {
      conversacion_id: conv.id,
      from_me: true,
      tipo: s.tipo,
      contenido,
      media_path: media?.path ?? null,
      media_mime: media?.mime ?? null,
      media_nombre: media?.nombre ?? null,
      media_size: media?.size ?? null,
      responde_a: respondeA,
      estado_entrega: esNota ? "enviado" : "pendiente",
      autor_usuario_id: ctx.usuarioId,
    }),
    // Quien responde una conversación sin asignar, la toma.
    !esNota && !conv.asignado_id
      ? ctx.db.update("chat_conversaciones", { asignado_id: ctx.usuarioId, updated_at: new Date().toISOString() }).eq("id", conv.id).is("asignado_id", null)
      : Promise.resolve(null),
  ]);
  if (ins.error || !ins.data?.[0]) {
    console.error("[conversaciones] insertar mensaje", ins.error?.message);
    return { ok: false, status: 500, mensaje: "No se pudo guardar el mensaje." };
  }
  const fila = ins.data[0] as Record<string, unknown>;
  const mensajeId = String(fila.id);
  const base = aMensaje({ ...fila, autor_nombre: null });
  if (esNota) return { ok: true, mensaje: base };

  // ── Conector ──────────────────────────────────────────────────────────────
  const destino: DestinoChat = {
    canal: { id: canal.id, tipo: canal.tipo, proveedor: canal.proveedor, identificador: canal.identificador },
    telefono: conv.contacto?.telefono ?? null,
    externoContacto: conv.contacto?.externo_id ?? null,
  };
  let respondeAExterno: string | null = null;
  if (respondeA) {
    const { data } = await ctx.db.select("chat_mensajes", "externo_id").eq("id", respondeA).limit(1);
    respondeAExterno = ((data?.[0] as { externo_id?: string | null } | undefined)?.externo_id ?? null) || null;
  }

  let estado: EstadoEntrega = "enviado";
  let externoId: string | null = null;
  let error: string | null = null;
  const conector = (() => {
    try {
      return conectorPara(canal.proveedor);
    } catch (e) {
      error = (e as Error).message;
      return null;
    }
  })();
  if (conector) {
    try {
      const r =
        s.tipo === "plantilla"
          ? await conector.enviarPlantilla(destino, { id: plantilla!.id, idioma: plantilla!.idioma, variables, texto: contenido ?? "" })
          : media
            ? await conector.enviarMedia(
                destino,
                {
                  tipo: s.tipo as TipoMedia,
                  mime: media.mime,
                  nombre: media.nombre,
                  caption: contenido,
                  notaDeVoz: media.notaDeVoz,
                  url: async () => (await firmarAdjuntosChat(ctx.empresaId, [media.path], 60 * 60 * 24)).get(media.path) ?? "",
                },
                { respondeAExterno },
              )
            : await conector.enviarTexto(destino, contenido ?? "", { respondeAExterno });
      externoId = r.externo_id;
    } catch (e) {
      error = (e as Error).message || "No se pudo enviar";
    }
  }
  if (error) estado = "fallido";

  const { error: errUpd } = await ctx.db
    .update("chat_mensajes", { estado_entrega: estado, externo_id: externoId, error })
    .eq("id", mensajeId);
  if (errUpd) console.error("[conversaciones] estado de entrega", errUpd.message);

  // Simulador: las tildes avanzan solas en segundo plano (como el webhook de un proveedor).
  if (!error && conector?.simularEntrega) {
    const db = ctx.db;
    after(async () => {
      try {
        await conector.simularEntrega!(async (e) => {
          await db.update("chat_mensajes", { estado_entrega: e }).eq("id", mensajeId).neq("estado_entrega", "fallido");
        });
      } catch (e) {
        console.error("[conversaciones] simulador", (e as Error).message);
      }
    });
  }
  return { ok: true, mensaje: { ...base, estado_entrega: estado, error } };
}

// ── Audio grabado → MP3 (como el sistema actual) ─────────────────────────────
const execFileAsync = promisify(execFile);
let ffmpegDisponible: boolean | null = null;

/**
 * La nota de voz del navegador (webm/opus, o mp4 en Safari) se pasa a MP3 mono 64k: como
 * "audio normal" WhatsApp la deja reproducible siempre (las notas de voz por API fallan del
 * lado del receptor). Si no hay ffmpeg (desarrollo sin instalar) devuelve null y se guarda
 * el original. TODO: exigir ffmpeg cuando haya proveedor real (el Dockerfile lo instala).
 */
export async function audioAMp3(datos: Buffer): Promise<Buffer | null> {
  if (ffmpegDisponible === false) return null;
  const dir = await mkdtemp(join(tmpdir(), "chat-audio-"));
  const entrada = join(dir, "in");
  const salida = join(dir, "out.mp3");
  try {
    await writeFile(entrada, datos);
    await execFileAsync(
      "ffmpeg",
      ["-y", "-hide_banner", "-loglevel", "error", "-i", entrada, "-vn", "-c:a", "libmp3lame", "-b:a", "64k", "-ar", "44100", "-ac", "1", "-f", "mp3", salida],
      { timeout: 60_000 },
    );
    const out = await readFile(salida);
    ffmpegDisponible = true;
    return out.length ? out : null;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") ffmpegDisponible = false;
    console.warn("[conversaciones] ffmpeg", err.code ?? err.message);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Supervisión (Monitoreo / colas) ──────────────────────────────────────────
/** Monitoreo: ADMIN o supervisor de alguna cola (chat_cola_agentes.es_supervisor). */
export async function puedeSupervisar(ctx: TenantContext): Promise<boolean> {
  if (ctx.rol === "ADMIN") return true;
  const { data } = await ctx.db.select("chat_cola_agentes", "cola_id").eq("usuario_id", ctx.usuarioId).eq("es_supervisor", true).limit(1);
  return !!data?.length;
}

/**
 * A quién ve un supervisor en Monitoreo y Finalizadas: null = a todos (ADMIN, o supervisor
 * sin equipo cargado); si no, él mismo + sus asesores (chat_supervisor_asesores).
 */
export async function alcanceSupervision(ctx: TenantContext): Promise<string[] | null> {
  if (ctx.rol === "ADMIN") return null;
  const { data, error } = await ctx.db.select("chat_supervisor_asesores", "asesor_id").eq("supervisor_id", ctx.usuarioId);
  if (error) {
    console.error("[conversaciones] alcance supervisor", error.message);
    return null;
  }
  const ids = ((data ?? []) as unknown as { asesor_id: string }[]).map((r) => r.asesor_id);
  return ids.length ? [...new Set([ctx.usuarioId, ...ids])] : null;
}

/** Auditoría de ruteo (tomada / transferida / asignada_supervisor / liberada). Nunca rompe la acción. */
export async function registrarRuteo(
  db: TenantDb,
  e: { conversacion_id: string; evento: string; de_usuario?: string | null; a_usuario?: string | null; cola_id?: string | null; detalle?: Record<string, unknown> },
) {
  const { error } = await db.insert("chat_ruteo_eventos", {
    conversacion_id: e.conversacion_id,
    evento: e.evento,
    de_usuario: e.de_usuario ?? null,
    a_usuario: e.a_usuario ?? null,
    cola_id: e.cola_id ?? null,
    detalle: e.detalle ?? {},
  });
  if (error) console.error("[conversaciones] ruteo", error.message);
}
