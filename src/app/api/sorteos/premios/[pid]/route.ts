/**
 * Ganador de un premio (receta 123), con la venta cerrada.
 *   POST /api/sorteos/premios/<pid> { accion: "sortear" }                               → sorteo digital verificable
 *   POST /api/sorteos/premios/<pid> { accion: "manual", numero, metodo: urna|externo, nota? } → número sacado de la urna o de una lotería
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { falloSorteo, idDe } from "@/modules/sorteos/server";

const cuerpo = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("sortear") }),
  z.object({ accion: z.literal("manual"), numero: z.number().int().min(0), metodo: z.enum(["urna", "externo"]), nota: z.string().max(300).nullish() }),
]);

export const POST = withTenant(async (ctx, req, body) => {
  const id = idDe(req, "premios");
  if (!id) return fail("Premio inválido", 400);
  const { data, error } = body.accion === "sortear"
    ? await ctx.db.rpc("sorteo_sortear", { p_premio: id })
    : await ctx.db.rpc("sorteo_ganador_manual", { p_premio: id, p_numero: body.numero, p_metodo: body.metodo, p_nota: body.nota ?? null });
  if (error) return falloSorteo(error, "No se pudo cargar el ganador");
  return ok(data);
}, { permiso: "sorteos_administrar", body: cuerpo });
