/**
 * Movimientos de inventario (kardex) — listado paginado en el servidor.
 *   GET /api/inventario/movimientos?pagina&por_pagina&q&tipo&origen&desde&hasta&producto
 *     → { rows, total, producto? }  (producto: nombre/SKU cuando se filtra por uno)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";
import { consultaMovimientos, filtrosDeUrl, listarMovimientosRpc } from "@/modules/inventario/server/movimientos";
import { variantesBusqueda } from "@/lib/api/busqueda-servidor";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const porPagina = Math.min(200, Math.max(10, Number(sp.get("por_pagina")) || 25));
  const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
  const f = filtrosDeUrl(sp);
  const desde = (pagina - 1) * porPagina;

  // Página + total en UNA llamada (listar_movimientos), en paralelo con el producto del
  // historial. Si la receta 47 no está aplicada, la consulta anterior (2 viajes con búsqueda).
  const [rpc, prod] = await Promise.all([
    listarMovimientosRpc(ctx.db, f, { limit: porPagina, offset: desde }).catch(() => "error" as const),
    /^[0-9a-f-]{36}$/i.test(f.producto)
      ? ctx.db.select("productos", "id, nombre, sku, stock_actual, unidad_medida").eq("id", f.producto).limit(1)
      : Promise.resolve(null),
  ]);
  if (rpc === "error") return ERR.server();
  const producto = prod?.data?.[0] ?? null;
  if (rpc) return ok({ rows: rpc.rows, total: rpc.total, producto });

  const res = await consultaMovimientos(ctx.db, f, { count: "exact" }, await variantesBusqueda(ctx.db, f.q)).range(desde, desde + porPagina - 1);
  if (res.error && (res.error as { code?: string }).code !== "PGRST103") return ERR.server();
  return ok({ rows: res.data ?? [], total: res.count ?? 0, producto });
});

const nuevo = z.object({
  producto_id: z.string().uuid("Elegí un producto"),
  tipo: z.enum(["ENTRADA", "SALIDA", "AJUSTE"]),
  cantidad: z.coerce.number().min(0, "Cantidad inválida"),
  costo_unitario: z.coerce.number().min(0).default(0),
  origen: z.enum(["compra", "ajuste_manual"]),
  referencia: z.string().trim().max(150).nullish(),
  proveedor: z.string().trim().max(120).nullish(),
  proveedor_id: z.string().uuid().nullish(),
  numero_factura: z.string().trim().max(60).nullish(),
  /** productos con lotes: lote (vacío → L-YYMMDD) y vencimiento de lo que entra */
  lote: z.string().trim().max(40, "El número de lote es muy largo").nullish(),
  vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Vencimiento inválido").nullish().or(z.literal("")),
});

/**
 * POST /api/inventario/movimientos — movimiento MANUAL (ADMIN): entrada, salida o ajuste por
 * conteo. Stock + kardex atómicos en la RPC registrar_movimiento_lotes (envoltorio de
 * registrar_movimiento_stock: un producto sin lotes va directo a la original; con lotes,
 * lo que entra va a su lote y lo que sale se descuenta FEFO).
 */
export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("registrar_movimiento_lotes", {
      p_lote: input.lote || null,
      p_vencimiento: input.vencimiento || null,
      p_producto_id: input.producto_id,
      p_tipo: input.tipo,
      p_cantidad: input.cantidad,
      p_costo_unitario: input.costo_unitario,
      p_origen: input.origen,
      p_referencia: input.referencia ?? "",
      p_proveedor: input.proveedor ?? null,
      p_numero_factura: input.numero_factura ?? null,
      p_proveedor_id: input.proveedor_id ?? null,
    });
    // Los mensajes de la función (stock insuficiente, no controla stock…) son para el usuario.
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, ""), 400);
    return created(data);
  },
  { roles: ["ADMIN"], body: nuevo },
);
