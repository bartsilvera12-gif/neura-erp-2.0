/** PUT /api/sorteos/<id>/premios { premios: [{ nombre, descripcion?, imagen_url? }] } (sorteos_administrar). */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { falloSorteo, idDe } from "@/modules/sorteos/server";

const premio = z.object({ nombre: z.string(), descripcion: z.string().nullish(), imagen_url: z.string().nullish() });

export const PUT = withTenant(async (ctx, req, body) => {
  const id = idDe(req, "sorteos");
  if (!id) return fail("Sorteo inválido", 400);
  const { data, error } = await ctx.db.rpc("sorteo_premios_guardar", { p_sorteo: id, p_premios: body.premios });
  if (error) return falloSorteo(error, "No se pudieron guardar los premios");
  return ok(data);
}, { permiso: "sorteos_administrar", body: z.object({ premios: z.array(premio).min(1).max(50) }) });
