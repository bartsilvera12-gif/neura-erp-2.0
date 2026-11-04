/**
 * Ficha del cliente en Inmobiliaria (receta 134).
 *   GET /api/inmobiliaria/clientes/<id> → { como_dueno, compradas, contratos, busquedas (con coincidencias) }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { falloInmo, idDe } from "@/modules/inmobiliaria/server";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const id = idDe(req, "clientes");
  if (!id) return fail("Cliente inválido", 400);
  const { data, error } = await ctx.db.rpc("cliente_inmobiliaria", { p_cliente: id });
  if (error) return falloInmo(error, "No se pudo leer la ficha");
  return ok(data);
});
