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
        // Receta 73: el cliente lo puede pedir "sin …" (no se descuenta).
        se_puede_quitar: z.boolean().default(false),
      }),
    )
    .max(60, "Son demasiados ingredientes (hasta 60)"),
  // Receta 73 (solo platos Menú): si no vienen, no se tocan.
  extras: z
    .array(z.object({
      extra_id: z.string().uuid(),
      precio: z.coerce.number().min(0).max(100000000).nullish(),
      maximo: z.coerce.number().int().min(1, "El máximo de cada extra va de 1 a 20").max(20, "El máximo de cada extra va de 1 a 20").default(3),
    }))
    .max(40, "Son demasiados extras (hasta 40)")
    .optional(),
  grupos: z
    .array(z.object({
      id: z.string().uuid().nullish(),
      nombre: z.string().trim().min(1, "Escribí el nombre de cada grupo de opciones").max(60),
      obligatorio: z.boolean().default(false),
      minimo: z.coerce.number().int().min(0).max(20).default(0),
      maximo: z.coerce.number().int().min(1).max(20).default(1),
      opciones: z
        .array(z.object({
          id: z.string().uuid().nullish(),
          nombre: z.string().trim().min(1, "Escribí el nombre de cada opción").max(60),
          precio: z.coerce.number().min(0).max(100000000).default(0),
          activo: z.boolean().default(true),
        }))
        .min(1, "Cada grupo necesita al menos una opción")
        .max(20, "Hasta 20 opciones por grupo"),
    }))
    .max(12, "Son demasiados grupos de opciones (hasta 12)")
    .optional(),
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
