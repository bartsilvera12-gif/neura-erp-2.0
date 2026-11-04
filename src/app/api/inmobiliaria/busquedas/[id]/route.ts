/** Borrar lo que buscaba un cliente (receta 134): DELETE /api/inmobiliaria/busquedas/<id> */
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { falloInmo, idDe } from "@/modules/inmobiliaria/server";

export const dynamic = "force-dynamic";

export const DELETE = withTenant(async (ctx, req) => {
  const id = idDe(req, "busquedas");
  if (!id) return fail("Búsqueda inválida", 400);
  const { error } = await ctx.db.rpc("cliente_busqueda_borrar", { p_id: id });
  if (error) return falloInmo(error, "No se pudo borrar la búsqueda");
  return ok({ id });
});
