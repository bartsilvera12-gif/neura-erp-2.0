/**
 * Un nodo del catálogo de tipificaciones (ADMIN).
 *   PATCH  /api/tipificaciones/[id] { nivel, nombre?, activo?, sort_order?, comportamiento? }
 *   DELETE /api/tipificaciones/[id]?nivel=familia|estado   (la familia borra en cascada sus sub-estados;
 *          las tipificaciones ya registradas conservan su texto)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { idDeRuta } from "@/modules/tipificacion/server";

const TABLA = { familia: "tipificacion_familias", estado: "tipificacion_estados" } as const;

const cambio = z.object({
  nivel: z.enum(["familia", "estado"], { message: "Nivel inválido" }),
  nombre: z.string().trim().min(1, "El nombre no puede quedar vacío").max(200).optional(),
  activo: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  comportamiento: z.enum(["", "ticket_error", "ticket_cambio", "capacitacion"]).nullish(),
});

export const PATCH = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req, "tipificaciones");
    if (!id) return ERR.invalid("id obligatorio");
    const patch: Record<string, unknown> = {};
    if (input.nombre !== undefined) patch.nombre = input.nombre;
    if (input.activo !== undefined) patch.activo = input.activo;
    if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
    if (input.nivel === "estado" && input.comportamiento !== undefined) patch.comportamiento = input.comportamiento || null;
    if (!Object.keys(patch).length) return fail("Nada para cambiar");
    const { data, error } = await ctx.db.update(TABLA[input.nivel], patch).eq("id", id).select("id");
    if (error) return fail(error.message);
    if (!data?.length) return ERR.notFound();
    return ok({ id });
  },
  { roles: ["ADMIN"], body: cambio },
);

export const DELETE = withTenant(
  async (ctx, req) => {
    const id = idDeRuta(req, "tipificaciones");
    const nivel = new URL(req.url).searchParams.get("nivel");
    if (!id) return ERR.invalid("id obligatorio");
    if (nivel !== "familia" && nivel !== "estado") return ERR.invalid("Nivel inválido");
    const { error } = await ctx.db.delete(TABLA[nivel]).eq("id", id);
    if (error) return fail(error.message);
    return ok({ ok: true });
  },
  { roles: ["ADMIN"] },
);
