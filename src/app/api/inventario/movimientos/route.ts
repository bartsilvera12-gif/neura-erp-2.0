/**
 * Movimientos de inventario (kardex) — listado paginado en el servidor.
 *   GET /api/inventario/movimientos?pagina&por_pagina&q&tipo&origen&desde&hasta&producto
 *     → { rows, total, producto? }  (producto: nombre/SKU cuando se filtra por uno)
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { consultaMovimientos, filtrosDeUrl } from "@/modules/inventario/server/movimientos";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const porPagina = Math.min(200, Math.max(10, Number(sp.get("por_pagina")) || 25));
  const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
  const f = filtrosDeUrl(sp);
  const desde = (pagina - 1) * porPagina;

  const [res, prod] = await Promise.all([
    consultaMovimientos(ctx.db, f, { count: "exact" }).range(desde, desde + porPagina - 1),
    /^[0-9a-f-]{36}$/i.test(f.producto)
      ? ctx.db.select("productos", "id, nombre, sku, stock_actual, unidad_medida").eq("id", f.producto).limit(1)
      : Promise.resolve(null),
  ]);
  if (res.error && (res.error as { code?: string }).code !== "PGRST103") return ERR.server();
  return ok({ rows: res.data ?? [], total: res.count ?? 0, producto: prod?.data?.[0] ?? null });
});
