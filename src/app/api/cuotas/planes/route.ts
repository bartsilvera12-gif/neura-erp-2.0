/**
 * Planes de cuotas y tope de cuotas de la empresa (receta 131).
 *   GET /api/cuotas/planes → { max_cuotas, planes: [{ id, nombre, cuotas, cada, primera_dias, entrega_pct, activo }] }
 *   PUT /api/cuotas/planes { max_cuotas, planes[] } (Configuración del sistema). Un plan que no viene se borra.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloRpc } from "@/modules/usuarios/server";

export const dynamic = "force-dynamic";

const plan = z.object({
  id: z.string().uuid().nullish(),
  nombre: z.string().trim().min(2, "Cada plan necesita un nombre").max(80),
  cuotas: z.number().int().min(1).max(360),
  cada: z.enum(["mes", "quincena", "semana"]),
  primera_dias: z.number().int().min(1).max(3650),
  entrega_pct: z.number().min(0).max(99),
  activo: z.boolean(),
}).strict();

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.rpc("planes_cuota_lista");
  if (error) return falloRpc(error);
  return ok(data);
});

export const PUT = withTenant(async (ctx, _req, body) => {
  const { data, error } = await ctx.db.rpc("planes_cuota_guardar", { p: body });
  if (error) return falloRpc(error);
  return ok(data);
}, { permiso: "configuracion", body: z.object({ max_cuotas: z.number().int().min(1).max(360), planes: z.array(plan).max(50) }).strict() });
