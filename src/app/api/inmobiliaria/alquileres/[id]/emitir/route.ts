/**
 * Emitir la cuota de un mes de un contrato (receta 133): queda en Cuentas a cobrar del inquilino.
 *   POST { periodo?: "YYYY-MM-01" } (por defecto el mes actual) — vender_credito
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { falloInmo, idDe } from "@/modules/inmobiliaria/server";

export const dynamic = "force-dynamic";

export const POST = withTenant(async (ctx, req, body) => {
  const id = idDe(req, "alquileres");
  if (!id) return fail("Contrato inválido", 400);
  const { data, error } = await ctx.db.rpc("alquiler_emitir", { p_id: id, p_periodo: body.periodo ?? null });
  if (error) return falloInmo(error, "No se pudo emitir la cuota");
  return ok(data);
}, { permiso: "vender_credito", body: z.object({ periodo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }).strict() });
