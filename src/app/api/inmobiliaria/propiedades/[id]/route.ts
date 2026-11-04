/**
 * Una propiedad (receta 130).
 *   GET   /api/inmobiliaria/propiedades/<id>            → ficha completa
 *   PUT   /api/inmobiliaria/propiedades/<id>            → guarda la ficha (editar_productos)
 *   PATCH /api/inmobiliaria/propiedades/<id> { estado } → disponible / reservada / vendida / alquilada / retirada
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { falloInmo as falloBase, idDe } from "@/modules/inmobiliaria/server";
import { esquemaPropiedad } from "@/modules/inmobiliaria/esquema";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const id = idDe(req, "propiedades");
  if (!id) return fail("Propiedad inválida", 400);
  const { data, error } = await ctx.db.rpc("propiedad_detalle", { p_id: id });
  if (error) return falloBase(error, "No se pudo leer la propiedad");
  return ok(data);
});

export const PUT = withTenant(async (ctx, req, body) => {
  const id = idDe(req, "propiedades");
  if (!id) return fail("Propiedad inválida", 400);
  const { data, error } = await ctx.db.rpc("propiedad_guardar", { p: { ...body, id } });
  if (error) return falloBase(error, "No se pudo guardar la propiedad");
  return ok(data);
}, { permiso: "editar_productos", body: esquemaPropiedad });

export const PATCH = withTenant(async (ctx, req, body) => {
  const id = idDe(req, "propiedades");
  if (!id) return fail("Propiedad inválida", 400);
  const { data, error } = await ctx.db.rpc("propiedad_estado", { p_id: id, p_estado: body.estado });
  if (error) return falloBase(error, "No se pudo cambiar el estado");
  return ok(data);
}, { permiso: "editar_productos", body: z.object({ estado: z.enum(["disponible", "reservada", "vendida", "alquilada", "retirada"]) }).strict() });
