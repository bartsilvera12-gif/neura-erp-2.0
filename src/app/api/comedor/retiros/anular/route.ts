/** Comedor — anular un retiro (devuelve stock y libera subsidio, auditado). POST /api/comedor/retiros/anular */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";

const anular = z.object({ consumo_id: z.string().uuid(), motivo: z.string().trim().max(300).optional() });

export const POST = withTenant(
  async (ctx, _req, input) => {
    const r = await ctx.db.rpc("comedor_retiro_anular", { p_consumo: input.consumo_id, p_motivo: input.motivo ?? null });
    if (r.error) return ERR.server();
    return ok(r.data);
  },
  { permiso: "comedor_recepcion", body: anular },
);
