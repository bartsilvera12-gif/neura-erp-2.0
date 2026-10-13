/**
 * Dar de baja un lote (vencido, roto, devuelto) — ADMIN.
 *   POST /api/inventario/lotes/[id]/baja { cantidad?, motivo } → { lote_id, numero, cantidad, stock_descontado, quedan }
 * Sin cantidad = todo lo que queda del lote. Sale del lote ESPECÍFICO y queda en el kardex
 * como ajuste manual con el lote y el motivo (dar_baja_lote, receta 44_lotes.sql).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, fail, ERR } from "@/lib/api/responses";

const cuerpo = z.object({
  cantidad: z.coerce.number().positive("La cantidad tiene que ser mayor a 0").nullish(),
  motivo: z.string().trim().min(1, "Escribí el motivo de la baja").max(120),
});

export const POST = withTenant(
  async (ctx, req, input) => {
    const segs = new URL(req.url).pathname.split("/").filter(Boolean);
    const id = segs[segs.indexOf("lotes") + 1];
    if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id del lote");
    const { data, error } = await ctx.db.rpc("dar_baja_lote", {
      p_lote_id: id,
      p_cantidad: input.cantidad ?? null,
      p_motivo: input.motivo,
    });
    // Los mensajes de la función (quedan menos unidades, falta el motivo…) son para el usuario.
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, ""), 400);
    return created(data);
  },
  { roles: ["ADMIN"], body: cuerpo },
);
