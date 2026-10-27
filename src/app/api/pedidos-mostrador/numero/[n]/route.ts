/**
 * Pedido de mostrador por número (receta 77): lo usa Caja › Nueva venta cuando el cajero escanea
 * o escribe "P-0042" y el pedido todavía no llegó a la bandeja. Devuelve el pedido si se puede
 * cobrar en esa caja, o un mensaje claro (ya cobrado, anulado, vencido, de otra sucursal…).
 *   GET /api/pedidos-mostrador/numero/<n>?caja=<turno id>
 */
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok, ERR } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";
import { UUID_RE, idDeRuta } from "@/modules/inventario/server/ids";
import { ROLES_CAJA } from "@/modules/caja/lib";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const n = Number(idDeRuta(req.url, "numero"));
    if (!Number.isInteger(n) || n < 1 || n > 9_999_999) return fail("Número de pedido inválido", 400);
    const caja = new URL(req.url).searchParams.get("caja");
    const { data, error } = await ctx.db.rpc("pedido_mostrador_por_numero", { p_numero: n, p_caja_id: caja && UUID_RE.test(caja) ? caja : null });
    if (error) return falloRpc(error);
    if (!data) return ERR.server();
    return ok(data, { headers: { "Cache-Control": "no-store" } });
  },
  { roles: ROLES_CAJA },
);
