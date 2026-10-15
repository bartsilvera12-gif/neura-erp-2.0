/**
 * Categorías de gasto (rubro › subcategoría).
 *   GET  /api/gastos/categorias[?todas=1] → { rubros: [{ id, nombre, subcategorias: [{ id, nombre, tipo_costo, deducible_iva, … }] }] }
 *   POST /api/gastos/categorias { id?, nombre, padre_id? (sin padre = rubro), tipo_costo, deducible_iva?, es_personal?, activo?, orden? }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail } from "@/lib/api/responses";
import { cuerpoCategoria, mensajeDb } from "@/lib/gastos/esquema";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const todas = new URL(req.url).searchParams.get("todas") === "1";
    const { data, error } = await ctx.db.rpc<{ rubros: unknown[] }>("gastos_catalogos", { p_todas: todas });
    if (error) return fail(mensajeDb(error.message), 422);
    return ok({ rubros: data?.rubros ?? [] });
  },
  { roles: ["ADMIN"] },
);

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("guardar_gasto_categoria", { p: input });
    if (error) return fail(mensajeDb(error.message), 422);
    return created(data);
  },
  { roles: ["ADMIN"], body: cuerpoCategoria },
);
