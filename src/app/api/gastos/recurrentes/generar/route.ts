/**
 * POST /api/gastos/recurrentes/generar { periodo: YYYY-MM-DD, ids?: uuid[] } — "Generar gastos del mes":
 *      crea los BORRADORES del período de las plantillas activas que todavía no lo tienen (nunca confirma).
 *      → { periodo, creados: [{ id, plantilla, fecha, total, moneda }], ya_estaban }
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, fail } from "@/lib/api/responses";
import { mensajeDb } from "@/lib/gastos/esquema";

export const dynamic = "force-dynamic";

const cuerpo = z.object({
  periodo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Mes inválido"),
  ids: z.array(z.string().uuid()).max(500).nullish(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("generar_gastos_recurrentes", { p_periodo: input.periodo, p_ids: input.ids?.length ? input.ids : null });
    if (error) return fail(mensajeDb(error.message), 422);
    return created(data);
  },
  { permiso: "registrar_gastos", body: cuerpo },
);
