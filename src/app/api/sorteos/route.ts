/**
 * Sorteos (receta 123).
 *   GET  /api/sorteos  → lista con estadísticas (sorteos_vender)
 *   POST /api/sorteos  → crea un sorteo en borrador (sorteos_administrar). Body: ver sorteo_guardar.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloSorteo } from "@/modules/sorteos/server";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.rpc("sorteos_lista");
  if (error) return falloSorteo(error, "No se pudieron leer los sorteos");
  return ok(data);
}, { permiso: "sorteos_vender" });

export const POST = withTenant(async (ctx, _req, body) => {
  const { data, error } = await ctx.db.rpc("sorteo_guardar", { p: { ...body, id: undefined } });
  if (error) return falloSorteo(error, "No se pudo crear el sorteo");
  return ok(data);
}, { permiso: "sorteos_administrar", body: z.record(z.string(), z.unknown()) });
