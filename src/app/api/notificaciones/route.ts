/**
 * Campanita de notificaciones (portada del actual). Siempre del usuario de la SESIÓN: el
 * destinatario nunca sale del request (y la RLS de usuario_notificaciones sólo deja ver las
 * propias, doble red).
 *
 *   GET   /api/notificaciones[?solo_no_leidas=1]
 *         → { notificaciones (últimas 50), no_leidas: { general, soporte, total }, usuario_id, schema }
 *         Arriba de todo van los recordatorios de reunión de la Agenda (60 y 30 min antes),
 *         calculados al leer: `derivada: true`, sin fila, no se pueden marcar leídos.
 *   POST  /api/notificaciones { ids: [...] } | { todas: true, bandeja?: "general"|"soporte" }
 *         → { marcadas }   (marca leídas; PATCH hace lo mismo)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR, fail } from "@/lib/api/responses";
import type { TenantContext } from "@/lib/api/with-tenant";
import { avisosAgendaDe, avisosDesdeCitas, rangoAvisosAgenda, type CitaConResponsables } from "@/modules/agenda/avisos";

const COLS = "id, tipo, bandeja, titulo, cuerpo, url, leida_at, created_at";

type Campanita = { notificaciones: Record<string, unknown>[]; general: number; soporte: number; citas: CitaConResponsables[] };

/**
 * Receta 91: todo en UN viaje a la base (antes 3-5: lista, dos contadores, citas y sus
 * responsables). La RPC es SECURITY INVOKER, así que la RLS manda igual. Si la base todavía no
 * tiene la función (schema sin la receta 91), null → se arma como antes.
 */
const sinRpcHasta = new Map<string, number>();

async function campanitaEnUnViaje(ctx: TenantContext, soloNoLeidas: boolean) {
  const ahora = Date.now();
  // Schema sin la función: no se la vuelve a probar en cada poll (se reintenta a los 5 min).
  if ((sinRpcHasta.get(ctx.schema) ?? 0) > ahora) return null;
  const { desde, hasta } = rangoAvisosAgenda(ahora);
  const { data, error } = await ctx.db.rpc<Campanita>("notificaciones_campanita", {
    p_usuario: ctx.usuarioId, p_solo_no_leidas: soloNoLeidas, p_desde: desde, p_hasta: hasta,
  });
  if (error || !data) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "PGRST202" || code === "42883") sinRpcHasta.set(ctx.schema, ahora + 5 * 60_000);
    return null;
  }
  const reuniones = avisosDesdeCitas(data.citas ?? [], ctx.usuarioId, ahora);
  const general = Number(data.general ?? 0) + reuniones.length;
  const soporte = Number(data.soporte ?? 0);
  return ok({
    notificaciones: [...reuniones, ...(data.notificaciones ?? [])],
    no_leidas: { general, soporte, total: general + soporte },
    usuario_id: ctx.usuarioId,
    schema: ctx.schema,
  });
}

export const GET = withTenant(async (ctx, req) => {
  const soloNoLeidas = new URL(req.url).searchParams.get("solo_no_leidas") === "1";
  const rapido = await campanitaEnUnViaje(ctx, soloNoLeidas).catch(() => null);
  if (rapido) return rapido;
  let lista = ctx.db.select("usuario_notificaciones", COLS).eq("usuario_id", ctx.usuarioId);
  if (soloNoLeidas) lista = lista.is("leida_at", null);
  const [items, gen, sop, reuniones] = await Promise.all([
    lista.order("created_at", { ascending: false }).limit(50),
    ctx.db.select("usuario_notificaciones", "id", { count: "exact", head: true }).eq("usuario_id", ctx.usuarioId).is("leida_at", null).neq("bandeja", "soporte"),
    ctx.db.select("usuario_notificaciones", "id", { count: "exact", head: true }).eq("usuario_id", ctx.usuarioId).is("leida_at", null).eq("bandeja", "soporte"),
    // Recordatorios de reunión (60 y 30 min antes): calculados en vivo, sin fila
    // (ver modules/agenda/avisos.ts). No se marcan leídos: se apagan solos.
    avisosAgendaDe(ctx.db, ctx.usuarioId).catch(() => []),
  ]);
  if (items.error) return ERR.server();
  // Las reuniones van primero de todo y suman al contador de General.
  const general = (gen.count ?? 0) + reuniones.length;
  const soporte = sop.count ?? 0;
  return ok({
    notificaciones: [...reuniones, ...(items.data ?? [])],
    no_leidas: { general, soporte, total: general + soporte },
    usuario_id: ctx.usuarioId,
    schema: ctx.schema,
  });
});

const marcar = z
  .object({
    ids: z.array(z.string().uuid()).max(200).optional(),
    todas: z.boolean().optional(),
    bandeja: z.enum(["general", "soporte"]).optional(),
  })
  .refine((b) => (b.ids && b.ids.length > 0) || b.todas === true, { message: "Indicá `ids` o `todas`" });

async function marcarLeidas(ctx: TenantContext, input: z.infer<typeof marcar>) {
  let q = ctx.db
    .update("usuario_notificaciones", { leida_at: new Date().toISOString() })
    .eq("usuario_id", ctx.usuarioId)
    .is("leida_at", null);
  if (input.ids?.length) q = q.in("id", input.ids);
  else if (input.bandeja === "soporte") q = q.eq("bandeja", "soporte");
  else if (input.bandeja === "general") q = q.neq("bandeja", "soporte");
  const { data, error } = await q.select("id");
  if (error) return fail(error.message);
  return ok({ marcadas: (data ?? []).length });
}

export const POST = withTenant(async (ctx, _req, input) => marcarLeidas(ctx, input), { body: marcar });
export const PATCH = withTenant(async (ctx, _req, input) => marcarLeidas(ctx, input), { body: marcar });
