/**
 * Receta de un producto (receta 72).
 *   GET /api/inventario/recetas/[id] → producto, rendimiento, ingredientes (con costo y stock),
 *                                      costo por unidad, porciones posibles y dónde se usa.
 *   PUT /api/inventario/recetas/[id] → guarda { rendimiento, notas, items: [{ insumo_id, cantidad,
 *                                      unidad, merma_pct }] }. items vacío = quitar la receta.
 *        La base valida tipos, unidades, merma (0–90 %), ciclos y profundidad (5).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";
import { falloRpc } from "@/modules/inventario/server/rpc";

export const GET = withTenant(async (ctx, req) => {
  const id = idDeRuta(req.url, "recetas");
  if (!UUID_RE.test(id ?? "")) return idInvalido("producto");
  const { data, error } = await ctx.db.rpc("receta_detalle", { p_producto: id });
  if (error) return /no encontrado/i.test(error.message) ? fail("Producto no encontrado", 404) : falloRpc(error);
  return ok(data);
});

const guardar = z.object({
  rendimiento: z.coerce.number().positive("El rendimiento tiene que ser mayor a 0").max(100000),
  notas: z.string().trim().max(1000).nullish(),
  items: z
    .array(
      z.object({
        insumo_id: z.string().uuid(),
        cantidad: z.coerce.number().positive("Cargá la cantidad de cada ingrediente"),
        unidad: z.enum(["Unidad", "kg", "g", "l", "ml"]),
        merma_pct: z.coerce.number().min(0).max(90, "La merma va de 0 a 90 %").default(0),
      }),
    )
    .max(60, "Son demasiados ingredientes (hasta 60)"),
});

export const PUT = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req.url, "recetas");
    if (!UUID_RE.test(id ?? "")) return idInvalido("producto");
    const { data, error } = await ctx.db.rpc("receta_guardar", { p: { producto_id: id, ...input } });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { permiso: "editar_productos", body: guardar },
);
