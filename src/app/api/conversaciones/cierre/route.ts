/**
 * Catálogo para Finalizar / Ticket de Soporte desde el chat (se cachea en el navegador):
 *   GET /api/conversaciones/cierre → { familias: [{ id, nombre, subestados: [{ id, nombre, comportamiento }] }],
 *                                      clasificaciones: [{ codigo, tipo_codigo, nombre, sla_horas }], puede_soporte }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { leerEquipo, puedeCargarSoporte } from "@/modules/tipificacion/server";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx) => {
  const [fam, est, clas, eq] = await Promise.all([
    ctx.db.select("tipificacion_familias", "id, nombre, sort_order").eq("activo", true).order("sort_order").order("nombre"),
    ctx.db.select("tipificacion_estados", "id, familia_id, nombre, comportamiento, sort_order").eq("activo", true).order("sort_order").order("nombre"),
    ctx.db.select("soporte_clasificaciones", "codigo, tipo_codigo, nombre, sla_horas").eq("activo", true).order("sort_order"),
    leerEquipo(ctx.db, ctx.usuarioId),
  ]);
  if (fam.error || est.error) return ERR.server();
  const subs = (est.data ?? []) as unknown as { id: string; familia_id: string; nombre: string; comportamiento: string | null }[];
  const familias = ((fam.data ?? []) as unknown as { id: string; nombre: string }[]).map((f) => ({
    id: f.id,
    nombre: f.nombre,
    subestados: subs.filter((s) => s.familia_id === f.id).map((s) => ({ id: s.id, nombre: s.nombre, comportamiento: s.comportamiento })),
  }));
  return ok({
    familias,
    clasificaciones: ((clas.data ?? []) as unknown as { codigo: string; tipo_codigo: string; nombre: string; sla_horas: number | null }[]).map((c) => ({
      ...c,
      sla_horas: c.sla_horas == null ? null : Number(c.sla_horas),
    })),
    puede_soporte: puedeCargarSoporte(ctx.rol, eq.yo),
  });
});
