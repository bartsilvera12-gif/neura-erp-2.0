/**
 * Aplicar una sugerencia de un informe (solo ADMIN, receta 174): se agrega a las instrucciones del
 * bot (generales o de su categoría). No toca ningún chat.
 *   POST /api/conversaciones/analisis/<id> { indice }
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { aplicarSugerencia } from "@/lib/conversaciones/analisis";
import { UUID_RE, idDeRuta } from "@/modules/inventario/server/ids";

export const dynamic = "force-dynamic";

export const POST = withTenant(async (ctx, req, b) => {
  const id = idDeRuta(req.url, "analisis");
  if (!id || !UUID_RE.test(id)) return fail("Informe inválido", 400);
  try {
    return ok({ donde: await aplicarSugerencia(ctx.empresaId, id, b.indice, ctx.usuarioId) });
  } catch (e) {
    return fail((e as Error).message, 422);
  }
}, { roles: ["ADMIN"], body: z.object({ indice: z.number().int().min(0).max(50) }) });
