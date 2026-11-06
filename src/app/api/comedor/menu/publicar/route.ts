/** Comedor — publicar/despublicar la semana (genera el enlace y fija el cierre). POST /api/comedor/menu/publicar */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";

const publicar = z.object({
  semana_id: z.string().uuid(),
  cierre_at: z.string().datetime({ offset: true }).nullable().optional(),
  publicar: z.boolean().default(true),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const r = await ctx.db.rpc("comedor_menu_publicar", {
      p_semana: input.semana_id,
      p_cierre_at: input.cierre_at ?? null,
      p_publicar: input.publicar,
    });
    if (r.error) return ERR.server();
    return ok(r.data);
  },
  { permiso: "comedor_administrar", body: publicar },
);
