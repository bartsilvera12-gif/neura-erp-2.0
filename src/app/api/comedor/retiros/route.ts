/** Comedor — retiros del día (supervisión). GET /api/comedor/retiros?fecha=YYYY-MM-DD */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";

export const GET = withTenant(
  async (ctx, req) => {
    const fecha = new URL(req.url).searchParams.get("fecha");
    const r = await ctx.db.rpc("comedor_retiros_dia", { p_fecha: fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null });
    if (r.error) return ERR.server();
    return ok(r.data);
  },
  { permiso: "comedor_recepcion" },
);
