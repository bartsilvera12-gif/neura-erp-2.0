/**
 * Aprobar una transferencia (ADMIN). POST /api/cobranzas/conciliacion/[id]/aprobar
 *   → { id, cobro_id, numero_recibo, saldo_restante }
 *   Atómico en la base: bloquea la transferencia y la factura, exige que siga pendiente y
 *   que el monto no supere el saldo, y crea el COBRO real (transferencia, sin caja) aplicado
 *   a esa factura. Las promesas pendientes del cliente se cumplen y se borra el aviso.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { falloRpc, idTras } from "@/modules/cobranzas/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withTenant(
  async (ctx, req) => {
    const id = idTras(req, "conciliacion");
    if (!id) return ERR.invalid("Falta el id de la transferencia");
    const { data, error } = await ctx.db.rpc("aprobar_cobro_pendiente", { p_id: id });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { permiso: "aprobar_transferencias" },
);
