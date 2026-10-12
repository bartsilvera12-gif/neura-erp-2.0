/**
 * Métricas del encabezado de Agenda (portado del actual):
 *   GET /api/agenda/resumen → { hoy, pendientes, confirmadas, completadas, canceladas_no_asistio }
 * "hoy" = citas activas (ni canceladas ni reprogramadas) que empiezan hoy en hora de Paraguay.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { hoyPY } from "@/lib/fecha/paraguay";

export const GET = withTenant(async (ctx) => {
  const inicioHoy = new Date(`${hoyPY()}T00:00:00-03:00`);
  const startIso = inicioHoy.toISOString();
  const endIso = new Date(inicioHoy.getTime() + 24 * 3600_000).toISOString();
  const base = () => ctx.db.select("agenda_citas", "id", { count: "exact", head: true });

  const [hoy, pendientes, confirmadas, completadas, canceladasNoAsistio] = await Promise.all([
    base().gte("inicio_at", startIso).lt("inicio_at", endIso).not("estado", "in", "(cancelada,reprogramada)"),
    base().eq("estado", "pendiente"),
    base().eq("estado", "confirmada"),
    base().eq("estado", "completada"),
    base().in("estado", ["cancelada", "no_asistio"]),
  ]);
  const err = hoy.error || pendientes.error || confirmadas.error || completadas.error || canceladasNoAsistio.error;
  if (err) return fail(err.message);

  return ok({
    hoy: hoy.count ?? 0,
    pendientes: pendientes.count ?? 0,
    confirmadas: confirmadas.count ?? 0,
    completadas: completadas.count ?? 0,
    canceladas_no_asistio: canceladasNoAsistio.count ?? 0,
  });
});
