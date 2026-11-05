/**
 * POST /api/gimnasio/asistencias/<id> { estado, forzar?, motivo? } → cambia el estado de una asistencia.
 * Al culminar descuenta la membresía o cobra la clase suelta. Con deuda vencida: 409 code "moroso". Receta 150.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { falloGim, idDe } from "@/modules/gimnasio/server";

const cuerpo = z.object({
  estado: z.enum(["pendiente", "confirmada", "cancelada", "reagendada", "en_espera", "culminada", "no_asistio"]),
  forzar: z.boolean().optional(),
  motivo: z.string().trim().max(500).optional(),
});

export const POST = withTenant(async (ctx, req, b) => {
  const id = idDe(req, "asistencias");
  if (!id) return fail("Asistencia inválida", 400);
  const { data, error } = await ctx.db.rpc("gim_asistencia_estado", { p_id: id, p_estado: b.estado, p_forzar: b.forzar ?? false, p_motivo: b.motivo ?? null });
  if (error) return falloGim(error, "No se pudo cambiar la asistencia");
  return ok(data);
}, { permiso: "gimnasio_recepcion", body: cuerpo });