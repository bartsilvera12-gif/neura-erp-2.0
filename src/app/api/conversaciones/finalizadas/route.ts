/**
 * Conversaciones finalizadas — UNA consulta keyset (chat_finalizadas).
 *   GET /api/conversaciones/finalizadas?desde=&hasta=&asesor=&asignado=&cola=&estado=&semaforo=&q=&modo=&cursor_at=&cursor_id=
 *   → { rows, siguiente: { at, id } | null, seguimientos: { pendientes, vencidos }, alcance: "todas" | "equipo" | "propias" }
 *   · modo=seguimientos: próximas acciones pendientes (de la más próxima a la más lejana); las
 *     fechas filtran la próxima acción y el cursor `at` es esa fecha (YYYY-MM-DD).
 *   · semaforo=verde|ambar|rojo|sin: días desde el último mensaje del asesor.
 * ADMIN y supervisores ven todas (y filtran por quién cerró); un supervisor con equipo
 * cargado, solo las de su equipo; el resto, las que cerró él.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { UUID_RE } from "@/modules/tipificacion/server";
import { alcanceSupervision, puedeSupervisar } from "@/modules/conversaciones/server";
import { PAGINA_FINALIZADAS, esSemaforo, type ConteoSeguimientos, type Finalizada } from "@/modules/conversaciones/supervision";

export const dynamic = "force-dynamic";

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const fecha = (v: string | null) => (v && FECHA_RE.test(v) ? v : null);
const uuid = (v: string | null) => (v && UUID_RE.test(v) ? v : null);

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const todas = await puedeSupervisar(ctx);
  const equipo = todas ? await alcanceSupervision(ctx) : null;
  const seguimientos = sp.get("modo") === "seguimientos";
  const cursorAt = sp.get("cursor_at");
  const cursorId = uuid(sp.get("cursor_id"));
  const conCursor = !!cursorAt && !!cursorId && (seguimientos ? FECHA_RE.test(cursorAt) : Number.isFinite(Date.parse(cursorAt)));
  const semaforo = sp.get("semaforo");

  const { data, error } = await ctx.db.rpc<{ rows: Finalizada[]; seguimientos: ConteoSeguimientos | null }>("chat_finalizadas", {
    p_desde: fecha(sp.get("desde")),
    p_hasta: fecha(sp.get("hasta")),
    p_asesor: todas ? uuid(sp.get("asesor")) : ctx.usuarioId,
    p_estado: uuid(sp.get("estado")),
    p_q: sp.get("q")?.trim().slice(0, 120) || null,
    p_cursor_at: conCursor && !seguimientos ? cursorAt : null,
    p_cursor_id: conCursor ? cursorId : null,
    p_limite: PAGINA_FINALIZADAS,
    p_cola: uuid(sp.get("cola")),
    p_asignado: todas ? uuid(sp.get("asignado")) : null,
    p_semaforo: esSemaforo(semaforo) ? semaforo : null,
    p_seguimientos: seguimientos,
    p_cursor_fecha: conCursor && seguimientos ? cursorAt : null,
    p_alcance: equipo,
  });
  if (error) {
    console.error("[conversaciones] finalizadas", error.message);
    return ERR.server();
  }
  const rows = (data?.rows ?? []).map((r) => ({ ...r, etiquetas: r.etiquetas ?? [] }));
  const ult = rows.length === PAGINA_FINALIZADAS ? rows[rows.length - 1] : null;
  const siguiente = ult ? { at: seguimientos ? ult.proxima_accion_fecha ?? "" : ult.cerrada_at, id: ult.id } : null;
  return ok({
    rows,
    siguiente: siguiente?.at ? siguiente : null,
    seguimientos: { pendientes: Number(data?.seguimientos?.pendientes ?? 0), vencidos: Number(data?.seguimientos?.vencidos ?? 0) },
    alcance: !todas ? "propias" : equipo ? "equipo" : "todas",
  });
});
