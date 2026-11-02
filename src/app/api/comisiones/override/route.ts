/**
 * Excluir o incluir a mano un pago en la comisión de un mes (receta 115). Solo Administrador.
 *   POST   { periodo_ym, pago_id, factura_id?, decision, motivo }
 *   DELETE ?periodo_ym=&pago_id= → vuelve a la marca de la venta o a la regla automática
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ERR, noContent, ok } from "@/lib/api/responses";
import { errorDb } from "@/modules/clientes/suscripciones/server";

const PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/;

const cuerpo = z.object({
  periodo_ym: z.string().regex(PERIODO, "Mes inválido"),
  pago_id: z.string().uuid(),
  factura_id: z.string().uuid().nullish(),
  decision: z.enum(["incluir", "excluir"]),
  motivo: z.string().trim().min(1, "El motivo es obligatorio").max(500),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { error } = await ctx.db.rpc("comision_override_guardar", {
      p_periodo: input.periodo_ym, p_pago: input.pago_id, p_venta: input.factura_id ?? null, p_decision: input.decision, p_motivo: input.motivo,
    });
    if (error) return errorDb(error, "No se pudo guardar");
    return ok({ ok: true });
  },
  { roles: ["ADMIN"], body: cuerpo },
);

export const DELETE = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    const periodo = sp.get("periodo_ym") ?? "";
    const pago = z.string().uuid().safeParse(sp.get("pago_id"));
    if (!PERIODO.test(periodo) || !pago.success) return ERR.invalid("Faltan el mes o el pago");
    const { error } = await ctx.db.rpc("comision_override_quitar", { p_periodo: periodo, p_pago: pago.data });
    if (error) return errorDb(error, "No se pudo quitar");
    return noContent();
  },
  { roles: ["ADMIN"] },
);
