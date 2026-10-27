/**
 * Bandeja de Conversaciones — UNA consulta keyset (chat_bandeja).
 *
 *   GET /api/conversaciones?vista=mias|sin_asignar|todas|cerradas&q=&asignado=&canal=&cola=&sin_asignar=1&cursor_at=&cursor_id=&offset=&limite=
 *       (sin_asignar=1: solo las que no tienen asesor; lo usa el historial de cerradas)
 *       → { rows, contadores, siguiente: { at, id, offset? } | null }
 *       Con q: busca en nombre, número, cliente vinculado (RUC/CI/email) y todos los mensajes,
 *       ordena por relevancia y pagina por `offset` (cada fila puede traer `coincidencia`).
 *   GET /api/conversaciones?solo=contadores → { contadores } (para refrescar las pestañas)
 * El vencimiento del SLA de primera respuesta se suma con una consulta por id (solo las
 * abiertas de la página que lo tienen).
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
  const q = soloContadores ? null : sp.get("q")?.trim().slice(0, 120) || null;
  // Con búsqueda el orden es por relevancia: se pagina por offset (el keyset es por fecha).
  const offset = q ? Math.min(100_000, Math.max(0, Math.trunc(Number(sp.get("offset")) || 0))) : 0;

  const { data, error } = await ctx.db.rpc<{ rows: FilaBandeja[]; contadores: Contadores }>("chat_bandeja", {
    p_vista: vista,
    p_q: q,
    p_asignado: uuidO(sp.get("asignado")),
    p_canal: uuidO(sp.get("canal")),
    p_cursor_at: cursorAt && cursorId && Number.isFinite(Date.parse(cursorAt)) ? cursorAt : null,
    p_cursor_id: cursorAt && cursorId ? cursorId : null,
    p_limite: limite,
    p_cola: uuidO(sp.get("cola")),
    p_sin_asignar: sp.get("sin_asignar") === "1",
    p_offset: offset,
  });
  if (error) {
    console.error("[conversaciones] bandeja", error.message);
    return ERR.server();
  }
  const contadores = data?.contadores ?? CONTADORES_VACIOS;
  if (soloContadores) return ok({ contadores });
  // chat_bandeja ya trae sla_vence_at / primera_respuesta_at (sin consulta extra por página).
  const rows = (data?.rows ?? []).map((r) => ({ ...r, etiquetas: r.etiquetas ?? [] }));
  const ult = rows.length === limite ? rows[rows.length - 1] : null;
  const siguiente = !ult
    ? null
    : q
      ? { at: ult.ultimo_mensaje_at ?? "", id: ult.id, offset: offset + rows.length }
      : ult.ultimo_mensaje_at
        ? { at: ult.ultimo_mensaje_at, id: ult.id }
        : null;
  return ok({ rows, contadores, siguiente });
});
