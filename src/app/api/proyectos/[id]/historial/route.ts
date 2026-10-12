/**
 * Historial del proyecto (se pide recién al abrir la pestaña).
 *   GET /api/proyectos/[id]/historial → { tramos: Tramo[], eventos: Evento[] }
 *   · tramos: cada paso por un estado con su duración (horas totales y LABORALES)
 *   · eventos: la bitácora (creación, cambios de estado con motivo, ediciones, bloqueos,
 *     asignaciones, tareas, archivos…), más recientes primero
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { idTras, nombresUsuarios } from "@/modules/proyectos/server";
import type { Tramo } from "@/modules/proyectos/tipos";

export const dynamic = "force-dynamic";

type FilaTramo = {
  id: string;
  estado_id: string;
  entered_at: string;
  exited_at: string | null;
  horas_totales: number | string | null;
  horas_laborales: number | string | null;
  tipo_sla_snapshot: string | null;
  usuario_id: string | null;
};

export const GET = withTenant(async (ctx, req) => {
  const id = idTras(req, "proyectos");
  if (!id) return ERR.notFound("Proyecto");
  const [h, ev, est] = await Promise.all([
    ctx.db
      .select("proyecto_estado_historial", "id, estado_id, entered_at, exited_at, horas_totales, horas_laborales, tipo_sla_snapshot, usuario_id")
      .eq("proyecto_id", id)
      .order("entered_at", { ascending: true })
      .limit(500),
    ctx.db
      .select("proyecto_eventos", "id, tipo, detalle, usuario_nombre, created_at")
      .eq("proyecto_id", id)
      .order("created_at", { ascending: false })
      .limit(500),
    ctx.db.select("proyecto_estados", "id, nombre, color"),
  ]);
  if (h.error || ev.error) return ERR.server();
  const estados = new Map(((est.data ?? []) as unknown as { id: string; nombre: string; color: string }[]).map((e) => [e.id, e]));
  const filas = (h.data ?? []) as unknown as FilaTramo[];
  const usuarios = await nombresUsuarios(ctx, filas.map((f) => f.usuario_id));
  const tramos: Tramo[] = filas.map((f) => ({
    id: f.id,
    estado_id: f.estado_id,
    estado_nombre: estados.get(f.estado_id)?.nombre ?? "Estado",
    estado_color: estados.get(f.estado_id)?.color ?? "#64748b",
    entered_at: f.entered_at,
    exited_at: f.exited_at,
    horas_totales: f.horas_totales == null ? null : Number(f.horas_totales),
    horas_laborales: f.horas_laborales == null ? null : Number(f.horas_laborales),
    tipo_sla_snapshot: f.tipo_sla_snapshot,
    usuario_nombre: f.usuario_id ? (usuarios.get(f.usuario_id) ?? null) : null,
  }));
  return ok({ tramos, eventos: ev.data ?? [] });
});
