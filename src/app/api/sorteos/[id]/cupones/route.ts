/**
 * Cupones para la urna: uno por número vendido (receta 123).
 *   GET  /api/sorteos/<id>/cupones?desde=&hasta=&pendientes=1 → { sorteo, cupones } (máx. 5000)
 *   POST /api/sorteos/<id>/cupones { numeros } → los marca impresos
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { falloSorteo, idDe } from "@/modules/sorteos/server";

export const dynamic = "force-dynamic";

const entero = (v: string | null) => (v && /^\d{1,7}$/.test(v) ? Number(v) : null);

export const GET = withTenant(async (ctx, req) => {
  const id = idDe(req, "sorteos");
  if (!id) return fail("Sorteo inválido", 400);
  const q = new URL(req.url).searchParams;
  const { data, error } = await ctx.db.rpc("sorteo_cupones", {
    p: { sorteo_id: id, desde: entero(q.get("desde")), hasta: entero(q.get("hasta")), solo_pendientes: q.get("pendientes") === "1" },
  });
  if (error) return falloSorteo(error, "No se pudieron leer los cupones");
  return ok(data);
}, { permiso: "sorteos_vender" });

export const POST = withTenant(async (ctx, req, body) => {
  const id = idDe(req, "sorteos");
  if (!id) return fail("Sorteo inválido", 400);
  const { data, error } = await ctx.db.rpc("sorteo_cupones_impresos", { p_sorteo: id, p_numeros: body.numeros });
  if (error) return falloSorteo(error, "No se pudieron marcar los cupones");
  return ok({ marcados: data });
}, { permiso: "sorteos_vender", body: z.object({ numeros: z.array(z.number().int().min(0)).min(1).max(5000) }) });
