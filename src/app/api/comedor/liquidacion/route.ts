/** Comedor — liquidación mensual (JSON). GET /api/comedor/liquidacion?desde&hasta&empresa */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { rangoLiquidacion } from "@/modules/comedor/liquidacion-server";

export const GET = withTenant(
  async (ctx, req) => {
    const { p_desde, p_hasta, p_empresa } = rangoLiquidacion(new URL(req.url).searchParams);
    const r = await ctx.db.rpc("comedor_liquidacion", { p_desde, p_hasta, p_empresa });
    if (r.error) return ERR.server();
    return ok(r.data);
  },
  { permiso: "comedor_administrar" },
);
