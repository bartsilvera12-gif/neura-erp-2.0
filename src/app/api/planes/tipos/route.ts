/**
 * Tipos de plan: para organizar los planes (receta 108).
 *   GET  /api/planes/tipos → [{ id, nombre }]
 *   POST /api/planes/tipos { nombre } → el tipo (solo administrador)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, fail, ok, ERR } from "@/lib/api/responses";
import { errorDb } from "@/modules/clientes/suscripciones/server";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.select("planes_tipos", "id, nombre").order("nombre", { ascending: true });
  if (error) return ERR.server();
  return ok(data ?? []);
});

const cuerpo = z.object({ nombre: z.string().trim().min(1, "Escribí el nombre del tipo").max(60) });

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.insert("planes_tipos", { nombre: input.nombre.replace(/\s+/g, " ") });
    if (error) {
      if ((error as { code?: string }).code === "23505") return fail(`Ya existe el tipo "${input.nombre}"`, 422);
      return errorDb(error, "No se pudo crear el tipo");
    }
    return created(data?.[0] ?? null);
  },
  { roles: ["ADMIN"], body: cuerpo },
);
