/**
 * Un sorteo (receta 123).
 *   GET /api/sorteos/<id>  → sorteo con combos, premios y estadísticas (sorteos_vender)
 *   PUT /api/sorteos/<id>  → guarda datos, combos y cuentas de cobro (sorteos_administrar)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { falloSorteo, idDe } from "@/modules/sorteos/server";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const id = idDe(req, "sorteos");
  if (!id) return fail("Sorteo inválido", 400);
  const { data, error } = await ctx.db.rpc("sorteo_detalle", { p_id: id });
  if (error) return falloSorteo(error, "No se pudo leer el sorteo");
  return ok(data);
}, { permiso: "sorteos_vender" });

export const PUT = withTenant(async (ctx, req, body) => {
  const id = idDe(req, "sorteos");
  if (!id) return fail("Sorteo inválido", 400);
  const { data, error } = await ctx.db.rpc("sorteo_guardar", { p: { ...body, id } });
  if (error) return falloSorteo(error, "No se pudo guardar el sorteo");
  return ok(data);
}, { permiso: "sorteos_administrar", body: z.record(z.string(), z.unknown()) });
