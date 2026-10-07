/**
 * Categoría — edición parcial (ADMIN). No hay borrado: se activa/desactiva (como Ferretería).
 *   PATCH /api/inventario/categorias/[id]  { nombre?, codigo?, descripcion?, parent_id?, activo? }
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";

function catId(url: string): string | null {
  const segs = new URL(url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf("categorias");
  return i >= 0 ? (segs[i + 1] ?? null) : null;
}

const editar = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio.").optional(),
  codigo: z.string().trim().max(60).nullish(),
  descripcion: z.string().trim().max(500).nullish(),
  parent_id: z.string().uuid().nullish(),
  activo: z.boolean().optional(),
});

export const PATCH = withTenant(
  async (ctx, req, input) => {
    const id = catId(req.url);
    if (!id) return ERR.invalid("Falta el id de la categoría");
    if (input.parent_id === id) return fail("Una categoría no puede ser su propia categoría padre.", 400);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.nombre !== undefined) patch.nombre = input.nombre.toUpperCase();
    if (input.codigo !== undefined) patch.codigo = input.codigo ? input.codigo.toUpperCase() : null;
    if (input.descripcion !== undefined) patch.descripcion = input.descripcion ? input.descripcion.toUpperCase() : null;
    if (input.parent_id !== undefined) patch.parent_id = input.parent_id ?? null;
    if (input.activo !== undefined) patch.activo = input.activo;
    const { data, error } = await ctx.db.update("categorias_productos", patch).eq("id", id).select("id");
    if (error) {
      if (/duplicate|unique/i.test(error.message)) return fail("Ya existe una categoría con ese nombre o código.", 409);
      return fail("No se pudo actualizar la categoría.", 500);
    }
    if (!data?.length) return ERR.notFound("categoría");
    return ok({ id });
  },
  { roles: ["ADMIN"], body: editar },
);
