/**
 * Varios productos en un solo request (evita N llamadas a /api/productos/[id]).
 *   GET /api/productos/lote?ids=a,b,c
 *       → { productos: [...] } con el mismo detalle que /api/productos/[id]
 *         (los ids que no existen simplemente no vienen)
 *   GET /api/productos/lote?ids=a,b,c&costos=1[&costos_limite=1]
 *       → además { costos: { [id]: lo mismo que /api/productos/[id]/costos | null } }
 *         costos_limite = cuántas compras de cada uno (1..500; por defecto 100)
 * Hasta 200 ids por request.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { costosPorIds, LOTE_MAX_IDS, productosPorIds } from "@/modules/inventario/server/productos-lote";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const ids = [...new Set((sp.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.some((id) => !UUID.test(id))) return ERR.invalid("Hay un id de producto inválido");
  if (ids.length > LOTE_MAX_IDS) return ERR.invalid(`Máximo ${LOTE_MAX_IDS} productos por consulta`);
  const conCostos = sp.get("costos") === "1";
  const lim = Number(sp.get("costos_limite"));
  const limite = Number.isFinite(lim) && lim >= 1 ? Math.min(Math.floor(lim), 500) : undefined;

  try {
    const [productos, costos] = await Promise.all([
      productosPorIds(ctx.db, ids),
      conCostos ? costosPorIds(ctx.db, ids, limite) : Promise.resolve(undefined),
    ]);
    return ok(conCostos ? { productos, costos } : { productos });
  } catch {
    return ERR.server();
  }
});
