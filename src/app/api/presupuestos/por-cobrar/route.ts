/**
 * Presupuestos por cobrar: los presupuestos "aceptados" (que el vendedor envió a la caja),
 * para la bandeja de Caja › Nueva venta. El cajero toca uno y lo cobra (?presupuesto=<id>).
 * El nivel Vendedor recibe la lista vacía (arma y envía, no cobra).
 *   GET /api/presupuestos/por-cobrar → { ahora, presupuestos[] }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";
import { ROLES_CAJA } from "@/modules/caja/lib";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx) => {
    const { data, error } = await ctx.db.rpc("presupuestos_por_cobrar", {});
    if (error) return falloRpc(error);
    if (!data) return ERR.server();
    return ok(data, { headers: { "Cache-Control": "no-store" } });
  },
  { roles: ROLES_CAJA },
);
