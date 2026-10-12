/**
 * Una cita de la agenda.
 *   PATCH /api/agenda/[id] { estado, motivo? }
 *         pendiente / confirmada / completada / no_asistio / cancelada (cancelar pide motivo).
 *         Lo puede el responsable de la cita, quien la creó o un ADMIN. Volver a pendiente o
 *         confirmada revisa que el horario siga libre (409 si choca).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { buscarConflictoHorario, idDeRuta, mensajeConflicto } from "@/modules/tipificacion/server";

const cambio = z.object({
  estado: z.enum(["pendiente", "confirmada", "completada", "no_asistio", "cancelada"]),
  motivo: z.string().trim().max(500).nullish(),
});

export const PATCH = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req, "agenda");
    if (!id) return ERR.invalid("Cita inválida");
    const { data } = await ctx.db.select("agenda_citas", "id, estado, responsable_id, created_by, inicio_at, fin_at").eq("id", id).limit(1);
    const cita = (data?.[0] ?? null) as unknown as {
      id: string; estado: string; responsable_id: string | null; created_by: string | null; inicio_at: string; fin_at: string;
    } | null;
    if (!cita) return ERR.notFound("Cita");
    if (ctx.rol !== "ADMIN" && cita.responsable_id !== ctx.usuarioId && cita.created_by !== ctx.usuarioId) return ERR.forbidden();
    if (cita.estado === "reprogramada") return fail("La cita fue reprogramada: ya no se puede cambiar.");
    if (input.estado === cita.estado) return ok({ id, estado: cita.estado });
    if (input.estado === "cancelada" && !input.motivo) return fail("Indicá el motivo de la cancelación.");

    // Reactivar una cancelada: el horario tiene que seguir libre.
    if ((input.estado === "pendiente" || input.estado === "confirmada") && cita.estado === "cancelada" && cita.responsable_id) {
      const choque = await buscarConflictoHorario(ctx.db, {
        responsableId: cita.responsable_id, inicioIso: cita.inicio_at, finIso: cita.fin_at, excluirId: id,
      });
      if (choque) return fail(mensajeConflicto(choque), 409, "conflicto_horario");
    }

    const patch: Record<string, unknown> = { estado: input.estado, updated_at: new Date().toISOString() };
    patch.cancelada_motivo = input.estado === "cancelada" ? input.motivo : null;
    const { error } = await ctx.db.update("agenda_citas", patch).eq("id", id);
    if (error) return fail(error.message);
    return ok({ id, estado: input.estado });
  },
  { body: cambio },
);
