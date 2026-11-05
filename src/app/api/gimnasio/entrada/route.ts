/** POST /api/gimnasio/entrada { cliente_id, forzar?, motivo? } → entrada libre a la sala (sin clase), culminada al momento. Receta 150. */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloGim } from "@/modules/gimnasio/server";

const cuerpo = z.object({ cliente_id: z.string().uuid(), forzar: z.boolean().optional(), motivo: z.string().trim().max(500).optional() });

export const POST = withTenant(async (ctx, _req, b) => {
  const { data, error } = await ctx.db.rpc("gim_entrada", { p_cliente: b.cliente_id, p_forzar: b.forzar ?? false, p_motivo: b.motivo ?? null });
  if (error) return falloGim(error, "No se pudo registrar la entrada");
  return ok(data);
}, { permiso: "gimnasio_recepcion", body: cuerpo });