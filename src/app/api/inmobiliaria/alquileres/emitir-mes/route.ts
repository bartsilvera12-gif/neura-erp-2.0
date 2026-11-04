/**
 * Emitir el mes de todos los contratos vigentes que todavía no lo tienen (receta 133).
 *   POST { periodo?: "YYYY-MM-01" } → { mes, emitidas, total, saltados[{ numero, motivo }] } — vender_credito
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloInmo } from "@/modules/inmobiliaria/server";

export const dynamic = "force-dynamic";

export const POST = withTenant(async (ctx, _req, body) => {
  const { data, error } = await ctx.db.rpc("alquileres_emitir_mes", { p_periodo: body.periodo ?? null });
  if (error) return falloInmo(error, "No se pudo emitir el mes");
  return ok(data);
}, { permiso: "vender_credito", body: z.object({ periodo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }).strict() });
