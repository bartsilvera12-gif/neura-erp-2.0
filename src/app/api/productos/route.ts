/**
 * Productos — catálogo que vende la caja y que gestiona Inventario.
 *   GET  /api/productos                → vendibles y activos (POS) — lista completa
 *   GET  /api/productos?scope=inventario → todos los activos — lista completa
 *   GET  /api/productos?paginado=1&pagina&por_pagina&q&categoria&inactivos=1
 *        → { rows, total } paginado EN EL SERVIDOR (pantalla de Inventario). Con q, búsqueda
 *          inteligente (buscar_productos: sin tildes, cualquier orden, errores de tipeo,
 *          SKU/código de barras exacto primero, ordenado por relevancia).
 *   POST /api/productos                → alta (ADMIN); si arranca con stock, queda en el kardex
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";
import { registrarMovimiento } from "@/modules/inventario/server/kardex";

const COLS =
  "id, nombre, sku, codigo_barras, categoria_principal_id, proveedor_principal_id, costo_promedio, precio_venta, precio_mayorista, precio_distribuidor, descuento_pct, stock_actual, stock_minimo, unidad_medida, tipo_iva, tipo_producto, controla_stock, es_vendible, activo, imagen_url";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;

  if (sp.get("paginado") === "1") {
    const porPagina = Math.min(200, Math.max(10, Number(sp.get("por_pagina")) || 25));
    const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
    const q = (sp.get("q") ?? "").trim().slice(0, 200);
    const categoria = sp.get("categoria") ?? "";
    const desde = (pagina - 1) * porPagina;

    if (q) {
      const { data, error } = await ctx.db.rpc<{ rows: unknown[]; total: number }>("buscar_productos", {
        p_q: q,
        p_categoria: categoria === "__sin__" || /^[0-9a-f-]{36}$/i.test(categoria) ? categoria : null,
        p_inactivos: sp.get("inactivos") === "1",
        p_solo_vendibles: sp.get("vendibles") === "1",
        p_limit: porPagina,
        p_offset: desde,
      });
      if (error || !data) return ERR.server();
      return ok({ rows: data.rows ?? [], total: data.total ?? 0 });
    }

    let query = ctx.db.select("productos", COLS, { count: "exact" });
    if (sp.get("inactivos") !== "1") query = query.eq("activo", true);
    if (categoria === "__sin__") query = query.is("categoria_principal_id", null);
    else if (/^[0-9a-f-]{36}$/i.test(categoria)) {
      // Una categoría incluye a los productos de sus subcategorías.
      const { data: hijas } = await ctx.db.select("categorias_productos", "id").eq("parent_id", categoria);
      query = query.in("categoria_principal_id", [categoria, ...((hijas ?? []) as unknown as { id: string }[]).map((h) => h.id)]);
    }
    const { data, error, count } = await query
      .order("nombre", { ascending: true })
      .order("id", { ascending: true })
      .range(desde, desde + porPagina - 1);
    if (error && (error as { code?: string }).code !== "PGRST103") return ERR.server();
    return ok({ rows: data ?? [], total: count ?? 0 });
  }

  // scope=inventario → todos los activos; por defecto → solo vendibles (lo que ofrece la caja/POS).
  let query = ctx.db.select("productos", COLS).eq("activo", true);
  if (sp.get("scope") !== "inventario") query = query.eq("es_vendible", true);
  const { data, error } = await query.order("nombre", { ascending: true });
  if (error) return ERR.server();
  return ok(data ?? []);
});

const crearProducto = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio"),
  sku: z.string().trim().min(1, "El SKU es obligatorio"),
  codigo_barras: z.string().trim().max(60).nullish(),
  categoria_principal_id: z.string().uuid().nullish(),
  proveedor_principal_id: z.string().uuid().nullish(),
  costo_promedio: z.coerce.number().min(0).default(0),
  precio_venta: z.coerce.number().min(0).default(0),
  precio_mayorista: z.coerce.number().min(0).nullish(),
  precio_distribuidor: z.coerce.number().min(0).nullish(),
  descuento_pct: z.coerce.number().min(0).max(100).default(0),
  stock_actual: z.coerce.number().default(0),
  stock_minimo: z.coerce.number().min(0).default(0),
  unidad_medida: z.string().trim().default("Unidad"),
  tipo_iva: z.enum(["EXENTA", "5%", "10%"]).default("10%"),
  controla_stock: z.boolean().default(true),
  es_vendible: z.boolean().default(true),
  imagen_url: z.string().url().max(500).nullish(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.insert("productos", { ...input, codigo_barras: input.codigo_barras || null });
    if (error || !data?.[0]) {
      if (error && /duplicate|unique/i.test(error.message)) return fail("Ya existe un producto con ese SKU o código.", 409);
      return ERR.server();
    }
    const p = data[0] as { id: string; nombre: string; sku: string };
    const stock = input.stock_actual ?? 0;
    if (stock > 0) {
      await registrarMovimiento(ctx, {
        producto_id: p.id, producto_nombre: p.nombre, producto_sku: p.sku,
        delta: stock, costo_unitario: input.costo_promedio ?? 0,
        origen: "inventario_inicial", referencia: "Alta de producto",
      });
    }
    return created(p);
  },
  { roles: ["ADMIN"], body: crearProducto },
);
