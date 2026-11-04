/**
 * Resolver un aviso a un interesado (receta 140): PATCH /api/inmobiliaria/avisos/<id>
 *   { estado: "enviado", canal: "whatsapp" | "otro" } · { estado: "descartado" } · { estado: "pendiente" } (deshacer)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { falloInmo, idDe } from "@/modules/inmobiliaria/server";

export const dynamic = "force-dynamic";

const cuerpo = z.object({
  estado: z.enum(["enviado", "descartado", "pendiente"]),
  canal: z.enum(["whatsapp", "otro"]).nullish(),
}).strict();

export const PATCH = withTenant(async (ctx, req, body) => {
  const id = idDe(req, "avisos");
  if (!id) return fail("Aviso inválido", 400);
  const { data, error } = await ctx.db.rpc("propiedad_aviso_resolver", { p_id: id, p_estado: body.estado, p_canal: body.canal ?? null });
  if (error) return falloInmo(error, "No se pudo guardar el aviso");
  return ok(data);
}, { body: cuerpo });
