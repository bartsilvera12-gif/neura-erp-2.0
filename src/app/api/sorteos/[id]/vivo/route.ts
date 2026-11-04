/** POST /api/sorteos/<id>/vivo { url } → link del vivo por redes donde se sortea (receta 127, sorteos_administrar). */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { falloSorteo, idDe } from "@/modules/sorteos/server";

export const dynamic = "force-dynamic";

export const POST = withTenant(async (ctx, req, body) => {
  const id = idDe(req, "sorteos");
  if (!id) return fail("Sorteo inválido", 400);
  const { data, error } = await ctx.db.rpc("sorteo_vivo_guardar", { p_id: id, p_url: body.url ?? null });
  if (error) return falloSorteo(error, "No se pudo guardar el link del vivo");
  return ok(data);
}, { permiso: "sorteos_administrar", body: z.object({ url: z.string().trim().max(500).nullish() }) });
