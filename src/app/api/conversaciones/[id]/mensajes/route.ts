/**
 * Hilo de una conversación.
 *   GET  /api/conversaciones/[id]/mensajes                       → últimos 50 (ascendente)
 *   GET  …?antes_at=&antes_id=                                    → los 50 anteriores ("ver anteriores")
 *   GET  …?desde_at=                                              → los nuevos desde el último que se ve
 *        (lo que se pide al llegar un aviso "mensaje" de Realtime; nunca el hilo entero)
 *   POST /api/conversaciones/[id]/mensajes
 *        { tipo: "texto", contenido, responde_a? } | { tipo: "nota", contenido }
 *        | { tipo: "plantilla", plantilla_id, variables }
 *        → el mensaje guardado (pendiente → enviado | fallido por el conector).
 * Adjuntos y notas de voz: POST /api/conversaciones/[id]/adjuntos (multipart).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";
import { UUID_RE } from "@/modules/tipificacion/server";
import { aMensaje, enviarSaliente, idConversacion, leerConversacionEnvio } from "@/modules/conversaciones/server";
import { COLS_MENSAJE, PAGINA_HILO, type Mensaje } from "@/modules/conversaciones/dominio";

export const dynamic = "force-dynamic";

const fechaValida = (v: string | null) => (v && Number.isFinite(Date.parse(v)) ? v : null);

export const GET = withTenant(async (ctx, req) => {
  const id = idConversacion(req);
  if (!id) return ERR.invalid("Conversación inválida");
  const sp = new URL(req.url).searchParams;
  const desde = fechaValida(sp.get("desde_at"));

  if (desde) {
    // Nuevos: >= el último que se ve (el navegador descarta los repetidos por id).
    const { data, error } = await ctx.db
      .select("chat_mensajes", COLS_MENSAJE)
      .eq("conversacion_id", id)
      .gte("created_at", desde)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(100);
    if (error) return ERR.server();
    return ok({ mensajes: ((data ?? []) as unknown as Record<string, unknown>[]).map(aMensaje), hay_mas: false });
  }

  const antesAt = fechaValida(sp.get("antes_at"));
  const antesId = sp.get("antes_id");
  const { data, error } = await ctx.db.rpc<Record<string, unknown>[]>("chat_hilo", {
    p_conversacion: id,
    p_antes_at: antesAt && antesId && UUID_RE.test(antesId) ? antesAt : null,
    p_antes_id: antesAt && antesId && UUID_RE.test(antesId) ? antesId : null,
    p_limite: PAGINA_HILO,
  });
  if (error) {
    console.error("[conversaciones] hilo", error.message);
    return ERR.server();
  }
  const mensajes: Mensaje[] = (data ?? []).map(aMensaje);
  return ok({ mensajes, hay_mas: mensajes.length === PAGINA_HILO });
});

const cuerpo = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("texto"),
    contenido: z.string().trim().min(1, "Escribí un mensaje").max(4096, "Máximo 4096 caracteres"),
    responde_a: z.string().uuid().nullish(),
  }),
  z.object({ tipo: z.literal("nota"), contenido: z.string().trim().min(1, "Escribí la nota").max(4096) }),
  z.object({
    tipo: z.literal("plantilla"),
    plantilla_id: z.string().min(1).max(80),
    variables: z.record(z.string().max(500)).default({}),
  }),
]);

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idConversacion(req);
    if (!id) return ERR.invalid("Conversación inválida");
    const conv = await leerConversacionEnvio(ctx.db, id);
    if (!conv) return ERR.notFound("Conversación");
    const r = await enviarSaliente(
      ctx,
      conv,
      input.tipo === "plantilla"
        ? { tipo: "plantilla", plantilla_id: input.plantilla_id, variables: input.variables ?? {} }
        : input.tipo === "nota"
          ? { tipo: "nota", contenido: input.contenido }
          : { tipo: "texto", contenido: input.contenido, responde_a: input.responde_a ?? null },
    );
    if (!r.ok) return fail(r.mensaje, r.status);
    return created(r.mensaje);
  },
  { body: cuerpo },
);
