/**
 * Cobros a clientes (cuenta corriente).
 *   POST /api/cobros { cliente_id, pagos: [{ metodo, monto, referencia? }],
 *                      aplicaciones?: [{ cxc_id, monto }], observacion? }
 *        → { id, numero_recibo, total }. Sin aplicaciones paga lo más viejo primero.
 *        Todo lo cobrado entra a la caja abierta (el efectivo la necesita abierta).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, fail } from "@/lib/api/responses";

const cuerpo = z.object({
  cliente_id: z.string().uuid(),
  pagos: z
    .array(z.object({
      metodo: z.enum(["efectivo", "transferencia", "tarjeta", "pos", "cheque", "otro"]),
      monto: z.coerce.number().positive("Hay un monto en cero"),
      referencia: z.string().trim().max(120).nullish(),
    }))
    .min(1, "Cargá cómo te pagó")
    .max(10),
  aplicaciones: z.array(z.object({ cxc_id: z.string().uuid(), monto: z.coerce.number().positive() })).max(200).nullish(),
  observacion: z.string().trim().max(1000).nullish(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("registrar_cobro", { p: input });
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, ""), 400);
    return created(data);
  },
  { roles: ["ADMIN", "CAJERO", "VENDEDOR"], body: cuerpo },
);
