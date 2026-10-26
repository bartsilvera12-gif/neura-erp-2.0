/**
 * Un extra de la lista común (receta 73).
 *   PUT    /api/inventario/recetas/extras/[id] → guarda { nombre, insumo_id, cantidad, unidad, precio, activo }
 *   DELETE /api/inventario/recetas/extras/[id] → lo borra (y lo saca de los platos que lo tenían).
 *          Las ventas ya hechas conservan su detalle (snapshot).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";
import { falloRpc } from "@/modules/inventario/server/rpc";
import { extraSchema } from "@/modules/inventario/server/extras";

export const PUT = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req.url, "extras");
    if (!UUID_RE.test(id ?? "")) return idInvalido("extra");
    const { data, error } = await ctx.db.rpc("extra_guardar", { p: { ...input, id } });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { permiso: "editar_productos", body: extraSchema },
);

export const DELETE = withTenant(
  async (ctx, req) => {
    const id = idDeRuta(req.url, "extras");
    if (!UUID_RE.test(id ?? "")) return idInvalido("extra");
    const { data, error } = await ctx.db.rpc("extra_eliminar", { p_id: id });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { permiso: "editar_productos" },
);
