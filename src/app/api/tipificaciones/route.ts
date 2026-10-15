/**
 * Catálogo de tipificaciones (2 niveles, igual que el actual):
 *   "familia" = ESTADO (SOLICITUD / RECLAMOS / CONSULTAS) · "estado" = SUB-ESTADO (lleva la acción).
 *
 *   GET  /api/tipificaciones → { familias: [{ …, subestados: [...] }], meta: { can_edit } }
 *   POST /api/tipificaciones { nivel, nombre, parent_id?, comportamiento?, sort_order? }  (ADMIN)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";
import type { EstadoCat, SubEstadoCat } from "@/modules/tipificacion/dominio";

export const GET = withTenant(async (ctx) => {
  const [fam, est] = await Promise.all([
    ctx.db.select("tipificacion_familias", "id, nombre, sort_order, activo").order("sort_order").order("nombre"),
    ctx.db.select("tipificacion_estados", "id, familia_id, nombre, sort_order, activo, comportamiento").order("sort_order").order("nombre"),
  ]);
  if (fam.error || est.error) return ERR.server();
  const subs = (est.data ?? []) as unknown as SubEstadoCat[];
  const familias: EstadoCat[] = ((fam.data ?? []) as unknown as Omit<EstadoCat, "subestados">[]).map((f) => ({
    ...f,
    subestados: subs.filter((s) => s.familia_id === f.id),
  }));
  return ok({ familias, meta: { can_edit: ctx.rol === "ADMIN" } });
});

const alta = z.object({
  nivel: z.enum(["familia", "estado"], { message: "Nivel inválido" }),
  nombre: z.string().trim().min(1, "Indicá el nombre").max(200),
  parent_id: z.string().uuid().nullish(),
  comportamiento: z.enum(["", "ticket_error", "ticket_cambio", "capacitacion"]).nullish(),
  sort_order: z.number().int().nullish(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    if (input.nivel === "estado" && !input.parent_id) return fail("Falta el estado padre");
    if (input.nivel === "familia") {
      const { data, error } = await ctx.db.insert("tipificacion_familias", { nombre: input.nombre, sort_order: input.sort_order ?? 0 });
      if (error) return fail(error.message);
      return created({ item: data?.[0] ?? null });
    }
    const { data: padre } = await ctx.db.select("tipificacion_familias", "id").eq("id", input.parent_id!).limit(1);
    if (!padre?.length) return ERR.notFound("Estado");
    const { data, error } = await ctx.db.insert("tipificacion_estados", {
      familia_id: input.parent_id,
      nombre: input.nombre,
      sort_order: input.sort_order ?? 0,
      comportamiento: input.comportamiento || null,
    });
    if (error) return fail(error.message);
    return created({ item: data?.[0] ?? null });
  },
  { permiso: "configuracion", body: alta },
);
