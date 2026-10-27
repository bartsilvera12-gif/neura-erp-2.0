/**
 * Contexto del formulario de tipificación: todo lo que NO depende del cliente, en UNA llamada
 * (la pantalla lo cachea y lo precarga, así el formulario abre sin esperar a la red).
 *
 *   GET /api/tipificaciones/contexto
 *     → { familias (activas, con sus sub-estados activos), usuario_actual, es_admin, equipo,
 *         puede_soporte, horario, clasificaciones, prioridades, responsable_defecto }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { leerConfig, leerEquipo, puedeCargarSoporte } from "@/modules/tipificacion/server";
import type { Clasificacion, ContextoTipificacion, EstadoCat, SubEstadoCat } from "@/modules/tipificacion/dominio";

export const GET = withTenant(async (ctx) => {
  const [fam, est, eq, cfg, clas, prios] = await Promise.all([
    ctx.db.select("tipificacion_familias", "id, nombre, sort_order, activo").eq("activo", true).order("sort_order").order("nombre"),
    ctx.db.select("tipificacion_estados", "id, familia_id, nombre, sort_order, activo, comportamiento").eq("activo", true).order("sort_order").order("nombre"),
    leerEquipo(ctx.db, ctx.usuarioId),
    leerConfig(ctx.db),
    ctx.db.select("soporte_clasificaciones", "codigo, tipo_codigo, nombre, sla_horas, prioridad_sugerida").eq("activo", true).order("sort_order"),
    ctx.db.select("soporte_prioridades", "codigo, nombre, color").eq("activo", true).order("sort_order"),
  ]);
  if (fam.error || est.error) return ERR.server();

  const subs = (est.data ?? []) as unknown as SubEstadoCat[];
  const familias: EstadoCat[] = ((fam.data ?? []) as unknown as Omit<EstadoCat, "subestados">[])
    .map((f) => ({ ...f, subestados: subs.filter((s) => s.familia_id === f.id) }))
    .filter((f) => f.subestados.length > 0);
  const nombres = new Map(eq.equipo.map((p) => [p.id, p.nombre]));
  const defId = cfg.responsable_defecto_id;

  const r: ContextoTipificacion = {
    familias,
    usuario_actual: { id: ctx.usuarioId, nombre: eq.yo?.nombre ?? ctx.user.email ?? "Usuario" },
    es_admin: ctx.rol === "ADMIN",
    equipo: eq.equipo,
    puede_soporte: puedeCargarSoporte(ctx.rol, eq.yo),
    horario: cfg.horario,
    clasificaciones: ((clas.data ?? []) as unknown as Clasificacion[]).map((x) => ({ ...x, sla_horas: Number(x.sla_horas) })),
    prioridades: (prios.data ?? []) as unknown as ContextoTipificacion["prioridades"],
    responsable_defecto: defId && nombres.has(defId) ? { id: defId, nombre: nombres.get(defId)! } : null,
  };
  return ok(r);
});
