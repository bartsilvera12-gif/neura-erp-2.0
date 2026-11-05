/** POST /api/gimnasio/anotar { cita_id, cliente_id } → anota al alumno en un día de clase (con cupo). Receta 150. */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloGim } from "@/modules/gimnasio/server";

const cuerpo = z.object({ cita_id: z.string().uuid(), cliente_id: z.string().uuid() });

export const POST = withTenant(async (ctx, _req, b) => {
  const { data, error } = await ctx.db.rpc("gim_anotar", { p_cita: b.cita_id, p_cliente: b.cliente_id });
  if (error) return falloGim(error, "No se pudo anotar al alumno");
  return ok(data);
}, { permiso: "gimnasio_recepcion", body: cuerpo });