/**
 * Categorías de productos (portado de Ferretería República).
 *   GET  /api/inventario/categorias[?todas=1][&conteo=1] → activas (o todas) ordenadas por nombre;
 *        conteo=1 suma { conteo: { [categoria_id]: productos activos } } (pantalla en árbol)
 *   POST /api/inventario/categorias           → alta (ADMIN); nombre tal cual se escribe, único
 * Dos niveles: categoría → subcategoría (una subcategoría no puede tener hijas).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";
import { COLS_CATEGORIA, slugCodigo } from "@/modules/inventario/categorias";

export const GET = withTenant(async (ctx, req) => {
  const todas = new URL(req.url).searchParams.get("todas") === "1";
  let q = ctx.db.select("categorias_productos", COLS_CATEGORIA);
  if (!todas) q = q.eq("activo", true);
  const sp = new URL(req.url).searchParams;
  const [{ data, error }, cnt] = await Promise.all([
    q.order("nombre", { ascending: true }),
    sp.get("conteo") === "1" ? ctx.db.rpc<{ categoria_id: string; productos: number }[]>("conteo_productos_por_categoria") : null,
  ]);
  if (error) return fail("No se pudieron cargar las categorías.", 500);
  if (!cnt) return ok({ categorias: data ?? [] });
  const conteo: Record<string, number> = {};
  for (const r of cnt.data ?? []) conteo[r.categoria_id] = Number(r.productos);
  return ok({ categorias: data ?? [], conteo });
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
    const nombre = input.nombre;
    if (input.parent_id) {
      const pa = await ctx.db.select("categorias_productos", "parent_id").eq("id", input.parent_id).limit(1);
      const fila = pa.data?.[0] as { parent_id: string | null } | undefined;
      if (!fila) return fail("La categoría elegida no existe.", 400);
      if (fila.parent_id) return fail("Las subcategorías no pueden tener otras subcategorías adentro.", 400);
    }
    const dup = await ctx.db.select("categorias_productos", "id").ilike("nombre", nombre).limit(1);
    if (dup.error) return ERR.server();
    if (dup.data?.length) return fail("Ya existe una categoría con ese nombre.", 409);
    const { data, error } = await ctx.db.insert("categorias_productos", {
      nombre,
      codigo: input.codigo ? input.codigo.toUpperCase() : slugCodigo(nombre),
      descripcion: input.descripcion || null,
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
