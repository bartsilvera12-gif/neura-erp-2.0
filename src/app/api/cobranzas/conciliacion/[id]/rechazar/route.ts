/**
 * Rechazar una transferencia pendiente (ADMIN). POST /api/cobranzas/conciliacion/[id]/rechazar { motivo }
 *   Solo cambia el estado (la deuda nunca se tocó) y borra el aviso de la campanita.
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
    const { data, error } = await ctx.db.rpc("rechazar_cobro_pendiente", { p_id: id, p_motivo: input.motivo });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { permiso: "aprobar_transferencias", body: z.object({ motivo: z.string().trim().min(1, "Escribí el motivo del rechazo").max(500) }) },
);
