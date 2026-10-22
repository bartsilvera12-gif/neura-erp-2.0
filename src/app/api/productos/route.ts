/**
 * Productos — catálogo que vende la caja y que gestiona Inventario.
 *   GET  /api/productos                → vendibles y activos — columnas completas (tope 1000)
 *   GET  /api/productos?pos=1[&campos=nombre] → catálogo liviano de la caja, completo (una llamada).
 *        Productos con lotes vencidos traen stock_vencido (aviso no bloqueante de la caja).
 *   GET  /api/productos?scope=inventario → todos los activos — lista completa
 *   GET  /api/productos?paginado=1&pagina&por_pagina&q&categoria&inactivos=1
 *        → { rows, total } paginado EN EL SERVIDOR (pantalla de Inventario). Con q, búsqueda
 *          inteligente (buscar_productos: sin tildes, cualquier orden, errores de tipeo,
 *          SKU/código de barras exacto primero, ordenado por relevancia).
 *          OJO: q / pagina / por_pagina solo valen CON paginado=1 (sin él se ignoran y
 *          devuelve la lista de vendibles de arriba).
 *        Cada fila del paginado trae stock_depositos: [{ d: deposito_id, c: cantidad }] (los
 *        depósitos donde tiene unidades) para la columna/expansión por depósito.
 *   POST /api/productos                → alta (ADMIN). El stock NO se carga a mano: si viene
 *        stock_inicial { cantidad, deposito_id, lote?, vencimiento? } se registra como un
 *        AJUSTE de inventario inicial (AJ-) en ese depósito; si el ajuste falla, el alta se
 *        deshace (el producto recién creado no tiene historial).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import type { TenantDb } from "@/lib/api/tenant-db";
import { ok, created, fail, ERR } from "@/lib/api/responses";
import { faltaFuncion } from "@/modules/inventario/server/ids";
import { falloRpc } from "@/modules/inventario/server/rpc";

/** Agrega a cada fila sus cantidades por depósito (una consulta para toda la página). */
async function conStockPorDeposito(db: TenantDb, rows: Record<string, unknown>[]) {
  const ids = rows.map((r) => r.id as string).filter(Boolean);
  if (!ids.length) return rows;
  const { data, error } = await db.select("stock_depositos", "producto_id, deposito_id, cantidad").in("producto_id", ids).neq("cantidad", 0);
  if (error) return rows; // la lista igual se muestra (sin el detalle por depósito)
  const por = new Map<string, { d: string; c: number }[]>();
  for (const s of (data ?? []) as unknown as { producto_id: string; deposito_id: string; cantidad: number }[]) {
    const l = por.get(s.producto_id) ?? [];
    l.push({ d: s.deposito_id, c: Number(s.cantidad) });
    por.set(s.producto_id, l);
  }
  return rows.map((r) => ({ ...r, stock_depositos: por.get(r.id as string) ?? [] }));
}

const COLS =
  "id, nombre, sku, codigo_barras, categoria_principal_id, proveedor_principal_id, costo_promedio, precio_venta, precio_mayorista, precio_distribuidor, descuento_pct, stock_actual, stock_minimo, unidad_medida, tipo_iva, tipo_producto, controla_stock, controla_lotes, es_vendible, activo, imagen_url";
// Lo que lee la caja (POS) de cada producto: ni costos, ni categoría, ni proveedor.
const COLS_POS =
  "id, nombre, sku, codigo_barras, precio_venta, precio_mayorista, precio_distribuidor, descuento_pct, stock_actual, unidad_medida, tipo_iva, controla_stock, imagen_url";
// Tope de filas por respuesta de PostgREST (max-rows).
const LOTE = 1000;

/** Perfil sin "ver costos y márgenes": los costos no salen del servidor. */
function sinCostos(puede: (p: string) => boolean, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  if (puede("ver_costos")) return rows;
  return rows.map((r) => {
    const x = { ...r };
    delete x.costo_promedio;
    delete x.costo_mayorista;
    return x;
  });
}

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
      return ok({ rows: sinCostos(ctx.puede, await conStockPorDeposito(ctx.db, (data.rows ?? []) as Record<string, unknown>[])), total: data.total ?? 0 });
    }

    // Una sola llamada (listar_productos_inventario, receta 47): página + total salen del
    // índice (empresa, nombre, id), y "categoría + subcategorías" ya no es un viaje previo.
    // Mismas columnas y orden que la consulta de abajo, que queda de respaldo si la receta
    // no está aplicada en este schema.
    const cat = categoria === "__sin__" || /^[0-9a-f-]{36}$/i.test(categoria) ? categoria : null;
    const rpc = await ctx.db.rpc<{ rows: unknown[]; total: number }>("listar_productos_inventario", {
      p_categoria: cat,
      p_inactivos: sp.get("inactivos") === "1",
      p_limit: porPagina,
      p_offset: desde,
    });
    if (!rpc.error && rpc.data) {
      return ok({ rows: sinCostos(ctx.puede, await conStockPorDeposito(ctx.db, (rpc.data.rows ?? []) as Record<string, unknown>[])), total: Number(rpc.data.total) || 0 });
    }
    if (!faltaFuncion(rpc.error)) return ERR.server();

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
    return ok({ rows: sinCostos(ctx.puede, await conStockPorDeposito(ctx.db, (data ?? []) as unknown as Record<string, unknown>[])), total: count ?? 0 });
  }

  // ?pos=1 → catálogo LIVIANO de la caja: solo vendibles activos, solo las columnas que usa
  // el POS (sin costos) y COMPLETO: PostgREST corta en 1000 filas, así que se pide de a
  // lotes (el primero trae el total; el resto en paralelo). &campos=nombre → solo nombres.
  if (sp.get("pos") === "1") {
    const soloNombre = sp.get("campos") === "nombre";
    // &deposito=<id> → el stock de ESE depósito (el de la caja abierta). Sin él, el de siempre.
    const depositoPos = /^[0-9a-f-]{36}$/i.test(sp.get("deposito") ?? "") ? sp.get("deposito") : null;
    // UNA llamada (productos_pos, receta 47) en vez de 1 + N lotes de 1000 con OFFSET
    // creciente: mismas columnas, mismo orden y el mismo aviso de vencidos. Lo de abajo
    // queda de respaldo si la receta no está aplicada en este schema.
    const rpc = await ctx.db.rpc<{ productos: Record<string, unknown>[]; vencidos: { producto_id: string; vencido: number }[] }>(
      "productos_pos", { p_solo_nombre: soloNombre, p_deposito: soloNombre ? null : depositoPos });
    if (!rpc.error && rpc.data) {
      const filas = rpc.data.productos ?? [];
      if (rpc.data.vencidos?.length) {
        const porId = new Map(rpc.data.vencidos.map((v) => [v.producto_id, Number(v.vencido) || 0]));
        for (const f of filas) {
          const v = porId.get(f.id as string);
          if (v) f.stock_vencido = v;
        }
      }
      return ok(filas);
    }
    if (!faltaFuncion(rpc.error)) return ERR.server();

    const cols = soloNombre ? "nombre" : COLS_POS;
    const lote = (desde: number, hasta: number, conTotal: boolean) =>
      ctx.db
        .select("productos", cols, conTotal ? { count: "exact" } : undefined)
        .eq("activo", true)
        .eq("es_vendible", true)
        .order("nombre", { ascending: true })
        .order("id", { ascending: true }) // orden estable entre lotes
        .range(desde, hasta);
    // Unidades en lotes vencidos, en paralelo con el primer lote (no agrega espera: solo
    // devuelve filas si hay lotes vencidos con stock).
    const [primero, vencidos] = await Promise.all([
      lote(0, LOTE - 1, true),
      cols === COLS_POS
        ? ctx.db.rpc<{ producto_id: string; vencido: number }[]>("lotes_stock_vencido")
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (primero.error) return ERR.server();
    const filas = (primero.data ?? []) as unknown as Record<string, unknown>[];
    const total = primero.count ?? filas.length;
    // El paso es lo que de verdad devolvió el servidor (por si su tope es menor a LOTE).
    const paso = filas.length;
    if (paso > 0 && total > paso) {
      const pedidos = [];
      for (let d = paso; d < total; d += paso) pedidos.push(lote(d, d + paso - 1, false));
      const resto = await Promise.all(pedidos);
      if (resto.some((r) => r.error)) return ERR.server();
      for (const r of resto) filas.push(...((r.data ?? []) as unknown as Record<string, unknown>[]));
    }
    // Si la consulta de vencidos falla, la caja sigue andando (solo no avisa).
    if (vencidos.data?.length) {
      const porId = new Map(vencidos.data.map((v) => [v.producto_id, Number(v.vencido) || 0]));
      for (const f of filas) {
        const v = porId.get(f.id as string);
        if (v) f.stock_vencido = v;
      }
    }
    return ok(filas);
  }

  // scope=inventario → todos los activos; por defecto → solo vendibles (lo que ofrece la caja/POS).
  let query = ctx.db.select("productos", COLS).eq("activo", true);
  if (sp.get("scope") !== "inventario") query = query.eq("es_vendible", true);
  const { data, error } = await query.order("nombre", { ascending: true });
  if (error) return ERR.server();
  return ok(sinCostos(ctx.puede, (data ?? []) as unknown as Record<string, unknown>[]));
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
  /** stock con el que arranca: queda como ajuste de inventario inicial en ese depósito */
  stock_inicial: z
    .object({
      cantidad: z.coerce.number().positive("El stock inicial tiene que ser mayor a 0"),
      deposito_id: z.string().uuid("Elegí el depósito del stock inicial"),
      lote: z.string().trim().max(40, "El número de lote es muy largo").nullish(),
      vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Vencimiento inválido").nullish().or(z.literal("")),
    })
    .nullish(),
  stock_minimo: z.coerce.number().min(0).default(0),
  unidad_medida: z.string().trim().default("Unidad"),
  tipo_iva: z.enum(["EXENTA", "5%", "10%"]).default("10%"),
  controla_stock: z.boolean().default(true),
  controla_lotes: z.boolean().default(false),
  es_vendible: z.boolean().default(true),
  /** receta 68: sale en el menú QR de las mesas */
  en_menu_qr: z.boolean().default(false),
  imagen_url: z.string().url().max(500).nullish(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { stock_inicial, ...campos } = input;
    if (stock_inicial && !campos.controla_stock) return fail("Un producto que no controla stock no lleva stock inicial.", 400);
    // Lotes solo tiene sentido si controla stock.
    const { data, error } = await ctx.db.insert("productos", {
      ...campos,
      codigo_barras: campos.codigo_barras || null,
      controla_lotes: campos.controla_stock && campos.controla_lotes,
    });
    if (error || !data?.[0]) {
      if (error && /duplicate|unique/i.test(error.message)) return fail("Ya existe un producto con ese SKU o código.", 409);
      return ERR.server();
    }
    const p = data[0] as { id: string; nombre: string; sku: string };
    if (!stock_inicial) return created(p);

    // Stock inicial = ajuste de inventario inicial (AJ-) en el depósito elegido.
    const aj = await ctx.db.rpc<{ id: string; numero: string }>("registrar_ajuste", {
      p: {
        tipo: "ajuste",
        deposito_id: stock_inicial.deposito_id,
        motivo: "inventario_inicial",
        detalle: `Alta de producto ${p.sku}`,
        items: [{
          producto_id: p.id,
          modo: "diferencia",
          cantidad: stock_inicial.cantidad,
          lote: stock_inicial.lote || null,
          vencimiento: stock_inicial.vencimiento || null,
          costo_unitario: campos.costo_promedio ?? 0,
        }],
      },
    });
    if (aj.error) {
      // El producto recién creado no tiene historial: se deshace el alta para no dejarlo a medias.
      await ctx.db.delete("productos").eq("id", p.id);
      return falloRpc(aj.error);
    }
    return created({ ...p, ajuste: aj.data });
  },
  { permiso: "editar_productos", body: crearProducto },
);
