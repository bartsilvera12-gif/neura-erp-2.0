/**
 * Un proveedor — edición y borrado (ADMIN).
 *   PATCH  /api/proveedores/[id] → edita; también activar/desactivar con { activo }.
 *   DELETE /api/proveedores/[id] → borra. Si ya tiene compras registradas no se borra
 *                                  (409): se desactiva, así no se pierde el historial.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { cuerpoProveedor } from "@/modules/proveedores/esquema";
import { errorProveedor, guardarRubros } from "@/modules/proveedores/server";

const idDe = (req: { url: string }) => {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segs[segs.indexOf("proveedores") + 1];
  return /^[0-9a-f-]{36}$/i.test(id ?? "") ? id : null;
};

const parcial = cuerpoProveedor.partial();

export const PATCH = withTenant(
  async (ctx, req, input) => {
    const id = idDe(req);
    if (!id) return ERR.invalid("Falta el id del proveedor");
    const { categoria_ids, categorias_nuevas, ...datos } = input;
    const patch: Record<string, unknown> = { ...datos, updated_at: new Date().toISOString() };
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
    if (datos.condicion_pago === "contado") patch.plazo_pago_dias = null;
    const { data, error } = await ctx.db.update("proveedores", patch).eq("id", id).select("id");
    if (error) return fail(errorProveedor(error.message), 409);
    if (!data?.length) return ERR.notFound("proveedor");
    // Los rubros solo se tocan si vinieron en el pedido (activar/desactivar no los manda).
    if (categoria_ids !== undefined || categorias_nuevas !== undefined) {
      try {
        await guardarRubros(ctx.db, id, categoria_ids ?? [], categorias_nuevas ?? []);
      } catch (e) {
        return fail((e as Error).message === "db" ? "No se pudieron guardar los rubros." : (e as Error).message, 500);
      }
    }
    return ok({ id });
  },
  { roles: ["ADMIN"], body: parcial },
);

export const DELETE = withTenant(
  async (ctx, req) => {
    const id = idDe(req);
    if (!id) return ERR.invalid("Falta el id del proveedor");
    const usos = await ctx.db.select("movimientos_inventario", "id", { count: "exact", head: true }).eq("proveedor_id", id);
    if (usos.error) return ERR.server();
    if ((usos.count ?? 0) > 0) {
      return fail("Este proveedor ya tiene compras registradas: desactivalo en vez de borrarlo, así no se pierde el historial.", 409);
    }
    const { data, error } = await ctx.db.delete("proveedores").eq("id", id).select("id");
    if (error) return fail("No se pudo borrar el proveedor.", 500);
    if (!data?.length) return ERR.notFound("proveedor");
    return ok({ id });
  },
  { roles: ["ADMIN"] },
);
