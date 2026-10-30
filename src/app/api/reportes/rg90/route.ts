/**
 * Registro de comprobantes RG 90 (recetas 100 y 102).
 *   GET /api/reportes/rg90?mes=AAAA-MM → { ruc, desde, hasta, filas, excluidos } (rg90_registro)
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";
import { rangoMes } from "@/modules/reportes/rg90";

export const GET = withTenant(
  async (ctx, req) => {
    const r = rangoMes(new URL(req.url).searchParams.get("mes"));
    if (!r) return fail("Elegí el mes (AAAA-MM)", 400);
    const { data, error } = await ctx.db.rpc("rg90_registro", { p_desde: r.desde, p_hasta: r.hasta });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { permiso: "ver_reportes_financieros" },
);
