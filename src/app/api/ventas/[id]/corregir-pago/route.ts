/**
 * POST /api/ventas/[id]/corregir-pago { cambios: [{ id, metodo_pago, referencia?, banco? }], motivo }
 * Corrige el método de los pagos de una venta al contado, sin cambiar los montos. Todo lo valida
 * `corregir_pago_venta` (receta 109): permisos, turno cerrado y el registro de la corrección.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";

const cuerpo = z.object({
  motivo: z.string().trim().min(1, "Escribí el motivo de la corrección").max(500),
  cambios: z.array(z.object({
    id: z.string().uuid(),
    metodo_pago: z.string().trim().min(1).max(30),
    referencia: z.string().trim().max(100).nullish(),
    banco: z.string().trim().max(100).nullish(),
  })).min(1).max(20),
});

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req.url, "ventas");
    if (!UUID_RE.test(id ?? "")) return idInvalido("venta");
    const { data, error } = await ctx.db.rpc<{ turno_cerrado: boolean }>("corregir_pago_venta", {
      p_venta_id: id,
      p_cambios: input.cambios,
      p_motivo: input.motivo,
    });
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, "") || "No se pudo corregir el pago.", 409);
    return ok(data);
  },
  { permiso: "anular_ventas", body: cuerpo },
);
