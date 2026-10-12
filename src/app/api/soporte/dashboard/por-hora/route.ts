/**
 * GET /api/soporte/dashboard/por-hora?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 * Tickets CARGADOS por hora del día (0–23) en hora de Paraguay, con rango propio.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { TZ_OFFSET_MIN } from "@/modules/soporte/dominio";
import { accesoSoporte, falla, sinAccesoSoporte, ticketsParaAgregar } from "@/modules/soporte/server";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export const GET = withTenant(async (ctx, req) => {
  if (!(await accesoSoporte(ctx))) return sinAccesoSoporte();
  try {
    const sp = new URL(req.url).searchParams;
    const desde = FECHA.test(sp.get("desde") ?? "") ? (sp.get("desde") as string) : "";
    const hasta = FECHA.test(sp.get("hasta") ?? "") ? (sp.get("hasta") as string) : "";
    const tickets = await ticketsParaAgregar(ctx, (q) => {
      let b = q;
      if (desde) b = b.gte("created_at", `${desde}T00:00:00-03:00`);
      if (hasta) b = b.lte("created_at", `${hasta}T23:59:59.999-03:00`);
      return b;
    });
    const horas = Array.from({ length: 24 }, (_, h) => ({ hora: h, total: 0 }));
    for (const t of tickets) {
      const ms = Date.parse(t.created_at);
      if (!Number.isFinite(ms)) continue;
      horas[new Date(ms + TZ_OFFSET_MIN * 60_000).getUTCHours()].total += 1;
    }
    return ok({ desde: desde || null, hasta: hasta || null, total: tickets.length, horas });
  } catch (e) {
    console.error("[soporte/por-hora]", (e as Error)?.message);
    return falla("No se pudo cargar la distribución por hora", 500);
  }
});
