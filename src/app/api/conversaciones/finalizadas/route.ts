/**
 * Conversaciones finalizadas — UNA consulta keyset (chat_finalizadas).
 *   GET /api/conversaciones/finalizadas?desde=&hasta=&asesor=&estado=&q=&cursor_at=&cursor_id=
 *   → { rows, siguiente: { at, id } | null, alcance: "todas" | "propias" }
 * ADMIN y supervisores ven todas (y filtran por quién cerró); el resto, las que cerró él.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { UUID_RE } from "@/modules/tipificacion/server";
import { puedeSupervisar } from "@/modules/conversaciones/server";
import { PAGINA_FINALIZADAS, type Finalizada } from "@/modules/conversaciones/supervision";

export const dynamic = "force-dynamic";

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const fecha = (v: string | null) => (v && FECHA_RE.test(v) ? v : null);
const uuid = (v: string | null) => (v && UUID_RE.test(v) ? v : null);

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const todas = await puedeSupervisar(ctx);
  const cursorAt = sp.get("cursor_at");
  const cursorId = uuid(sp.get("cursor_id"));
  const conCursor = !!cursorAt && !!cursorId && Number.isFinite(Date.parse(cursorAt));

  const { data, error } = await ctx.db.rpc<{ rows: Finalizada[] }>("chat_finalizadas", {
    p_desde: fecha(sp.get("desde")),
    p_hasta: fecha(sp.get("hasta")),
    p_asesor: todas ? uuid(sp.get("asesor")) : ctx.usuarioId,
    p_estado: uuid(sp.get("estado")),
    p_q: sp.get("q")?.trim().slice(0, 120) || null,
    p_cursor_at: conCursor ? cursorAt : null,
    p_cursor_id: conCursor ? cursorId : null,
    p_limite: PAGINA_FINALIZADAS,
  });
  if (error) {
    console.error("[conversaciones] finalizadas", error.message);
    return ERR.server();
  }
  const rows = (data?.rows ?? []).map((r) => ({ ...r, etiquetas: r.etiquetas ?? [] }));
  const ult = rows.length === PAGINA_FINALIZADAS ? rows[rows.length - 1] : null;
  return ok({ rows, siguiente: ult ? { at: ult.cerrada_at, id: ult.id } : null, alcance: todas ? "todas" : "propias" });
});
