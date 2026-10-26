/**
 * Lista común de extras de los platos (receta 73): Inventario › Recetas › Extras.
 *   GET  /api/inventario/recetas/extras → { items: [...] } con costo, lo que alcanza el stock y en
 *                                          cuántos platos está activado.
 *   POST /api/inventario/recetas/extras → crea { nombre, insumo_id, cantidad, unidad, precio, activo }.
 * La base valida (materia prima o preparación de la empresa, unidad compatible, nombre único).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";
import { extraSchema } from "@/modules/inventario/server/extras";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.rpc("extras_listar");
  if (error) return falloRpc(error);
  return ok(data);
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("extra_guardar", { p: input });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { permiso: "editar_productos", body: extraSchema },
);
