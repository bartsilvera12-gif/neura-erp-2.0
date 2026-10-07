/**
 * Producto — detalle, edición y borrado.
 *   GET    /api/productos/[id]  → un producto
 *   PATCH  /api/productos/[id]  → edita (ADMIN). Desactivar/reactivar = PATCH { activo }.
 *                                 Si cambia el stock, la diferencia queda en el kardex.
 *   DELETE /api/productos/[id]  → borrado PERMANENTE (ADMIN). Si tiene historial (ventas o
 *                                 movimientos de stock) no se borra: 409, hay que desactivarlo
 *                                 (mismo criterio que Ferretería República).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { registrarMovimiento } from "@/modules/inventario/server/kardex";

function prodId(req: { url: string }): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf("productos");
  return i >= 0 ? (segs[i + 1] ?? null) : null;
}

const DETALLE =
  "id, nombre, sku, costo_promedio, precio_venta, precio_mayorista, precio_distribuidor, descuento_pct, stock_actual, stock_minimo, unidad_medida, tipo_iva, tipo_producto, controla_stock, es_vendible, activo, imagen_url, descripcion, codigo_barras, categoria_principal_id";

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
  codigo_barras: z.string().trim().max(60).nullish(),
  categoria_principal_id: z.string().uuid().nullish(),
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
    // Stock anterior, para dejar la diferencia en el kardex.
    const antes = input.stock_actual !== undefined
      ? await ctx.db.select("productos", "nombre, sku, stock_actual, costo_promedio").eq("id", id).limit(1)
      : null;
    const patch: Record<string, unknown> = { ...input, updated_at: new Date().toISOString() };
    if (input.codigo_barras !== undefined) patch.codigo_barras = input.codigo_barras || null;
    const { error } = await ctx.db.update("productos", patch).eq("id", id);
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) return fail("Ya existe un producto con ese SKU.", 409);
      return ERR.server();
    }
    const prev = antes?.data?.[0] as { nombre: string; sku: string; stock_actual: number; costo_promedio: number } | undefined;
    if (prev && input.stock_actual !== undefined) {
      await registrarMovimiento(ctx, {
        producto_id: id,
        producto_nombre: input.nombre ?? prev.nombre,
        producto_sku: input.sku ?? prev.sku,
        delta: input.stock_actual - Number(prev.stock_actual),
        costo_unitario: input.costo_promedio ?? Number(prev.costo_promedio),
        origen: "ajuste_manual",
        referencia: "Edición manual del producto",
      });
    }
    return ok({ id });
  },
  { roles: ["ADMIN"], body: editar },
);

const CON_HISTORIAL =
  "El producto tiene historial (ventas o movimientos de stock). Desactivalo en lugar de eliminarlo.";

export const DELETE = withTenant(
  async (ctx, req) => {
    const id = prodId(req);
    if (!id) return ERR.invalid("Falta el id del producto");

    // ventas_items apunta con ON DELETE SET NULL: el borrado "funcionaría" y dejaría
    // ventas huérfanas. Se chequea antes. El kardex lo frena la base (FK RESTRICT).
    const usado = await ctx.db.select("ventas_items", "id").eq("producto_id", id).limit(1);
    if (usado.error) return ERR.server();
    if (usado.data?.length) return fail(CON_HISTORIAL, 409);

    const { data, error } = await ctx.db.delete("productos").eq("id", id).select("id");
    if (error) {
      if ((error as { code?: string }).code === "23503") return fail(CON_HISTORIAL, 409);
      return fail("No se pudo eliminar el producto.", 500);
    }
    if (!data?.length) return ERR.notFound("producto");
    return ok({ id });
  },
  { roles: ["ADMIN"] },
);
