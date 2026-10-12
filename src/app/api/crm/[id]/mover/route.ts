/**
 * Mover un prospecto de etapa (drag & drop del tablero, selector de la tarjeta o del detalle).
 *   POST /api/crm/[id]/mover { etapa, motivo? } → { id, etapa, updated_at?, sin_cambios? }
 *   crm_mover deja la nota "Lead → Contactado". Pasar a una etapa de pérdida exige motivo.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { errorCrm, idProspecto } from "@/modules/crm/server";

export const dynamic = "force-dynamic";

const mover = z.object({
  etapa: z.string().trim().min(1, "Falta la etapa").max(40),
  motivo: z.string().trim().max(500).optional().nullable(),
});

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idProspecto(req);
    if (!id) return ERR.notFound("Prospecto");
    const { data, error } = await ctx.db.rpc("crm_mover", { p_prospecto: id, p_etapa: input.etapa, p_motivo: input.motivo || null });
    if (error) return errorCrm(error, "No se pudo mover el prospecto");
    return ok(data);
  },
  { body: mover },
);
