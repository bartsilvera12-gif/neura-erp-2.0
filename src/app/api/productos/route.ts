/**
 * Productos — catálogo que vende la caja.
 *   GET  /api/productos  → productos vendibles y activos de la empresa
 *   POST /api/productos  → alta rápida de producto (ADMIN)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, ERR } from "@/lib/api/responses";

const COLS =
  "id, nombre, sku, costo_promedio, precio_venta, precio_mayorista, precio_distribuidor, descuento_pct, stock_actual, stock_minimo, unidad_medida, tipo_iva, tipo_producto, controla_stock, es_vendible, activo, imagen_url";

export const GET = withTenant(async (ctx, req) => {
  // scope=inventario → todos los activos (para gestión de stock).
  // por defecto → solo vendibles (lo que ofrece la caja/POS).
  const scope = new URL(req.url).searchParams.get("scope");
  let query = ctx.db.select("productos", COLS).eq("activo", true);
  if (scope !== "inventario") query = query.eq("es_vendible", true);
  const { data, error } = await query.order("nombre", { ascending: true });
  if (error) return ERR.server();
  return ok(data ?? []);
});

const crearProducto = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio"),
  sku: z.string().trim().min(1, "El SKU es obligatorio"),
  precio_venta: z.coerce.number().min(0).default(0),
  precio_mayorista: z.coerce.number().min(0).nullish(),
  descuento_pct: z.coerce.number().min(0).max(100).default(0),
  stock_actual: z.coerce.number().default(0),
  unidad_medida: z.string().trim().default("Unidad"),
  tipo_iva: z.enum(["EXENTA", "5%", "10%"]).default("10%"),
  controla_stock: z.boolean().default(true),
  imagen_url: z.string().url().max(500).nullish(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.insert("productos", input);
    if (error || !data?.[0]) return ERR.server();
    return created(data[0]);
  },
  { roles: ["ADMIN"], body: crearProducto },
);
