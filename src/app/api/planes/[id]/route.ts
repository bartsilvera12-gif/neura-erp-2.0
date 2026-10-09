/**
 * Un plan.
 *   PATCH  /api/planes/[id] → editar (nombre, descripción, precio, moneda, IVA, activo). Solo administrador.
 *          Cambiar el precio NO toca las suscripciones que ya existen (cada una guarda su precio).
 *   DELETE /api/planes/[id] → borrar, solo si ninguna suscripción lo usa; si no, conviene desactivarlo.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, noContent, ok, ERR } from "@/lib/api/responses";
import { errorDb, idDeRuta } from "@/modules/clientes/suscripciones/server";

const editarPlan = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio").max(120).optional(),
  descripcion: z.string().trim().max(500).optional().nullable(),
  precio: z.coerce.number().min(0, "El precio no puede ser negativo").optional(),
  moneda: z.enum(["GS", "USD"]).optional(),
  tipo_iva: z.enum(["10%", "5%", "exenta"]).optional(),
  activo: z.boolean().optional(),
});

export const PATCH = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req, "planes");
    if (!id) return ERR.invalid("Falta el id del plan");
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.nombre !== undefined) patch.nombre = input.nombre;
    if (input.descripcion !== undefined) patch.descripcion = input.descripcion?.trim() || null;
    if (input.moneda !== undefined) patch.moneda = input.moneda;
    if (input.tipo_iva !== undefined) patch.tipo_iva = input.tipo_iva;
    if (input.activo !== undefined) patch.activo = input.activo;
    if (input.precio !== undefined) {
      patch.precio = Math.round(input.precio * 100) / 100;
    }
    const { data, error } = await ctx.db.update("planes", patch).eq("id", id).select("id, nombre, descripcion, precio, moneda, tipo_iva, activo");
    if (error) {
      if ((error as { code?: string }).code === "23505") return fail(`Ya existe un plan llamado "${input.nombre ?? ""}"`, 422);
      return errorDb(error, "No se pudo guardar el plan");
    }
    if (!data?.length) return ERR.notFound("Plan");
    return ok(data[0]);
  },
  { roles: ["ADMIN"], body: editarPlan },
);

export const DELETE = withTenant(
  async (ctx, req) => {
    const id = idDeRuta(req, "planes");
    if (!id) return ERR.invalid("Falta el id del plan");
    const [usado, pendiente] = await Promise.all([
      ctx.db.select("suscripciones", "id", { count: "exact", head: true }).eq("plan_id", id),
      ctx.db.select("suscripciones", "id", { count: "exact", head: true }).eq("plan_pendiente_id", id),
    ]);
    if (usado.error || pendiente.error) return ERR.server();
    const n = (usado.count ?? 0) + (pendiente.count ?? 0);
    if (n > 0) {
      return fail(`Este plan lo usa${n === 1 ? " 1 suscripción" : `n ${n} suscripciones`}: no se puede borrar. Desactivalo para que no se pueda elegir en suscripciones nuevas.`, 409);
    }
    const { error } = await ctx.db.delete("planes").eq("id", id);
    if (error) return errorDb(error, "No se pudo borrar el plan");
    return noContent();
  },
  { roles: ["ADMIN"] },
);
