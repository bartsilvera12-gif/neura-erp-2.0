/**
 * Anular una transferencia APROBADA (ADMIN). POST /api/cobranzas/conciliacion/[id]/anular { motivo }
 *   Anula el cobro que nació al aprobarla → la deuda de la factura vuelve. Queda auditado
 *   (quién, cuándo y por qué).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { falloRpc, idTras } from "@/modules/cobranzas/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idTras(req, "conciliacion");
    if (!id) return ERR.invalid("Falta el id de la transferencia");
    const { data, error } = await ctx.db.rpc("anular_cobro_pendiente", { p_id: id, p_motivo: input.motivo });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { permiso: "aprobar_transferencias", body: z.object({ motivo: z.string().trim().min(1, "Escribí el motivo de la anulación").max(500) }) },
);
