/**
 * Contratos de alquiler (receta 133).
 *   GET  /api/inmobiliaria/alquileres?estado=&q=&propiedad_id=&inquilino_id= → lista
 *   POST /api/inmobiliaria/alquileres → nuevo contrato (vender_credito; la base lo vuelve a exigir)
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloInmo } from "@/modules/inmobiliaria/server";
import { esquemaContrato } from "@/modules/inmobiliaria/esquema";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const u = new URL(req.url).searchParams;
  const p: Record<string, string> = {};
  for (const k of ["estado", "q", "propiedad_id", "inquilino_id"]) {
    const v = u.get(k)?.trim();
    if (v) p[k] = v.slice(0, 120);
  }
  const { data, error } = await ctx.db.rpc("alquileres_lista", { p });
  if (error) return falloInmo(error, "No se pudieron leer los contratos");
  return ok(data);
});

export const POST = withTenant(async (ctx, _req, body) => {
  const { data, error } = await ctx.db.rpc("alquiler_guardar", { p: { ...body, id: undefined } });
  if (error) return falloInmo(error, "No se pudo guardar el contrato");
  return ok(data);
}, { permiso: "vender_credito", body: esquemaContrato });
