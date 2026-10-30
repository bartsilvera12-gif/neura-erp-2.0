/**
 * Un tipo de plan (receta 108).
 *   PATCH  /api/planes/tipos/[id] { nombre } → renombrar (solo administrador)
 *   DELETE /api/planes/tipos/[id] → borrar: sus planes quedan sin tipo (solo administrador)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, noContent, ok, ERR } from "@/lib/api/responses";
import { errorDb, idDeRuta } from "@/modules/clientes/suscripciones/server";

const cuerpo = z.object({ nombre: z.string().trim().min(1, "Escribí el nombre del tipo").max(60) });

export const PATCH = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req, "tipos");
    if (!id) return ERR.invalid("Falta el id del tipo");
    const { data, error } = await ctx.db.update("planes_tipos", { nombre: input.nombre.replace(/\s+/g, " ") }).eq("id", id).select("id, nombre");
    if (error) {
      if ((error as { code?: string }).code === "23505") return fail(`Ya existe el tipo "${input.nombre}"`, 422);
      return errorDb(error, "No se pudo guardar el tipo");
    }
    if (!data?.length) return ERR.notFound("Tipo");
    return ok(data[0]);
  },
  { roles: ["ADMIN"], body: cuerpo },
);

export const DELETE = withTenant(
  async (ctx, req) => {
    const id = idDeRuta(req, "tipos");
    if (!id) return ERR.invalid("Falta el id del tipo");
    const { error } = await ctx.db.delete("planes_tipos").eq("id", id);
    if (error) return errorDb(error, "No se pudo borrar el tipo");
    return noContent();
  },
  { roles: ["ADMIN"] },
);
