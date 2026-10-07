/**
 * Producto — detalle, edición y borrado.
 *   GET    /api/productos/[id]  → un producto
 *   PATCH  /api/productos/[id]  → edita (ADMIN)
 *   DELETE /api/productos/[id]  → borra si nunca se vendió; si tiene ventas, lo da de baja
 *                                 (activo=false) para no romper los informes. (ADMIN)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";

function prodId(req: { url: string }): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf("productos");
  return i >= 0 ? (segs[i + 1] ?? null) : null;
}

const DETALLE =
  "id, nombre, sku, costo_promedio, precio_venta, precio_mayorista, precio_distribuidor, descuento_pct, stock_actual, stock_minimo, unidad_medida, tipo_iva, tipo_producto, controla_stock, es_vendible, activo, imagen_url, descripcion, codigo_barras";

export const GET = withTenant(async (ctx, req) => {
  const id = prodId(req);
  if (!id) return ERR.invalid("Falta el id del producto");
  const { data, error } = await ctx.db.select("productos", DETALLE).eq("id", id).limit(1);
  if (error) return ERR.server();
  if (!data?.length) return ERR.notFound();
  return ok(data[0]);
});

const editar = z.object({
  nombre: z.string().trim().min(1).optional(),
  sku: z.string().trim().min(1).optional(),
  costo_promedio: z.coerce.number().min(0).optional(),
  precio_venta: z.coerce.number().min(0).optional(),
  precio_mayorista: z.coerce.number().min(0).nullish(),
  precio_distribuidor: z.coerce.number().min(0).nullish(),
  descuento_pct: z.coerce.number().min(0).max(100).optional(),
  stock_actual: z.coerce.number().optional(),
  stock_minimo: z.coerce.number().optional(),
  unidad_medida: z.string().trim().optional(),
  tipo_iva: z.enum(["EXENTA", "5%", "10%"]).optional(),
  controla_stock: z.boolean().optional(),
  es_vendible: z.boolean().optional(),
  imagen_url: z.string().url().max(500).nullish(),
  activo: z.boolean().optional(),
});

export const PATCH = withTenant(
  async (ctx, req, input) => {
    const id = prodId(req);
    if (!id) return ERR.invalid("Falta el id del producto");
    const { error } = await ctx.db.update("productos", { ...input, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) return fail("Ya existe un producto con ese SKU.", 409);
      return ERR.server();
    }
    return ok({ id });
  },
  { roles: ["ADMIN"], body: editar },
);

export const DELETE = withTenant(
  async (ctx, req) => {
    const id = prodId(req);
    if (!id) return ERR.invalid("Falta el id del producto");

    const prod = await ctx.db.select("productos", "nombre").eq("id", id).limit(1);
    const nombre = prod.data?.[0]?.nombre ?? "El producto";

    // ¿Se vendió alguna vez? Si sí, no se borra: se da de baja.
    const usado = await ctx.db.select("ventas_items", "id").eq("producto_id", id).limit(1);
    if (usado.error) return ERR.server();

    if (usado.data?.length) {
      const { error } = await ctx.db.update("productos", { activo: false, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) return ERR.server();
      return ok({ modo: "baja", nombre });
    }

    const { error } = await ctx.db.delete("productos").eq("id", id);
    if (error) return ERR.server();
    return ok({ modo: "eliminado", nombre });
  },
  { roles: ["ADMIN"] },
);
