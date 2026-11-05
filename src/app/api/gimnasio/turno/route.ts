/** POST /api/gimnasio/turno → turno individual: cita de la Agenda con el alumno y su profesor. Receta 150. */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloGim } from "@/modules/gimnasio/server";

const cuerpo = z.object({
  cliente_id: z.string().uuid(),
  profesor_id: z.string().uuid(),
  inicio_at: z.string().min(10).max(40),
  duracion_min: z.number().int().min(5).max(600),
  titulo: z.string().trim().max(120).optional(),
  observaciones: z.string().trim().max(500).optional(),
});

export const POST = withTenant(async (ctx, _req, b) => {
  const { data, error } = await ctx.db.rpc("gim_turno_crear", { p: b });
  if (error) return falloGim(error, "No se pudo crear el turno");
  return ok(data);
}, { permiso: "gimnasio_recepcion", body: cuerpo });