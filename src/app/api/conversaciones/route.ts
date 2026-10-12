/**
 * Bandeja de Conversaciones — UNA consulta keyset (chat_bandeja).
 *
 *   GET /api/conversaciones?vista=mias|sin_asignar|todas|cerradas&q=&asignado=&canal=&cursor_at=&cursor_id=&limite=
 *       → { rows, contadores, siguiente: { at, id } | null }
 *   GET /api/conversaciones?solo=contadores → { contadores } (para refrescar las pestañas)
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { UUID_RE } from "@/modules/tipificacion/server";
import { CONTADORES_VACIOS, PAGINA_LISTA, esVista, type Contadores, type FilaBandeja } from "@/modules/conversaciones/dominio";

export const dynamic = "force-dynamic";

const uuidO = (v: string | null) => (v && UUID_RE.test(v) ? v : null);

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const soloContadores = sp.get("solo") === "contadores";
  const vista = esVista(sp.get("vista")) ? sp.get("vista") : "mias";
  const cursorAt = sp.get("cursor_at");
  const cursorId = uuidO(sp.get("cursor_id"));
  const limite = soloContadores ? 1 : Math.min(100, Math.max(1, Number(sp.get("limite")) || PAGINA_LISTA));

  const { data, error } = await ctx.db.rpc<{ rows: FilaBandeja[]; contadores: Contadores }>("chat_bandeja", {
    p_vista: vista,
    p_q: soloContadores ? null : sp.get("q")?.slice(0, 120) || null,
    p_asignado: uuidO(sp.get("asignado")),
    p_canal: uuidO(sp.get("canal")),
    p_cursor_at: cursorAt && cursorId && Number.isFinite(Date.parse(cursorAt)) ? cursorAt : null,
    p_cursor_id: cursorAt && cursorId ? cursorId : null,
    p_limite: limite,
  });
  if (error) {
    console.error("[conversaciones] bandeja", error.message);
    return ERR.server();
  }
  const contadores = data?.contadores ?? CONTADORES_VACIOS;
  if (soloContadores) return ok({ contadores });
  const rows = (data?.rows ?? []).map((r) => ({ ...r, etiquetas: r.etiquetas ?? [] }));
  const ult = rows.length === limite ? rows[rows.length - 1] : null;
  return ok({
    rows,
    contadores,
    siguiente: ult?.ultimo_mensaje_at ? { at: ult.ultimo_mensaje_at, id: ult.id } : null,
  });
});
