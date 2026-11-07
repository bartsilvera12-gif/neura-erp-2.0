/**
 * Comedor — cantina a cuenta del funcionario.
 *   GET  /api/comedor/cantina?documento=CI → { funcionario, saldo } (identifica por CI)
 *   POST /api/comedor/cantina { funcionario_id, items:[{producto_id,cantidad}] } → registra
 *   (el precio lo pone el catálogo en la base; el cliente no manda importes)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";

export const GET = withTenant(
  async (ctx, req) => {
    const doc = new URL(req.url).searchParams.get("documento")?.trim() ?? "";
    if (!doc) return fail("Cargá la cédula.", 400);
    const r = await ctx.db.rpc("comedor_cantina_funcionario", { p_documento: doc });
    if (r.error) return fail(mensajeDb(r.error.message), 400);
    return ok(r.data);
  },
  { permiso: "comedor_recepcion" },
);

const registrar = z.object({
  funcionario_id: z.string().uuid(),
  items: z.array(z.object({
    producto_id: z.string().uuid(),
    cantidad: z.coerce.number().positive().max(999),
  })).min(1, "Agregá al menos un producto").max(50),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const r = await ctx.db.rpc("comedor_cantina_registrar", { p_funcionario: input.funcionario_id, p_items: input.items });
    if (r.error) return fail(mensajeDb(r.error.message), 400);
    return ok(r.data);
  },
  { permiso: "comedor_recepcion", body: registrar },
);

function mensajeDb(m: string): string {
  const limpio = m.replace(/^.*?:\s*/, "").trim();
  return limpio.length > 2 && limpio.length < 160 ? limpio : "No se pudo completar";
}
