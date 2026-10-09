/**
 * Pausar / reactivar / cancelar una suscripción.
 *   POST /api/suscripciones/[id]/estado  { estado: "activa" | "pausada" | "cancelada", motivo? }
 * Cancelar: solo administrador y con motivo; una cancelada no se reactiva (se crea otra).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { errorDb, idDeRuta } from "@/modules/clientes/suscripciones/server";

const cuerpo = z.object({
  estado: z.enum(["activa", "pausada", "cancelada"], { message: "Estado inválido" }),
  motivo: z.string().trim().max(500).optional().nullable(),
});

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req, "suscripciones");
    if (!id) return ERR.invalid("Falta el id de la suscripción");
    if (input.estado === "cancelada" && ctx.rol !== "ADMIN") return ERR.forbidden();
    if (input.estado === "cancelada" && !input.motivo?.trim()) return ERR.invalid("Indicá el motivo de la cancelación");
    const { error } = await ctx.db.rpc("cambiar_estado_suscripcion", {
      p_suscripcion: id,
      p_estado: input.estado,
      p_motivo: input.motivo?.trim() || null,
    });
    if (error) return errorDb(error, "No se pudo cambiar el estado");
    return ok({ estado: input.estado });
  },
  { roles: ["ADMIN", "VENDEDOR"], body: cuerpo },
);
