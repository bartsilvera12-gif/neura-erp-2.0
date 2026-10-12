/**
 * Agenda de capacitaciones (las que se agendan desde una tipificación).
 *   GET /api/agenda?vista=proximas|pasadas|todas&responsable=<id|yo>&estado=<codigo>
 *       → { citas: [{ …, cliente_nombre, responsable_nombre }], equipo }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { UUID_RE } from "@/modules/tipificacion/server";
import { ESTADOS_CITA } from "@/modules/tipificacion/dominio";

const COLS = "id, cliente_id, responsable_id, titulo, tipo, estado, inicio_at, fin_at, ubicacion, observaciones, cancelada_motivo, metadata, created_at";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const vista = sp.get("vista") ?? "proximas";
  const resp = sp.get("responsable");
  const estado = sp.get("estado");
  const ahora = new Date().toISOString();

  let q = ctx.db.select("agenda_citas", COLS);
  if (vista === "proximas") q = q.gte("fin_at", ahora).order("inicio_at", { ascending: true });
  else if (vista === "pasadas") q = q.lt("fin_at", ahora).order("inicio_at", { ascending: false });
  else q = q.order("inicio_at", { ascending: false });
  if (resp === "yo") q = q.eq("responsable_id", ctx.usuarioId);
  else if (resp && UUID_RE.test(resp)) q = q.eq("responsable_id", resp);
  if (estado && ESTADOS_CITA.some((e) => e.codigo === estado)) q = q.eq("estado", estado);

  const [citas, usuarios] = await Promise.all([q.limit(300), ctx.db.select("usuarios", "id, nombre, activo").order("nombre")]);
  if (citas.error) return ERR.server();
  const filas = (citas.data ?? []) as unknown as { cliente_id: string | null; responsable_id: string | null }[];
  const cliIds = [...new Set(filas.map((c) => c.cliente_id).filter(Boolean))] as string[];
  const { data: clis } = cliIds.length
    ? await ctx.db.select("clientes", "id, nombre").in("id", cliIds)
    : { data: [] as unknown[] };
  const nomCli = new Map(((clis ?? []) as { id: string; nombre: string }[]).map((c) => [c.id, c.nombre]));
  const us = (usuarios.data ?? []) as unknown as { id: string; nombre: string; activo: boolean }[];
  const nomUs = new Map(us.map((u) => [u.id, u.nombre]));

  return ok({
    citas: filas.map((c) => ({
      ...c,
      cliente_nombre: c.cliente_id ? nomCli.get(c.cliente_id) ?? null : null,
      responsable_nombre: c.responsable_id ? nomUs.get(c.responsable_id) ?? null : null,
    })),
    equipo: us.filter((u) => u.activo !== false).map((u) => ({ id: u.id, nombre: u.nombre })),
  });
});
