/**
 * Crear un prospecto del CRM desde el chat (origen whatsapp) y vincularlo al contacto.
 *   POST /api/conversaciones/[id]/prospecto { servicio?, valor_estimado?, observaciones? }
 *   → { prospecto: { id, numero_control }, fila }
 * Si el contacto ya tiene prospecto, devuelve ese (409).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, fail, ERR } from "@/lib/api/responses";
import { idConversacion, leerResumen } from "@/modules/conversaciones/server";
import { nombreContacto } from "@/modules/conversaciones/dominio";

export const dynamic = "force-dynamic";

const cuerpo = z
  .object({
    servicio: z.string().trim().max(200).nullish(),
    valor_estimado: z.number().min(0).max(1e13).nullish(),
    observaciones: z.string().trim().max(2000).nullish(),
  })
  .default({});

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idConversacion(req);
    if (!id) return ERR.invalid("Conversación inválida");
    const conv = await leerResumen(ctx.db, id);
    if (!conv) return ERR.notFound("Conversación");
    if (conv.prospecto_id) return fail("Este contacto ya tiene un prospecto en el CRM.", 409);

    const nombre = nombreContacto(conv);
    const { data, error } = await ctx.db.insert("crm_prospectos", {
      contacto: nombre === "Sin nombre" ? conv.contacto_telefono ?? "Contacto de WhatsApp" : nombre,
      telefono: conv.contacto_telefono,
      servicio: input?.servicio || null,
      valor_estimado: input?.valor_estimado ?? 0,
      observaciones: input?.observaciones || null,
      origen_creacion: "whatsapp",
      origen_detalle: conv.canal_nombre || null,
      first_conversation_id: id,
      cliente_id: conv.cliente_id,
      responsable_usuario_id: ctx.usuarioId,
      created_by: ctx.usuarioId,
    });
    const p = (data?.[0] ?? null) as { id?: string; numero_control?: string } | null;
    if (error || !p?.id) {
      console.error("[conversaciones] prospecto", error?.message);
      return ERR.server();
    }
    await ctx.db.update("chat_contactos", { prospecto_id: p.id, updated_at: new Date().toISOString() }).eq("id", conv.contacto_id);
    return created({ prospecto: { id: p.id, numero_control: p.numero_control ?? "" }, fila: await leerResumen(ctx.db, id) });
  },
  { body: cuerpo },
);
