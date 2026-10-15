/**
 * Respuestas rápidas ("/hola" en el chat).
 *   GET  /api/conversaciones/respuestas            → todas (activas e inactivas) — para configurarlas
 *   POST /api/conversaciones/respuestas { atajo, texto, orden?, activo? }   (ADMIN)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db
    .select("chat_respuestas_rapidas", "id, atajo, texto, orden, activo, canal_id")
    .order("orden")
    .order("atajo");
  if (error) return ERR.server();
  return ok({ respuestas: data ?? [] });
});

const alta = z.object({
  atajo: z
    .string()
    .trim()
    .min(2, "El atajo es obligatorio")
    .max(40)
    .transform((v) => `/${v.replace(/^\/+/, "").replace(/\s+/g, "-").toLowerCase()}`),
  texto: z.string().trim().min(1, "El texto es obligatorio").max(4096),
  orden: z.number().int().min(0).max(9999).optional(),
  activo: z.boolean().optional(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data: dup } = await ctx.db.select("chat_respuestas_rapidas", "id").eq("atajo", input.atajo).limit(1);
    if (dup?.length) return fail(`Ya existe el atajo ${input.atajo}.`, 409);
    const { data, error } = await ctx.db.insert("chat_respuestas_rapidas", {
      atajo: input.atajo,
      texto: input.texto,
      orden: input.orden ?? 0,
      activo: input.activo ?? true,
    });
    if (error) return ERR.server();
    return created(data?.[0] ?? null);
  },
  { permiso: "configuracion", body: alta },
);
