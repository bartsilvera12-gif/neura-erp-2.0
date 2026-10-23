/**
 * Mesas por cobrar (receta 69): las cuentas que se enviaron a caja, de la sucursal de la caja
 * abierta elegida. Lo usa Caja › Nueva venta (polling cada ~4 s).
 *   GET /api/mesas/por-cobrar?caja=<turno id> → { ahora, caja_id, cuentas[] }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";
import { UUID_RE } from "@/modules/inventario/server/ids";
import { ROLES_CAJA } from "@/modules/caja/lib";

export const GET = withTenant(
  async (ctx, req) => {
    const caja = new URL(req.url).searchParams.get("caja");
    const { data, error } = await ctx.db.rpc("mesas_por_cobrar", { p_caja_id: caja && UUID_RE.test(caja) ? caja : null });
    if (error) return falloRpc(error);
    if (!data) return ERR.server();
    return ok(data, { headers: { "Cache-Control": "no-store" } });
  },
  { roles: ROLES_CAJA },
);
