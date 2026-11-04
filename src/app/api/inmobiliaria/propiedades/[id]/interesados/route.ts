/** Clientes con una búsqueda que esta propiedad cumple (receta 134): GET /api/inmobiliaria/propiedades/<id>/interesados */
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { falloInmo, idDe } from "@/modules/inmobiliaria/server";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const id = idDe(req, "propiedades");
  if (!id) return fail("Propiedad inválida", 400);
  const { data, error } = await ctx.db.rpc("propiedad_interesados", { p_id: id });
  if (error) return falloInmo(error, "No se pudieron leer los interesados");
  return ok(data);
});
