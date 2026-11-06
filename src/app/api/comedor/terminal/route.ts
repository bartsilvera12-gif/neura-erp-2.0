/**
 * Comedor — terminal de retiro (el enlace de autoservicio y el depósito del que descuenta).
 *   GET  /api/comedor/terminal → { retiro_token, deposito_id, depositos }
 *   POST /api/comedor/terminal { deposito_id?, generar? } → fija depósito y/o (re)genera el token
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";

export const GET = withTenant(
  async (ctx) => {
    const r = await ctx.db.rpc("comedor_terminal_leer", {});
    if (r.error) return ERR.server();
    return ok(r.data);
  },
  { permiso: "comedor_administrar" },
);

const guardar = z.object({
  deposito_id: z.string().uuid().nullable().optional(),
  generar: z.boolean().default(false),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const r = await ctx.db.rpc("comedor_terminal_guardar", { p_deposito: input.deposito_id ?? null, p_generar: input.generar });
    if (r.error) return ERR.server();
    return ok(r.data);
  },
  { permiso: "comedor_administrar", body: guardar },
);
