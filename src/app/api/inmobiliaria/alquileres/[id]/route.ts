/**
 * Un contrato de alquiler (receta 133).
 *   GET   → contrato con sus cuotas (cobrado, saldo, liquidada)
 *   PUT   → guarda el contrato (vender_credito). Con cuotas no cambian propiedad, inquilino ni inicio.
 *   PATCH { estado: finalizado | rescindido, fecha? } → la propiedad vuelve a disponible
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { falloInmo, idDe } from "@/modules/inmobiliaria/server";
import { esquemaContrato } from "@/modules/inmobiliaria/esquema";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const id = idDe(req, "alquileres");
  if (!id) return fail("Contrato inválido", 400);
  const { data, error } = await ctx.db.rpc("alquiler_detalle", { p_id: id });
  if (error) return falloInmo(error, "No se pudo leer el contrato");
  return ok(data);
});

export const PUT = withTenant(async (ctx, req, body) => {
  const id = idDe(req, "alquileres");
  if (!id) return fail("Contrato inválido", 400);
  const { data, error } = await ctx.db.rpc("alquiler_guardar", { p: { ...body, id } });
  if (error) return falloInmo(error, "No se pudo guardar el contrato");
  return ok(data);
}, { permiso: "vender_credito", body: esquemaContrato });

export const PATCH = withTenant(async (ctx, req, body) => {
  const id = idDe(req, "alquileres");
  if (!id) return fail("Contrato inválido", 400);
  const { data, error } = await ctx.db.rpc("alquiler_estado", { p_id: id, p_estado: body.estado, p_fecha: body.fecha ?? null });
  if (error) return falloInmo(error, "No se pudo cambiar el contrato");
  return ok(data);
}, {
  permiso: "vender_credito",
  body: z.object({ estado: z.enum(["finalizado", "rescindido"]), fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }).strict(),
});
