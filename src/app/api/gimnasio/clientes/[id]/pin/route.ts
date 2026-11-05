/** POST /api/gimnasio/clientes/<id>/pin → PIN nuevo de 4 números para que el alumno marque solo (receta 153). Se ve una sola vez. */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { falloGim, idDe } from "@/modules/gimnasio/server";

export const POST = withTenant(async (ctx, req) => {
  const id = idDe(req, "clientes");
  if (!id) return fail("Cliente inválido", 400);
  const { data, error } = await ctx.db.rpc("gim_alumno_pin_crear", { p_cliente: id });
  if (error) return falloGim(error, "No se pudo crear el PIN");
  return ok(data);
}, { permiso: "gimnasio_recepcion" });