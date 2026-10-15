/**
 * Editar / borrar una respuesta rápida (ADMIN).
 *   PATCH  /api/conversaciones/respuestas/[rid] { atajo?, texto?, orden?, activo? }
 *   DELETE /api/conversaciones/respuestas/[rid]
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, noContent, fail, ERR } from "@/lib/api/responses";
import { idDeRuta } from "@/modules/tipificacion/server";

export const dynamic = "force-dynamic";

const cambios = z.object({
  atajo: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .transform((v) => `/${v.replace(/^\/+/, "").replace(/\s+/g, "-").toLowerCase()}`)
    .optional(),
  texto: z.string().trim().min(1).max(4096).optional(),
  orden: z.number().int().min(0).max(9999).optional(),
  activo: z.boolean().optional(),
});

export const PATCH = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req, "respuestas");
    if (!id) return ERR.invalid("Respuesta inválida");
    if (input.atajo) {
      const { data: dup } = await ctx.db.select("chat_respuestas_rapidas", "id").eq("atajo", input.atajo).neq("id", id).limit(1);
      if (dup?.length) return fail(`Ya existe el atajo ${input.atajo}.`, 409);
    }
    const { data, error } = await ctx.db.update("chat_respuestas_rapidas", input).eq("id", id).select();
    if (error) return ERR.server();
    if (!data?.length) return ERR.notFound("Respuesta");
    return ok(data[0]);
  },
  { permiso: "configuracion", body: cambios },
);

export const DELETE = withTenant(
  async (ctx, req) => {
    const id = idDeRuta(req, "respuestas");
    if (!id) return ERR.invalid("Respuesta inválida");
    const { error } = await ctx.db.delete("chat_respuestas_rapidas").eq("id", id);
    if (error) return ERR.server();
    return noContent();
  },
  { permiso: "configuracion" },
);
