/**
 * Chequeo de disponibilidad para el formulario (portado del actual): ¿el responsable está
 * libre en el rango? Se usa para ADVERTIR antes de guardar (el POST/PATCH igual bloquea).
 *   GET /api/agenda/disponibilidad?responsable_id&inicio&fin&exclude_id?
 *       → { disponible, conflicto: { id, titulo, inicio_at, fin_at, estado, mensaje } | null }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { UUID_RE, buscarConflictoHorario, mensajeConflicto } from "@/modules/agenda/server";

function parseIso(v: string | null): string | null {
  if (!v || !v.trim()) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const responsableId = sp.get("responsable_id")?.trim() ?? "";
  const inicioIso = parseIso(sp.get("inicio"));
  const finIso = parseIso(sp.get("fin"));
  const excludeId = sp.get("exclude_id")?.trim() || null;
  if (!UUID_RE.test(responsableId) || !inicioIso || !finIso) return fail("responsable_id, inicio y fin son obligatorios");
  if (Date.parse(finIso) <= Date.parse(inicioIso)) return fail("fin debe ser posterior a inicio");

  try {
    const conflicto = await buscarConflictoHorario(ctx.db, {
      responsableId,
      inicioIso,
      finIso,
      excluirId: excludeId && UUID_RE.test(excludeId) ? excludeId : null,
    });
    return ok({ disponible: !conflicto, conflicto: conflicto ? { ...conflicto, mensaje: mensajeConflicto(conflicto) } : null });
  } catch (e) {
    console.error("[agenda] disponibilidad", (e as Error).message);
    return ERR.server();
  }
});
