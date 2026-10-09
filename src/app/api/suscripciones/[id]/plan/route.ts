/**
 * Cambio de plan de una suscripción.
 *   POST /api/suscripciones/[id]/plan  { plan_id, modo, precio? }
 *   modo: proximo_mes (desde el 1° del mes que viene) | inmediato (si la cuota de este mes
 *         todavía no se emitió) | actualizar_cuota_pendiente (rehace la cuota de este mes
 *         si todavía no tiene cobros)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { errorDb, idDeRuta } from "@/modules/clientes/suscripciones/server";

const cuerpo = z.object({
  plan_id: z.string().uuid("Elegí el plan nuevo"),
  modo: z.enum(["inmediato", "proximo_mes", "actualizar_cuota_pendiente"], { message: "Elegí cuándo aplica el cambio" }),
  precio: z.coerce.number().min(0, "El precio no puede ser negativo").optional().nullable(),
});

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req, "suscripciones");
    if (!id) return ERR.invalid("Falta el id de la suscripción");
    const { data, error } = await ctx.db.rpc("cambiar_plan_suscripcion", {
      p_suscripcion: id,
      p_plan: input.plan_id,
      p_modo: input.modo,
      p_precio: input.precio ?? null,
    });
    if (error) return errorDb(error, "No se pudo cambiar el plan");
    return ok(data);
  },
  { roles: ["ADMIN", "VENDEDOR"], body: cuerpo },
);
