/**
 * POST /api/sorteos/vender — venta manual (receta 123), confirmada al guardar. El monto sale del precio
 * o del combo del sorteo; nunca se escribe a mano.
 *   { sorteo_id, cantidad | numeros[], comprador: { nombre, documento?, telefono?, ciudad? }, metodo_pago,
 *     vendedor_id?, referencia_pago?, idempotency_key }
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloSorteo } from "@/modules/sorteos/server";

const cuerpo = z.object({
  sorteo_id: z.string().uuid(),
  cantidad: z.number().int().min(1).max(100000).optional(),
  numeros: z.array(z.number().int().min(0)).max(1000).optional(),
  comprador: z.object({
    nombre: z.string().max(120),
    documento: z.string().max(30).nullish(),
    telefono: z.string().max(30).nullish(),
    ciudad: z.string().max(80).nullish(),
  }),
  metodo_pago: z.enum(["efectivo", "transferencia", "tarjeta", "otro"]),
  vendedor_id: z.string().uuid().nullish(),
  referencia_pago: z.string().max(60).nullish(),
  idempotency_key: z.string().min(8).max(80),
});

export const POST = withTenant(async (ctx, _req, body) => {
  const { data, error } = await ctx.db.rpc("sorteo_vender", { p: body });
  if (error) return falloSorteo(error, "No se pudo registrar la venta");
  return ok(data);
}, { permiso: "sorteos_vender", body: cuerpo });
