/**
 * Pedidos por cobrar (receta 77): los pedidos de mostrador EN CAJA de hoy, de la sucursal de la
 * caja abierta elegida. Lo usa Caja › Nueva venta (polling cada ~4 s). El nivel Vendedor recibe la
 * lista vacía (arma pedidos, no los cobra).
 *   GET /api/pedidos-mostrador/por-cobrar?caja=<turno id> → { ahora, caja_id, pedidos[] }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";
import { UUID_RE } from "@/modules/inventario/server/ids";
import { ROLES_CAJA } from "@/modules/caja/lib";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const caja = new URL(req.url).searchParams.get("caja");
    const { data, error } = await ctx.db.rpc("pedidos_mostrador_por_cobrar", { p_caja_id: caja && UUID_RE.test(caja) ? caja : null });
    if (error) return falloRpc(error);
    if (!data) return ERR.server();
    return ok(data, { headers: { "Cache-Control": "no-store" } });
  },
  { roles: ROLES_CAJA },
);
