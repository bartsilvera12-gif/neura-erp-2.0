/**
 * Cierre de un turno de caja (arqueo). POST /api/caja/cierre
 *   { caja_id, monto_cierre_contado, declarado?: { metodo: monto }, billetes?, motivo_diferencia?, observacion? }
 *   → { caja_id, numero_caja, contado, esperado, diferencia, diferencia_otros }
 * El efectivo se CUENTA (monto_cierre_contado); débito, crédito, transferencia, QR… se
 * confirman o corrigen (`declarado`; lo que no venga se toma como lo esperado). Con
 * cualquier diferencia el motivo es obligatorio (lo valida la base, cerrar_caja).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, ERR } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";

const cierreSchema = z.object({
  caja_id: z.string().uuid("Elegí la caja a cerrar"),
  monto_cierre_contado: z.coerce.number().min(0, "Contá el efectivo antes de cerrar (0 o más)"),
  declarado: z.record(z.string().max(30), z.coerce.number().min(0)).default({}),
  billetes: z.record(z.string().max(10), z.coerce.number().int().min(0)).nullish(),
  motivo_diferencia: z.string().trim().max(500).nullish(),
  observacion: z.string().trim().max(500).nullish(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("cerrar_caja", {
      p_caja_id: input.caja_id,
      p_monto_contado: input.monto_cierre_contado,
      p_observacion: input.observacion ?? null,
      p_arqueo_json: {
        declarado: input.declarado,
        billetes: input.billetes ?? null,
        motivo_diferencia: input.motivo_diferencia ?? null,
      },
    });
    if (error) return falloRpc(error);
    if (!data) return ERR.server();
    return created(data);
  },
  { permiso: "abrir_cerrar_caja", body: cierreSchema },
);
