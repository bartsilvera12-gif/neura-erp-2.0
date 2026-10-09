/**
 * Cambio de fecha de vencimiento de una suscripción (botón "Cambio fecha venc." de Gestión).
 *   POST /api/suscripciones/[id]/vencimiento  { dia, mover_cuota_mes? } → { ok, cuota_movida }
 * Rige para las cuotas que se emitan desde ahora; con mover_cuota_mes también mueve la
 * cuota del mes en curso si está emitida y sin cobros. El día no puede ser antes del de facturación.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { errorDb, idDeRuta } from "@/modules/clientes/suscripciones/server";

const cuerpo = z.object({
  dia: z.coerce.number().int("El día tiene que ser un número entero").min(1, "El día de vencimiento va de 1 a 31").max(31, "El día de vencimiento va de 1 a 31"),
  mover_cuota_mes: z.boolean().optional().default(false),
});

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req, "suscripciones");
    if (!id) return ERR.invalid("Falta el id de la suscripción");
    const { data, error } = await ctx.db.rpc("cambiar_vencimiento_suscripcion", {
      p_suscripcion: id,
      p_dia: input.dia,
      p_mover_cuota_mes: input.mover_cuota_mes,
    });
    if (error) return errorDb(error, "No se pudo cambiar el vencimiento");
    return ok(data ?? { ok: true, cuota_movida: false });
  },
  { roles: ["ADMIN", "VENDEDOR"], body: cuerpo },
);
