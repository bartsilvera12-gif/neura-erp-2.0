/**
 * Vincular (o desvincular) el contacto del chat con un cliente del ERP.
 *   POST /api/conversaciones/[id]/vincular { cliente_id: uuid | null }
 * Se usa después de "Crear cliente" desde la ficha, o para corregir un vínculo.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { idConversacion, leerResumen } from "@/modules/conversaciones/server";

export const dynamic = "force-dynamic";

const cuerpo = z.object({ cliente_id: z.string().uuid().nullable() });

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idConversacion(req);
    if (!id) return ERR.invalid("Conversación inválida");
    const conv = await leerResumen(ctx.db, id);
    if (!conv) return ERR.notFound("Conversación");
    if (input.cliente_id) {
      const { data } = await ctx.db.select("clientes", "id").eq("id", input.cliente_id).is("deleted_at", null).limit(1);
      if (!data?.length) return fail("El cliente no existe.");
    }
    const { error } = await ctx.db
      .update("chat_contactos", { cliente_id: input.cliente_id, updated_at: new Date().toISOString() })
      .eq("id", conv.contacto_id);
    if (error) return ERR.server();
    return ok(await leerResumen(ctx.db, id));
  },
  { body: cuerpo },
);
