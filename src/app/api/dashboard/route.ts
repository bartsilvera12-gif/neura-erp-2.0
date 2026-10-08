/**
 * Inicio (dashboard) — solo los números de las tarjetas, sin bajar listas.
 *   GET /api/dashboard → { caja, productos, sin_stock, clientes }
 *     caja      → la caja abierta (o null), igual que GET /api/caja
 *     productos → vendibles y activos (lo mismo que lista GET /api/productos)
 *     sin_stock → de esos, los que controlan stock y están en 0 o menos
 *     clientes  → clientes sin borrar
 * Antes la pantalla bajaba el catálogo entero y 500 clientes para mostrar un .length.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx) => {
  const [caja, productos, sinStock, clientes] = await Promise.all([
    ctx.db
      .select("cajas", "numero_caja, monto_apertura")
      .eq("estado", "abierta")
      .order("fecha_apertura", { ascending: false })
      .limit(1),
    ctx.db.select("productos", "id", { count: "exact", head: true }).eq("activo", true).eq("es_vendible", true),
    ctx.db
      .select("productos", "id", { count: "exact", head: true })
      .eq("activo", true)
      .eq("es_vendible", true)
      .eq("controla_stock", true)
      .lte("stock_actual", 0),
    ctx.db.select("clientes", "id", { count: "exact", head: true }).is("deleted_at", null),
  ]);
  if (caja.error || productos.error || sinStock.error || clientes.error) return ERR.server();
  return ok({
    caja: caja.data?.[0] ?? null,
    productos: productos.count ?? 0,
    sin_stock: sinStock.count ?? 0,
    clientes: clientes.count ?? 0,
  });
});
