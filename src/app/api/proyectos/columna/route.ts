/**
 * "Cargar más" de una columna del tablero (proyectos_tarjetas, cursor keyset sin OFFSET).
 *   GET /api/proyectos/columna?estado=<uuid>&cursor_at=<ISO>&cursor_id=<uuid>&q=&responsable=&cliente=&prioridad=&archivados=1&limite=30
 *     → { tarjetas: Tarjeta[], total: number | null }
 * Con rango de entrega (?desde=&hasta=, columnas de Entregado) va por la lista con filtros
 * y ?conteo=1 devuelve además cuántas hay en ese rango.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { cursorRpc, errorProy, esUuid, filtrosRpc, limite, listarProyectos, normalizarTarjetas } from "@/modules/proyectos/server";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const estado = sp.get("estado");
  if (!esUuid(estado)) return ERR.invalid("Falta el estado");
  if (sp.get("desde") || sp.get("hasta")) {
    const r = await listarProyectos(ctx, sp);
    if ("error" in r) return errorProy(r.error, "No se pudieron cargar los proyectos");
    return ok({ tarjetas: r.data, total: r.total });
  }
  const { data, error } = await ctx.db.rpc("proyectos_tarjetas", {
    p_estado: estado,
    ...filtrosRpc(sp),
    ...cursorRpc(sp),
    p_limite: limite(sp, 30),
  });
  if (error) return errorProy(error, "No se pudieron cargar más proyectos");
  return ok({ tarjetas: normalizarTarjetas(data), total: null });
});
