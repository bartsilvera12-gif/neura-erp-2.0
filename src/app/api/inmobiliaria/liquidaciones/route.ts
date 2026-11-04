/**
 * Liquidaciones a dueños (receta 133).
 *   GET  /api/inmobiliaria/liquidaciones → { pendiente: [por dueño, con sus cuotas], historial: [...] }
 *   POST /api/inmobiliaria/liquidaciones { propietario_id, cuotas?, medio, referencia? } → le paga el neto
 *        (lo cobrado menos la comisión); sale de la caja abierta. Exige pagar_proveedores.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloInmo } from "@/modules/inmobiliaria/server";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx) => {
  const [pend, hist] = await Promise.all([ctx.db.rpc("alquiler_pendiente_duenos", { p_propietario: null }), ctx.db.rpc("alquiler_liquidaciones_lista", { p_propietario: null })]);
  if (pend.error) return falloInmo(pend.error, "No se pudo leer lo pendiente");
  if (hist.error) return falloInmo(hist.error, "No se pudieron leer las liquidaciones");
  return ok({ pendiente: pend.data, historial: hist.data });
});

export const POST = withTenant(async (ctx, _req, body) => {
  const { data, error } = await ctx.db.rpc("alquiler_liquidar", { p: body });
  if (error) return falloInmo(error, "No se pudo liquidar");
  return ok(data);
}, {
  permiso: "pagar_proveedores",
  body: z.object({
    propietario_id: z.string().uuid(),
    cuotas: z.array(z.string().uuid()).max(500).nullish(),
    medio: z.enum(["efectivo", "transferencia", "cheque", "otro"]),
    referencia: z.string().trim().max(120).nullish(),
  }).strict(),
});
