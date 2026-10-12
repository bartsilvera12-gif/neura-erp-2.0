/**
 * "Cargar más" de una columna del tablero (crm_columna, cursor keyset sin OFFSET).
 *   GET /api/crm/columna?etapa=LEAD&cursor_at=<ISO>&cursor_id=<uuid>&q=&responsable=&mios=1&hoy=1&limite=25
 *     → Tarjeta[]
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { cursorRpc, errorCrm, filtrosRpc, limite, normalizarTarjetas } from "@/modules/crm/server";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const etapa = sp.get("etapa")?.trim();
  if (!etapa) return ERR.invalid("Falta la etapa");
  const { data, error } = await ctx.db.rpc("crm_columna", {
    p_etapa: etapa.slice(0, 40),
    ...cursorRpc(sp),
    ...filtrosRpc(sp),
    p_limite: limite(sp, 25),
  });
  if (error) return errorCrm(error, "No se pudieron cargar más prospectos");
  return ok(normalizarTarjetas(data));
});
