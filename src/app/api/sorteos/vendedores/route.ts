/**
 * Vendedores de sorteos (receta 123).
 *   GET  /api/sorteos/vendedores?sorteo=<id> → lista con clics, boletas, monto y efectivo por rendir
 *   POST /api/sorteos/vendedores → alta o edición { id?, nombre, telefono?, codigo?, cupo?, comision_pct, activo?, pin? }
 *        Al crear sin PIN, devuelve el PIN generado (se muestra una sola vez).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloSorteo, uuidValido } from "@/modules/sorteos/server";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const s = new URL(req.url).searchParams.get("sorteo");
  const { data, error } = await ctx.db.rpc("sorteo_vendedores_lista", { p_sorteo: uuidValido(s) ? s : null });
  if (error) return falloSorteo(error, "No se pudieron leer los vendedores");
  return ok(data);
}, { permiso: "sorteos_vender" });

const cuerpo = z.object({
  id: z.string().uuid().nullish(),
  nombre: z.string().max(80),
  telefono: z.string().max(30).nullish(),
  codigo: z.string().max(20).nullish(),
  cupo: z.number().int().min(0).max(1000000).nullish(),
  comision_pct: z.number().min(0).max(100),
  activo: z.boolean().optional(),
  pin: z.string().max(8).nullish(),
});

export const POST = withTenant(async (ctx, _req, body) => {
  const { data, error } = await ctx.db.rpc("sorteo_vendedor_guardar", { p: body });
  if (error) return falloSorteo(error, "No se pudo guardar el vendedor");
  return ok(data);
}, { permiso: "sorteos_administrar", body: cuerpo });
