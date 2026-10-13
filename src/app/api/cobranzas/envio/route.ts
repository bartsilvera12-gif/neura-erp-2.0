/**
 * "Cobranza enviada" del mes en curso (checkbox manual de Seguimiento).
 *   POST /api/cobranzas/envio { cliente_id, enviada } → { cliente_id, enviada, periodo }
 *   Una marca por cliente y mes (Paraguay); destildar la borra.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { periodoActualPY } from "@/modules/cobranzas/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withTenant(
  async (ctx, _req, input) => {
    const periodo = periodoActualPY();
    const cli = await ctx.db.select("clientes", "id").eq("id", input.cliente_id).limit(1);
    if (cli.error) return ERR.server();
    if (!cli.data?.length) return ERR.notFound("Cliente");
    if (input.enviada) {
      const { error } = await ctx.db.insert("cobranza_envios", { cliente_id: input.cliente_id, periodo, created_by: ctx.usuarioId });
      // Ya estaba marcada (doble click, otra pestaña): da lo mismo.
      if (error && (error as { code?: string }).code !== "23505") {
        console.error("[cobranzas envio]", error.message);
        return ERR.server();
      }
    } else {
      const { error } = await ctx.db.delete("cobranza_envios").eq("cliente_id", input.cliente_id).eq("periodo", periodo);
      if (error) return ERR.server();
    }
    return ok({ cliente_id: input.cliente_id, enviada: input.enviada, periodo });
  },
  { body: z.object({ cliente_id: z.string().uuid(), enviada: z.boolean() }) },
);
