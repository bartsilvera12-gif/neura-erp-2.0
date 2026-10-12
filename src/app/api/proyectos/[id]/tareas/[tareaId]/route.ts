/**
 * Una tarea del proyecto.
 *   PATCH  /api/proyectos/[id]/tareas/[tareaId] { titulo?, descripcion?, estado?, asignado_id?, fecha_limite? } → Tarea
 *          (quien puede editar el proyecto; el asignado puede cambiar el estado de SU tarea)
 *   DELETE /api/proyectos/[id]/tareas/[tareaId] (quien puede editar el proyecto)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, noContent, fail, ERR } from "@/lib/api/responses";
import {
  errorProy, idTras, nombresUsuarios, permisosDe, proyectoBase, registrarEvento, sinPermiso, tocarProyecto, usuariosValidos,
} from "@/modules/proyectos/server";
import { ESTADOS_TAREA, ESTADO_TAREA_LABEL, type EstadoTarea, type Tarea } from "@/modules/proyectos/tipos";

export const dynamic = "force-dynamic";

const COLS = "id, titulo, descripcion, estado, asignado_id, fecha_limite, orden, created_at";
type Fila = Omit<Tarea, "asignado_nombre">;

const editar = z.object({
  titulo: z.string().trim().min(1, "La tarea necesita un título").max(300).optional(),
  descripcion: z.string().trim().max(4000).optional().nullable(),
  estado: z.enum(ESTADOS_TAREA).optional(),
  asignado_id: z.string().uuid().optional().nullable().or(z.literal("")),
  fecha_limite: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida").optional().nullable().or(z.literal("")),
});

export const PATCH = withTenant(
  async (ctx, req, input) => {
    const id = idTras(req, "proyectos");
    const tareaId = idTras(req, "tareas");
    if (!id || !tareaId) return ERR.notFound("Tarea");
    const [p, { data: actual }] = await Promise.all([
      proyectoBase(ctx, id),
      ctx.db.select("proyecto_tareas", COLS).eq("proyecto_id", id).eq("id", tareaId).maybeSingle(),
    ]);
    const t = actual as unknown as Fila | null;
    if (!p || !t) return ERR.notFound("Tarea");
    const puedeEditar = permisosDe(ctx, p).editar;
    const soloEstado = Object.keys(input).every((k) => k === "estado" || input[k as keyof typeof input] === undefined);
    if (!puedeEditar && !(soloEstado && t.asignado_id === ctx.usuarioId)) return sinPermiso("modificar esta tarea");

    const patch: Record<string, unknown> = {};
    if (input.titulo !== undefined && input.titulo !== t.titulo) patch.titulo = input.titulo;
    if (input.descripcion !== undefined) patch.descripcion = input.descripcion || null;
    if (input.fecha_limite !== undefined) patch.fecha_limite = input.fecha_limite || null;
    if (input.asignado_id !== undefined) {
      const a = input.asignado_id || null;
      if (a && a !== ctx.usuarioId && a !== t.asignado_id && !(await usuariosValidos(ctx, [a]))) return fail("Usuario inválido", 422);
      patch.asignado_id = a;
    }
    const cambioEstado = input.estado !== undefined && input.estado !== t.estado;
    if (cambioEstado) {
      patch.estado = input.estado;
      patch.estado_cambiado_por = ctx.usuarioId;
      patch.estado_cambiado_at = new Date().toISOString();
    }
    if (!Object.keys(patch).length) return ERR.invalid("No hay cambios");
    patch.updated_at = new Date().toISOString();

    const { data, error } = await ctx.db.update("proyecto_tareas", patch).eq("id", tareaId).select(COLS);
    if (error) return errorProy(error, "No se pudo guardar la tarea");
    const nueva = data?.[0] as unknown as Fila | undefined;
    if (!nueva) return ERR.notFound("Tarea");
    const nombres = await nombresUsuarios(ctx, [nueva.asignado_id]);
    await Promise.all([
      cambioEstado
        ? registrarEvento(ctx, id, "tarea_estado", { titulo: nueva.titulo, de: ESTADO_TAREA_LABEL[t.estado as EstadoTarea] ?? t.estado, a: ESTADO_TAREA_LABEL[input.estado as EstadoTarea] })
        : Promise.resolve(),
      tocarProyecto(ctx, id),
    ]);
    return ok({ ...nueva, asignado_nombre: nueva.asignado_id ? (nombres.get(nueva.asignado_id) ?? null) : null } satisfies Tarea);
  },
  { body: editar },
);

export const DELETE = withTenant(async (ctx, req) => {
  const id = idTras(req, "proyectos");
  const tareaId = idTras(req, "tareas");
  if (!id || !tareaId) return ERR.notFound("Tarea");
  const p = await proyectoBase(ctx, id);
  if (!p) return ERR.notFound("Tarea");
  if (!permisosDe(ctx, p).editar) return sinPermiso("eliminar tareas de este proyecto");
  const { data, error } = await ctx.db.delete("proyecto_tareas").eq("proyecto_id", id).eq("id", tareaId).select("titulo");
  if (error) return errorProy(error, "No se pudo eliminar la tarea");
  const t = data?.[0] as unknown as { titulo?: string } | undefined;
  if (!t) return ERR.notFound("Tarea");
  await registrarEvento(ctx, id, "tarea_eliminada", { titulo: t.titulo ?? "" });
  return noContent();
});
