/**
 * Cancelar una promesa de pago pendiente.
 *   POST /api/cobranzas/promesas/[id]/cancelar { motivo? } → { id }
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { idTras } from "@/modules/cobranzas/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idTras(req, "promesas");
    if (!id) return ERR.invalid("Falta el id de la promesa");
    const yo = await ctx.db.select("usuarios", "nombre").eq("id", ctx.usuarioId).limit(1);
    const nombre = (yo.data?.[0] as { nombre?: string } | undefined)?.nombre ?? null;
    const { data, error } = await ctx.db
      .update("cobranza_promesas", {
        estado: "cancelada",
        cerrada_at: new Date().toISOString(),
        cerrada_por_nombre: nombre,
        cerrada_motivo: input?.motivo?.trim() || "Cancelada",
      })
      .eq("id", id)
      .eq("estado", "pendiente")
      .select("id");
    if (error) return ERR.server();
    if (!data?.length) return fail("La promesa no existe o ya no está pendiente", 409);
    return ok({ id });
  },
  { body: z.object({ motivo: z.string().trim().max(500).nullish() }).default({}) },
);
