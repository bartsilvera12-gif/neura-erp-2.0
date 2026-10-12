/**
 * Tareas del proyecto (checklist simple; se piden recién al abrir la pestaña).
 *   GET  /api/proyectos/[id]/tareas → Tarea[] (por orden)
 *   POST /api/proyectos/[id]/tareas { titulo, descripcion?, asignado_id?, fecha_limite? } → Tarea
 *        (quien puede editar el proyecto; queda en la bitácora)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, ok, fail, ERR } from "@/lib/api/responses";
import {
  errorProy, idTras, nombresUsuarios, permisosDe, proyectoBase, registrarEvento, sinPermiso, tocarProyecto, usuariosValidos,
} from "@/modules/proyectos/server";
import type { Tarea } from "@/modules/proyectos/tipos";

export const dynamic = "force-dynamic";

const COLS = "id, titulo, descripcion, estado, asignado_id, fecha_limite, orden, created_at";

export const GET = withTenant(async (ctx, req) => {
  const id = idTras(req, "proyectos");
  if (!id) return ERR.notFound("Proyecto");
  const { data, error } = await ctx.db.select("proyecto_tareas", COLS).eq("proyecto_id", id).order("orden", { ascending: true }).order("created_at", { ascending: true });
  if (error) return ERR.server();
  const filas = (data ?? []) as unknown as Omit<Tarea, "asignado_nombre">[];
  const nombres = await nombresUsuarios(ctx, filas.map((t) => t.asignado_id));
  return ok(filas.map((t) => ({ ...t, asignado_nombre: t.asignado_id ? (nombres.get(t.asignado_id) ?? null) : null })));
});

const crear = z.object({
  titulo: z.string().trim().min(1, "La tarea necesita un título").max(300),
  descripcion: z.string().trim().max(4000).optional().nullable(),
  asignado_id: z.string().uuid().optional().nullable().or(z.literal("")),
  fecha_limite: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida").optional().nullable().or(z.literal("")),
});

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idTras(req, "proyectos");
    if (!id) return ERR.notFound("Proyecto");
    const p = await proyectoBase(ctx, id);
    if (!p) return ERR.notFound("Proyecto");
    if (!permisosDe(ctx, p).editar) return sinPermiso("agregar tareas a este proyecto");
    const asignado = input.asignado_id || null;
    if (asignado && asignado !== ctx.usuarioId && !(await usuariosValidos(ctx, [asignado]))) return fail("Usuario inválido", 422);

    const { data: ult } = await ctx.db.select("proyecto_tareas", "orden").eq("proyecto_id", id).order("orden", { ascending: false }).limit(1);
    const orden = ((ult?.[0] as unknown as { orden?: number } | undefined)?.orden ?? 0) + 1;
    const { data, error } = await ctx.db.insert("proyecto_tareas", {
      proyecto_id: id,
      titulo: input.titulo,
      descripcion: input.descripcion || null,
      asignado_id: asignado,
      fecha_limite: input.fecha_limite || null,
      orden,
      created_by: ctx.usuarioId,
    });
    if (error) return errorProy(error, "No se pudo crear la tarea");
    const t = data?.[0] as unknown as Omit<Tarea, "asignado_nombre"> | undefined;
    if (!t) return errorProy(null, "No se pudo crear la tarea");
    const nombres = await nombresUsuarios(ctx, [asignado]);
    await Promise.all([registrarEvento(ctx, id, "tarea_creada", { titulo: input.titulo }), tocarProyecto(ctx, id)]);
    return created({
      id: t.id, titulo: t.titulo, descripcion: t.descripcion, estado: t.estado, asignado_id: t.asignado_id,
      asignado_nombre: asignado ? (nombres.get(asignado) ?? null) : null, fecha_limite: t.fecha_limite, orden: t.orden, created_at: t.created_at,
    } satisfies Tarea);
  },
  { body: crear },
);
