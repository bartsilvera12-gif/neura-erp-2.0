/**
 * Cambiar el estado de un proyecto (drag & drop del tablero, selector de la tarjeta o del detalle).
 *   POST /api/proyectos/[id]/estado { estado_id, motivo? } → { id, estado_id, estado_desde, sin_cambios? }
 *
 * Como cambiar-estado del actual: pueden ADMIN, el PM y el técnico responsable (el comercial
 * no). proyecto_cambiar_estado cierra el tramo con sus horas, lleva la pausa, pone
 * fecha_entrega al entregar y deja el evento. Pausar o cancelar exige motivo.
 * Avisa al comercial y al PM (nunca al que lo movió).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { avisarUsuarios, errorProy, idTras, nombreActor, permisosDe, proyectoBase, sinPermiso } from "@/modules/proyectos/server";

export const dynamic = "force-dynamic";

const cambiar = z.object({
  estado_id: z.string().uuid("Estado inválido"),
  motivo: z.string().trim().max(1000).optional().nullable(),
});

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idTras(req, "proyectos");
    if (!id) return ERR.notFound("Proyecto");
    const p = await proyectoBase(ctx, id);
    if (!p) return ERR.notFound("Proyecto");
    if (!permisosDe(ctx, p).mover) return sinPermiso("cambiar el estado de este proyecto");
    if (p.estado_id === input.estado_id) return ok({ id, estado_id: p.estado_id, estado_desde: p.estado_desde, sin_cambios: true });

    const { data, error } = await ctx.db.rpc<{ id: string; estado_id: string; estado_desde: string; sin_cambios?: boolean }>("proyecto_cambiar_estado", {
      p_proyecto: id,
      p_estado: input.estado_id,
      p_motivo: input.motivo || null,
    });
    if (error) return errorProy(error, "No se pudo cambiar el estado");

    if (!data?.sin_cambios) {
      const [{ data: est }, actor] = await Promise.all([
        ctx.db.select("proyecto_estados", "nombre").eq("id", input.estado_id).maybeSingle(),
        nombreActor(ctx),
      ]);
      const nombre = (est as unknown as { nombre?: string } | null)?.nombre ?? "otro estado";
      await avisarUsuarios(ctx, [p.responsable_comercial_id, p.project_manager_id], {
        proyectoId: id,
        titulo: `${p.numero} pasó a ${nombre}`,
        cuerpo: `${p.titulo} · por ${actor}${input.motivo ? ` · Motivo: ${input.motivo}` : ""}`,
      });
    }
    return ok(data);
  },
  { body: cambiar },
);
