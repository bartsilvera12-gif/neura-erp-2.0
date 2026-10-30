/**
 * POST /api/me/conexion { salir? } → la app avisa que el usuario sigue conectado (cada 30 s con el
 * sistema a la vista) o que salió (receta 111). No devuelve nada que la pantalla necesite.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { error } = await ctx.db.rpc("marcar_conexion", { p_salir: input.salir === true });
    if (error) {
      console.error("[me/conexion]", error.message);
      return ERR.server();
    }
    return ok({ ok: true });
  },
  { body: z.object({ salir: z.boolean().optional() }) },
);
