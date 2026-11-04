/**
 * Tipos de propiedad de la empresa (receta 130). Arranca con los de siempre.
 *   GET /api/inmobiliaria/tipos → [{ id, nombre, activo, usos }]
 *   PUT /api/inmobiliaria/tipos [{ id?, nombre, activo }] en orden (editar_productos). Uno en uso no se borra: se desactiva.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloInmo as falloBase } from "@/modules/inmobiliaria/server";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.rpc("propiedad_tipos_lista");
  if (error) return falloBase(error, "No se pudieron leer los tipos de propiedad");
  return ok(data);
});

export const PUT = withTenant(async (ctx, _req, body) => {
  const { data, error } = await ctx.db.rpc("propiedad_tipos_guardar", { p: body });
  if (error) return falloBase(error, "No se pudieron guardar los tipos");
  return ok(data);
}, {
  permiso: "editar_productos",
  body: z.array(z.object({ id: z.string().uuid().nullish(), nombre: z.string().trim().min(2).max(60), activo: z.boolean() }).strict()).max(60),
});
