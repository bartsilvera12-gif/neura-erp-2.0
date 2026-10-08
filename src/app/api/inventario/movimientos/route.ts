/**
 * Movimientos de inventario (kardex) — listado paginado en el servidor.
 *   GET /api/inventario/movimientos?pagina&por_pagina&q&tipo&origen&desde&hasta&producto
 *     → { rows, total, producto? }  (producto: nombre/SKU cuando se filtra por uno)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";
import { consultaMovimientos, filtrosDeUrl } from "@/modules/inventario/server/movimientos";
import { variantesBusqueda } from "@/lib/api/busqueda-servidor";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const porPagina = Math.min(200, Math.max(10, Number(sp.get("por_pagina")) || 25));
  const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
  const f = filtrosDeUrl(sp);
  const desde = (pagina - 1) * porPagina;

  const [res, prod] = await Promise.all([
    consultaMovimientos(ctx.db, f, { count: "exact" }, await variantesBusqueda(ctx.db, f.q)).range(desde, desde + porPagina - 1),
    /^[0-9a-f-]{36}$/i.test(f.producto)
      ? ctx.db.select("productos", "id, nombre, sku, stock_actual, unidad_medida").eq("id", f.producto).limit(1)
      : Promise.resolve(null),
  ]);
  if (res.error && (res.error as { code?: string }).code !== "PGRST103") return ERR.server();
  return ok({ rows: res.data ?? [], total: res.count ?? 0, producto: prod?.data?.[0] ?? null });
});

const nuevo = z.object({
  producto_id: z.string().uuid("Elegí un producto"),
  tipo: z.enum(["ENTRADA", "SALIDA", "AJUSTE"]),
  cantidad: z.coerce.number().min(0, "Cantidad inválida"),
  costo_unitario: z.coerce.number().min(0).default(0),
  origen: z.enum(["compra", "ajuste_manual"]),
  referencia: z.string().trim().max(150).nullish(),
  proveedor: z.string().trim().max(120).nullish(),
  numero_factura: z.string().trim().max(60).nullish(),
});

/**
 * POST /api/inventario/movimientos — movimiento MANUAL (ADMIN): entrada, salida o ajuste por
 * conteo. Stock + kardex atómicos en la RPC registrar_movimiento_stock.
 */
export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("registrar_movimiento_stock", {
      p_producto_id: input.producto_id,
      p_tipo: input.tipo,
      p_cantidad: input.cantidad,
      p_costo_unitario: input.costo_unitario,
      p_origen: input.origen,
      p_referencia: input.referencia ?? "",
      p_proveedor: input.proveedor ?? null,
      p_numero_factura: input.numero_factura ?? null,
    });
    // Los mensajes de la función (stock insuficiente, no controla stock…) son para el usuario.
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, ""), 400);
    return created(data);
  },
  { roles: ["ADMIN"], body: nuevo },
);
