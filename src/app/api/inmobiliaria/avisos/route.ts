/**
 * Avisos a interesados (receta 140).
 *   GET /api/inmobiliaria/avisos              → los pendientes de la empresa (propiedades disponibles)
 *   GET /api/inmobiliaria/avisos?propiedad=id → todos los de esa propiedad (pendientes, enviados, descartados)
 */
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { falloInmo } from "@/modules/inmobiliaria/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withTenant(async (ctx, req) => {
  const propiedad = new URL(req.url).searchParams.get("propiedad");
  if (propiedad && !UUID.test(propiedad)) return fail("Propiedad inválida", 400);
  const { data, error } = await ctx.db.rpc("propiedad_avisos_lista", { p_propiedad: propiedad || null });
  if (error) return falloInmo(error, "No se pudieron leer los avisos");
  return ok(data);
});
