/**
 * Campanita de notificaciones (portada del actual). Siempre del usuario de la SESIÓN: el
 * destinatario nunca sale del request (y la RLS de usuario_notificaciones sólo deja ver las
 * propias, doble red).
 *
 *   GET   /api/notificaciones[?solo_no_leidas=1]
 *         → { notificaciones (últimas 50), no_leidas: { general, soporte, total }, usuario_id, schema }
 *   POST  /api/notificaciones { ids: [...] } | { todas: true, bandeja?: "general"|"soporte" }
 *         → { marcadas }   (marca leídas; PATCH hace lo mismo)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR, fail } from "@/lib/api/responses";
import type { TenantContext } from "@/lib/api/with-tenant";

const COLS = "id, tipo, bandeja, titulo, cuerpo, url, leida_at, created_at";

export const GET = withTenant(async (ctx, req) => {
  const soloNoLeidas = new URL(req.url).searchParams.get("solo_no_leidas") === "1";
  let lista = ctx.db.select("usuario_notificaciones", COLS).eq("usuario_id", ctx.usuarioId);
  if (soloNoLeidas) lista = lista.is("leida_at", null);
  const [items, gen, sop] = await Promise.all([
    lista.order("created_at", { ascending: false }).limit(50),
    ctx.db.select("usuario_notificaciones", "id", { count: "exact", head: true }).eq("usuario_id", ctx.usuarioId).is("leida_at", null).neq("bandeja", "soporte"),
    ctx.db.select("usuario_notificaciones", "id", { count: "exact", head: true }).eq("usuario_id", ctx.usuarioId).is("leida_at", null).eq("bandeja", "soporte"),
  ]);
  if (items.error) return ERR.server();
  const general = gen.count ?? 0;
  const soporte = sop.count ?? 0;
  return ok({
    notificaciones: items.data ?? [],
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
