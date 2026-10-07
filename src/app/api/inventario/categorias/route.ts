/**
 * Categorías de productos (portado de Ferretería República).
 *   GET  /api/inventario/categorias[?todas=1] → activas (o todas) ordenadas por nombre
 *   POST /api/inventario/categorias           → alta (ADMIN); nombre en MAYÚSCULAS, único
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";
import { COLS_CATEGORIA, slugCodigo } from "@/modules/inventario/categorias";

export const GET = withTenant(async (ctx, req) => {
  const todas = new URL(req.url).searchParams.get("todas") === "1";
  let q = ctx.db.select("categorias_productos", COLS_CATEGORIA);
  if (!todas) q = q.eq("activo", true);
  const { data, error } = await q.order("nombre", { ascending: true });
  if (error) return fail("No se pudieron cargar las categorías.", 500);
  return ok({ categorias: data ?? [] });
});

const crear = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio."),
  codigo: z.string().trim().max(60).nullish(),
  descripcion: z.string().trim().max(500).nullish(),
  parent_id: z.string().uuid().nullish(),
  activo: z.boolean().optional(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const nombre = input.nombre.toUpperCase();
    const dup = await ctx.db.select("categorias_productos", "id").ilike("nombre", nombre).limit(1);
    if (dup.error) return ERR.server();
    if (dup.data?.length) return fail("Ya existe una categoría con ese nombre.", 409);
    const { data, error } = await ctx.db.insert("categorias_productos", {
      nombre,
      codigo: input.codigo ? input.codigo.toUpperCase() : slugCodigo(nombre),
      descripcion: input.descripcion ? input.descripcion.toUpperCase() : null,
      parent_id: input.parent_id ?? null,
      activo: input.activo !== false,
    });
    if (error) {
      if (/duplicate|unique/i.test(error.message)) return fail("Ya existe una categoría con ese nombre o código.", 409);
      return fail("No se pudo crear la categoría.", 500);
    }
    return created({ categoria: data?.[0] });
  },
  { roles: ["ADMIN"], body: crear },
);
