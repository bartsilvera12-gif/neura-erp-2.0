/**
 * Enviar un adjunto (imagen, audio, video, documento) o una nota de voz.
 *   POST /api/conversaciones/[id]/adjuntos   multipart: archivo, caption?, responde_a?, nota_voz?=1
 * Pasa por el servidor: valida tipo/tamaño (100 MB; video 16 MB como WhatsApp), sube al bucket
 * privado "chat" y recién ahí lo manda por el conector. La nota de voz (webm/opus del
 * navegador) se convierte a MP3 con ffmpeg; si no hay ffmpeg se guarda el original.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { created, fail, ERR } from "@/lib/api/responses";
import { mimeAceptado } from "@/modules/tipificacion/dominio";
import { UUID_RE } from "@/modules/tipificacion/server";
import { borrarAdjuntoChat, pathAdjuntoChat, subirAdjuntoChat } from "@/lib/conversaciones/servidor";
import { audioAMp3, enviarSaliente, idConversacion, leerConversacionEnvio } from "@/modules/conversaciones/server";
import { limiteAdjunto, tipoDesdeMime, tamanoLegible } from "@/modules/conversaciones/dominio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withTenant(async (ctx, req) => {
  const id = idConversacion(req);
  if (!id) return ERR.invalid("Conversación inválida");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("No llegó el archivo.");
  }
  const archivo = form.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) return fail("No llegó el archivo.");
  const caption = typeof form.get("caption") === "string" ? String(form.get("caption")).trim().slice(0, 1024) : "";
  const respondeA = typeof form.get("responde_a") === "string" && UUID_RE.test(String(form.get("responde_a"))) ? String(form.get("responde_a")) : null;
  const notaVoz = form.get("nota_voz") === "1";

  let mime = (archivo.type || "application/octet-stream").toLowerCase();
  let nombre = (archivo.name || "archivo").slice(0, 160);
  if (!mimeAceptado(mime, nombre)) return fail("Ese tipo de archivo no se puede enviar.", 415);
  let tipo = notaVoz ? "audio" : tipoDesdeMime(mime);
  // Un video más grande que el tope de WhatsApp viaja como documento si entra en 100 MB.
  if (tipo === "video" && archivo.size > limiteAdjunto("video")) tipo = "documento";
  if (archivo.size > limiteAdjunto(tipo)) {
    return fail(`El archivo pesa ${tamanoLegible(archivo.size)}: el máximo es ${tamanoLegible(limiteAdjunto(tipo))}.`, 413);
  }

  const conv = await leerConversacionEnvio(ctx.db, id);
  if (!conv) return ERR.notFound("Conversación");

  let datos: Buffer = Buffer.from(await archivo.arrayBuffer());
  if (notaVoz || (tipo === "audio" && /webm|ogg|mp4|m4a|aac/.test(mime))) {
    const mp3 = await audioAMp3(datos);
    if (mp3) {
      datos = mp3;
      mime = "audio/mpeg";
      nombre = `${nombre.replace(/\.[a-z0-9]+$/i, "") || "nota-de-voz"}.mp3`;
    }
    // Sin ffmpeg: queda el original (webm/opus). TODO: obligatorio con proveedor real.
  }

  const path = pathAdjuntoChat(ctx.empresaId, id, nombre);
  const sub = await subirAdjuntoChat(path, datos, mime);
  if (sub.error) {
    console.error("[conversaciones] subir adjunto", sub.error);
    return fail("No se pudo subir el archivo.");
  }

  const r = await enviarSaliente(ctx, conv, {
    tipo,
    contenido: caption || null,
    responde_a: respondeA,
    media: { path, mime, nombre, size: datos.length, notaDeVoz: notaVoz },
  });
  if (!r.ok) {
    await borrarAdjuntoChat(path);
    return fail(r.mensaje, r.status);
  }
  return created(r.mensaje);
});
