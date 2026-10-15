/**
 * POST /api/ventas/[id]/anular { motivo?, caja_id? } — anula la venta (devuelve el stock al
 * depósito de la venta + revierte el cobro). Transaccional, vía `anular_venta` (receta 51):
 *   · turno abierto: el cobro sale del arqueo de ese turno (como siempre)
 *   · turno CERRADO: solo ADMIN o SUPERVISOR y con motivo; el turno cerrado no se toca y el
 *     efectivo que se devuelve sale de una caja abierta (`caja_id` o la del usuario)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";

const cuerpo = z
  .object({
    motivo: z.string().trim().max(500).nullish(),
    caja_id: z.string().uuid().nullish(),
  })
  .default({});

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req.url, "ventas");
    if (!UUID_RE.test(id ?? "")) return idInvalido("venta");
    const { data, error } = await ctx.db.rpc<{ estado: string; devolucion_efectivo?: number }>("anular_venta", {
      p_venta_id: id,
      p_motivo: input?.motivo ?? null,
      p_caja_id: input?.caja_id ?? null,
    });
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, "") || "No se pudo anular la venta.", 409);
    return ok(data);
  },
  { permiso: "anular_ventas", body: cuerpo },
);
