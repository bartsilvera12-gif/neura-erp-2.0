/**
 * Promesas de pago.
 *   POST /api/cobranzas/promesas { cliente_id, fecha_promesa, observacion? } → la promesa
 *   Queda "pendiente"; se cumple sola cuando el cliente paga (cobro aprobado o queda sin
 *   cuotas vencidas) y se puede cancelar (/promesas/[id]/cancelar).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, fail, ERR } from "@/lib/api/responses";
import { hoyPY } from "@/lib/fecha/paraguay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cuerpo = z.object({
  cliente_id: z.string().uuid(),
  fecha_promesa: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  observacion: z.string().trim().max(500).nullish(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    if (input.fecha_promesa < hoyPY()) return fail("La promesa no puede ser de una fecha pasada", 400);
    const cli = await ctx.db.select("clientes", "id").eq("id", input.cliente_id).is("deleted_at", null).limit(1);
    if (cli.error) return ERR.server();
    if (!cli.data?.length) return ERR.notFound("Cliente");
    const yo = await ctx.db.select("usuarios", "nombre").eq("id", ctx.usuarioId).limit(1);
    const nombre = (yo.data?.[0] as { nombre?: string } | undefined)?.nombre ?? null;
    const ins = await ctx.db.insert("cobranza_promesas", {
      cliente_id: input.cliente_id,
      fecha_promesa: input.fecha_promesa,
      observacion: input.observacion || null,
      created_by: ctx.usuarioId,
      creado_por_nombre: nombre,
    });
    if (ins.error) return fail("No se pudo guardar la promesa", 500);
    return created(ins.data?.[0] ?? null);
  },
  { body: cuerpo },
);
