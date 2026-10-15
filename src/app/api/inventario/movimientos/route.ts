/**
 * Movimientos de inventario (kardex) — listado paginado en el servidor. Solo lectura: cada
 * movimiento nace de un documento (compra, venta, traslado, ajuste, pérdida, anulación).
 *   GET /api/inventario/movimientos?pagina&por_pagina&q&tipo&origen(a,b,…)&desde&hasta&producto&deposito&sucursal
 *     → { rows, total, producto? }  (producto: nombre/SKU/stock cuando se filtra por uno;
 *        con producto, cada fila trae el saldo después del movimiento)
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { consultaMovimientos, filtrosDeUrl, listarMovimientosRpc } from "@/modules/inventario/server/movimientos";
import { variantesBusqueda } from "@/lib/api/busqueda-servidor";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const porPagina = Math.min(200, Math.max(10, Number(sp.get("por_pagina")) || 25));
  const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
  const f = filtrosDeUrl(sp);
  const desde = (pagina - 1) * porPagina;

  // Página + total en UNA llamada (listar_movimientos), en paralelo con el producto del historial.
  const conProducto = /^[0-9a-f-]{36}$/i.test(f.producto);
  const [rpc, prod, enDep] = await Promise.all([
    listarMovimientosRpc(ctx.db, f, { limit: porPagina, offset: desde }).catch(() => "error" as const),
    conProducto
      ? ctx.db.select("productos", "id, nombre, sku, stock_actual, unidad_medida").eq("id", f.producto).limit(1)
      : Promise.resolve(null),
    // Kardex de un producto en UN depósito: su stock ahí.
    conProducto && /^[0-9a-f-]{36}$/i.test(f.deposito)
      ? ctx.db.select("stock_depositos", "cantidad").eq("producto_id", f.producto).eq("deposito_id", f.deposito).limit(1)
      : Promise.resolve(null),
  ]);
  if (rpc === "error") return ERR.server();
  const p0 = (prod?.data?.[0] ?? null) as Record<string, unknown> | null;
  const producto = p0 && enDep ? { ...p0, stock_deposito: Number((enDep.data?.[0] as { cantidad?: number } | undefined)?.cantidad ?? 0) } : p0;
  if (rpc) return ok({ rows: rpc.rows, total: rpc.total, producto });

  const res = await consultaMovimientos(ctx.db, f, { count: "exact" }, await variantesBusqueda(ctx.db, f.q)).range(desde, desde + porPagina - 1);
  if (res.error && (res.error as { code?: string }).code !== "PGRST103") return ERR.server();
  return ok({ rows: res.data ?? [], total: res.count ?? 0, producto });
});
