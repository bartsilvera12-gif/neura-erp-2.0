/**
 * Cobros a clientes (cuenta corriente).
 *   POST /api/cobros { cliente_id, pagos: [{ metodo, monto, referencia? }],
 *                      aplicaciones?: [{ cxc_id, monto }], observacion? }
 *        → { id, numero_recibo, total, a_favor }. Sin aplicaciones paga lo más viejo primero.
 *        Lo cobrado de más (o sin deuda) queda como saldo a favor del cliente (anticipo).
 *        Todo lo cobrado entra a la caja abierta del usuario, o a `caja_id` si eligió una
 *        (el efectivo la necesita abierta; receta 51, caja_abierta_para).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, fail } from "@/lib/api/responses";

const cuerpo = z.object({
  cliente_id: z.string().uuid(),
  caja_id: z.string().uuid().nullish(),
  pagos: z
    .array(z.object({
      metodo: z.enum(["efectivo", "transferencia", "tarjeta", "pos", "cheque", "otro", "saldo_favor"]),
      monto: z.coerce.number().positive("Hay un monto en cero"),
      referencia: z.string().trim().max(120).nullish(),
    }))
    .min(1, "Cargá cómo te pagó")
    .max(10),
  aplicaciones: z.array(z.object({ cxc_id: z.string().uuid(), monto: z.coerce.number().positive() })).max(200).nullish(),
  observacion: z.string().trim().max(1000).nullish(),
  // Receta 135: interés por mora. Con la mora prendida se cobra primero (aparte); `perdonar` pide permiso y motivo.
  mora: z.object({ perdonar: z.boolean(), motivo: z.string().trim().max(300).nullish() }).nullish(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    // Sin interés pendiente (o con la mora apagada) registrar_cobro_con_mora es exactamente registrar_cobro.
    const { data, error } = await ctx.db.rpc("registrar_cobro_con_mora", { p: input });
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, ""), 400);
    return created(data);
  },
  { permiso: "registrar_cobros", body: cuerpo },
);
