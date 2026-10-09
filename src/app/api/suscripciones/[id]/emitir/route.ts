/**
 * Emitir la cuota de un mes de una suscripción (botón "Emitir cuota").
 *   POST /api/suscripciones/[id]/emitir  { periodo: "YYYY-MM" }
 *        → { venta_id, numero_control, total, vencimiento }
 * Nace una venta a crédito con su cuenta a cobrar (vence el día elegido de ese mes).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, ERR } from "@/lib/api/responses";
import { errorDb, idDeRuta, periodoDe } from "@/modules/clientes/suscripciones/server";

const cuerpo = z.object({ periodo: z.string().min(7, "Falta el mes") });

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req, "suscripciones");
    if (!id) return ERR.invalid("Falta el id de la suscripción");
    const periodo = periodoDe(input.periodo);
    if (!periodo) return ERR.invalid("Mes inválido");
    const { data, error } = await ctx.db.rpc("emitir_cuota_suscripcion", { p_suscripcion: id, p_periodo: periodo });
    if (error) return errorDb(error, "No se pudo emitir la cuota");
    return created(data);
  },
  { roles: ["ADMIN", "VENDEDOR"], body: cuerpo },
);
