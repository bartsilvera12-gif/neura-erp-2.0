/**
 * Emitir de una vez las cuotas de un mes (botón "Emitir cuotas del mes", con confirmación).
 *   POST /api/suscripciones/emitir-mes  { periodo: "YYYY-MM" }
 *        → { periodo, emitidas, total, errores: [{ cliente, error }] }
 * Solo las activas a las que les corresponde ese mes y todavía no la tienen. Solo administrador.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { errorDb, periodoDe } from "@/modules/clientes/suscripciones/server";

const cuerpo = z.object({ periodo: z.string().min(7, "Falta el mes") });

export const POST = withTenant(
  async (ctx, _req, input) => {
    const periodo = periodoDe(input.periodo);
    if (!periodo) return ERR.invalid("Mes inválido");
    const { data, error } = await ctx.db.rpc("emitir_cuotas_mes", { p_periodo: periodo });
    if (error) return errorDb(error, "No se pudieron emitir las cuotas");
    return ok(data);
  },
  { roles: ["ADMIN"], body: cuerpo },
);
