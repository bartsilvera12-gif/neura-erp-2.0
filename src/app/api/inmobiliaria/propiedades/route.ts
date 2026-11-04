/**
 * Propiedades del rubro Inmobiliaria (receta 130).
 *   GET  /api/inmobiliaria/propiedades?q=&tipo_id=&gestion=&estado=&ciudad=&desde=&limite=
 *        → { total, por_estado, ciudades, items }
 *   POST /api/inmobiliaria/propiedades → crea una propiedad (editar_productos; la base lo vuelve a exigir).
 * withTenant corta con 403 si la función Inmobiliaria está apagada (funcionDeRutaApi).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloInmo as falloBase } from "@/modules/inmobiliaria/server";
import { esquemaPropiedad } from "@/modules/inmobiliaria/esquema";

export const dynamic = "force-dynamic";

const FILTROS = ["q", "tipo_id", "gestion", "estado", "ciudad", "desde", "limite"] as const;

export const GET = withTenant(async (ctx, req) => {
  const u = new URL(req.url).searchParams;
  const p: Record<string, string> = {};
  for (const k of FILTROS) {
    const v = u.get(k)?.trim();
    if (v) p[k] = v.slice(0, 120);
  }
  const { data, error } = await ctx.db.rpc("propiedades_lista", { p });
  if (error) return falloBase(error, "No se pudieron leer las propiedades");
  return ok(data);
});

export const POST = withTenant(async (ctx, _req, body) => {
  const { data, error } = await ctx.db.rpc("propiedad_guardar", { p: { ...body, id: undefined } });
  if (error) return falloBase(error, "No se pudo guardar la propiedad");
  return ok(data);
}, { permiso: "editar_productos", body: esquemaPropiedad });
