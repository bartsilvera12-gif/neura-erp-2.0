/**
 * Producto — detalle, edición y borrado.
 *   GET    /api/productos/[id]  → un producto
 *   PATCH  /api/productos/[id]  → edita (ADMIN). Desactivar/reactivar = PATCH { activo }.
 *                                 El stock NO se edita acá: se mueve con documentos (compra,
 *                                 venta, traslado, ajuste o pérdida). stock_actual se ignora.
 *   DELETE /api/productos/[id]  → borrado PERMANENTE (ADMIN). Si tiene historial (ventas o
 *                                 movimientos de stock) no se borra: 409, hay que desactivarlo
 *                                 (mismo criterio que Ferretería República).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { COLS_PRODUCTO_DETALLE } from "@/modules/inventario/server/productos-lote";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";

function prodId(req: { url: string }): string | null {
  return idDeRuta(req.url, "productos");
}

// Mismas columnas que /api/productos/lote (compartidas para que no se desfasen).
const DETALLE = COLS_PRODUCTO_DETALLE;

export const GET = withTenant(async (ctx, req) => {
  const id = prodId(req);
  if (!id) return ERR.invalid("Falta el id del producto");
  // "undefined" u otro texto: 400 (antes iba a la base y volvía 500).
  if (!UUID_RE.test(id)) return idInvalido();
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
  proveedor_principal_id: z.string().uuid().nullish(),
  costo_promedio: z.coerce.number().min(0).optional(),
  precio_venta: z.coerce.number().min(0).optional(),
  precio_mayorista: z.coerce.number().min(0).nullish(),
  precio_distribuidor: z.coerce.number().min(0).nullish(),
  descuento_pct: z.coerce.number().min(0).max(100).optional(),
  stock_minimo: z.coerce.number().optional(),
  unidad_medida: z.string().trim().optional(),
  tipo_iva: z.enum(["EXENTA", "5%", "10%"]).optional(),
  controla_stock: z.boolean().optional(),
  controla_lotes: z.boolean().optional(),
  es_vendible: z.boolean().optional(),
  en_menu_qr: z.boolean().optional(),
  imagen_url: z.string().url().max(500).nullish(),
  activo: z.boolean().optional(),
});

export const PATCH = withTenant(
  async (ctx, req, input) => {
    const id = prodId(req);
    if (!id) return ERR.invalid("Falta el id del producto");
    if (!UUID_RE.test(id)) return idInvalido();
    const patch: Record<string, unknown> = { ...input, updated_at: new Date().toISOString() };
    if (input.codigo_barras !== undefined) patch.codigo_barras = input.codigo_barras || null;
    // Lotes solo tiene sentido si controla stock.
    if (input.controla_stock === false) patch.controla_lotes = false;
    const { error } = await ctx.db.update("productos", patch).eq("id", id);
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) return fail("Ya existe un producto con ese SKU.", 409);
      return ERR.server();
    }
    return ok({ id });
  },
  { permiso: "editar_productos", body: editar },
);

const CON_HISTORIAL =
  "El producto tiene historial (ventas o movimientos de stock). Desactivalo en lugar de eliminarlo.";

export const DELETE = withTenant(
  async (ctx, req) => {
    const id = prodId(req);
    if (!id) return ERR.invalid("Falta el id del producto");
    if (!UUID_RE.test(id)) return idInvalido();
  // "undefined" u otro texto: 400 (antes iba a la base y volvía 500).
  if (!UUID_RE.test(id)) return idInvalido();

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
  { permiso: "editar_productos" },
);
