/**
 * Órdenes de compra (Fase 3, portado de Ferretería República).
 *   GET  /api/ordenes-compra?pagina&por_pagina&q&estado&proveedor → { rows, total }
 *        estado "abiertas" = pendientes + recibidas en parte. q = búsqueda inteligente.
 *   POST /api/ordenes-compra → crea la orden (ADMIN). No mueve stock.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";
import { condicionGrupo, variantesBusqueda } from "@/lib/api/busqueda-servidor";
import { COLS_OC, cuerpoOrden } from "@/modules/compras/ordenes";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const porPagina = Math.min(200, Math.max(10, Number(sp.get("por_pagina")) || 25));
  const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
  const estado = sp.get("estado") ?? "";
  const proveedor = sp.get("proveedor") ?? "";
  const grupos = await variantesBusqueda(ctx.db, sp.get("q"));

  let query = ctx.db.select("ordenes_compra", `${COLS_OC}, ordenes_compra_items(cantidad, cantidad_recibida)`, { count: "exact" });
  if (estado === "abiertas") query = query.in("estado", ["pendiente", "recibida_parcial"]);
  else if (["pendiente", "recibida_parcial", "recibida_total", "cancelada"].includes(estado)) query = query.eq("estado", estado);
  if (/^[0-9a-f-]{36}$/i.test(proveedor)) query = query.eq("proveedor_id", proveedor);
  for (const g of grupos) query = query.or(condicionGrupo(g));

  const desde = (pagina - 1) * porPagina;
  const res = await query.order("fecha", { ascending: false }).order("id", { ascending: false }).range(desde, desde + porPagina - 1);
  if (res.error && (res.error as { code?: string }).code !== "PGRST103") return ERR.server();
  type Fila = Record<string, unknown> & { ordenes_compra_items?: { cantidad: number; cantidad_recibida: number }[] };
  const rows = ((res.data ?? []) as unknown as Fila[]).map(({ ordenes_compra_items: it = [], ...o }) => ({
    ...o,
    cantidad_items: it.length,
    unidades: it.reduce((a, x) => a + Number(x.cantidad), 0),
    recibidas: it.reduce((a, x) => a + Math.min(Number(x.cantidad_recibida), Number(x.cantidad)), 0),
  }));
  return ok({ rows, total: res.count ?? 0 });
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc<{ id: string; numero_oc: string; total: number }>("guardar_orden_compra", { p: input });
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, ""), 400);
    return created(data);
  },
  { roles: ["ADMIN"], body: cuerpoOrden },
);
