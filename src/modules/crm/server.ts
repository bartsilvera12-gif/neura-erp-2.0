/**
 * CRM Funnel — helpers del lado servidor para las rutas /api/crm/**.
 */
import { fail } from "@/lib/api/responses";
import type { TenantContext } from "@/lib/api/with-tenant";
import type { Tarjeta } from "@/modules/crm/tipos";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Columnas de una tarjeta (sin join; responsable_nombre se completa aparte). */
export const COLS_TARJETA =
  "id, numero_control, empresa, contacto, telefono, email, servicio, valor_estimado, etapa, proxima_accion, " +
  "fecha_proxima_accion, origen_creacion, responsable_usuario_id, cliente_id, updated_at, created_at, etapa_desde";

export const COLS_PROSPECTO = `${COLS_TARJETA}, observaciones, origen_detalle, motivo_perdida, created_by`;

/** Filtros comunes (?q, ?responsable, ?mios=1, ?hoy=1) → parámetros de las funciones de base. */
export function filtrosRpc(sp: URLSearchParams) {
  const resp = sp.get("responsable");
  return {
    p_q: sp.get("q")?.trim().slice(0, 200) || null,
    p_responsable: resp && UUID_RE.test(resp) ? resp : null,
    p_solo_mios: sp.get("mios") === "1",
    p_hoy: sp.get("hoy") === "1",
  };
}

/** Cursor keyset (?cursor_at=ISO&cursor_id=uuid). */
export function cursorRpc(sp: URLSearchParams) {
  const at = sp.get("cursor_at");
  const id = sp.get("cursor_id");
  const ms = at ? Date.parse(at) : NaN;
  return Number.isFinite(ms) && id && UUID_RE.test(id)
    ? { p_cursor_at: at, p_cursor_id: id }
    : { p_cursor_at: null, p_cursor_id: null };
}

export function limite(sp: URLSearchParams, def = 25) {
  const n = Number(sp.get("limite") ?? sp.get("n"));
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 100) : def;
}

/** Id del prospecto en /api/crm/<id>/… */
export function idProspecto(req: { url: string }): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf("crm");
  const id = i >= 0 ? segs[i + 1] : undefined;
  return id && UUID_RE.test(id) ? id : null;
}

/** Errores de las funciones de base: los `raise exception` propios se muestran tal cual. */
export function errorCrm(error: { message: string; code?: string } | null | undefined, porDefecto = "No se pudo completar la operación") {
  const msg = (error?.message ?? "").replace(/^.*?ERROR:\s*/, "").trim();
  if (!msg || /violates|syntax|relation|column|function .* does not exist|permission denied|schema cache/i.test(msg)) {
    return fail(porDefecto, 422);
  }
  return fail(msg, 422);
}

/** Nombre del usuario logueado (para las notas). */
export async function nombreUsuario(ctx: TenantContext): Promise<string | null> {
  const { data } = await ctx.db.select("usuarios", "nombre").eq("id", ctx.usuarioId).limit(1);
  return (data?.[0] as unknown as { nombre?: string } | undefined)?.nombre ?? ctx.user.email ?? null;
}

/** Completa responsable_nombre y accion_vencida en filas leídas con select (sin RPC). */
export async function enriquecerTarjetas(ctx: TenantContext, filas: Record<string, unknown>[]): Promise<Tarjeta[]> {
  const ids = [...new Set(filas.map((f) => f.responsable_usuario_id).filter((x): x is string => typeof x === "string"))];
  const nombres = new Map<string, string>();
  if (ids.length) {
    const { data } = await ctx.db.select("usuarios", "id, nombre").in("id", ids);
    for (const u of (data ?? []) as unknown as { id: string; nombre: string }[]) nombres.set(u.id, u.nombre);
  }
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });
  return filas.map((f) => ({
    ...(f as unknown as Tarjeta),
    valor_estimado: Number(f.valor_estimado) || 0,
    responsable_nombre: typeof f.responsable_usuario_id === "string" ? (nombres.get(f.responsable_usuario_id) ?? null) : null,
    accion_vencida: typeof f.fecha_proxima_accion === "string" && f.fecha_proxima_accion < hoy,
  }));
}

/** Normaliza el número de las tarjetas que vienen de las RPC (numeric llega como string o number). */
export function normalizarTarjetas(rows: unknown): Tarjeta[] {
  return (Array.isArray(rows) ? rows : []).map((t) => ({ ...(t as Tarjeta), valor_estimado: Number((t as Tarjeta).valor_estimado) || 0 }));
}

// ── Lista (vista tabla) ───────────────────────────────────────────────────────
// Usa crm_lista (db/canonical/35_crm_lista.sql) si está aplicada. Si no, un select con
// los mismos filtros; la búsqueda pasa por crm_candidatos y se corta en MAX_CANDIDATOS.
const MAX_CANDIDATOS = 300;
let sinCrmLista = 0; // hasta cuándo (ms) no reintentar la función si no existe

export async function listarProspectos(ctx: TenantContext, sp: URLSearchParams): Promise<{ data: Tarjeta[] } | { error: { message: string; code?: string } }> {
  const f = filtrosRpc(sp);
  const c = cursorRpc(sp);
  const etapa = sp.get("etapa")?.trim().slice(0, 40) || null;
  const lim = limite(sp, 25);

  if (Date.now() > sinCrmLista) {
    const r = await ctx.db.rpc("crm_lista", { ...f, p_etapa: etapa, ...c, p_limite: lim });
    if (!r.error) return { data: normalizarTarjetas(r.data) };
    const e = r.error as { message: string; code?: string };
    if (e.code !== "PGRST202" && !/could not find the function/i.test(e.message)) return { error: e };
    sinCrmLista = Date.now() + 5 * 60_000;
  }

  let q = ctx.db.select("crm_prospectos", COLS_TARJETA);
  if (etapa) q = q.eq("etapa", etapa);
  if (f.p_responsable) q = q.eq("responsable_usuario_id", f.p_responsable);
  if (f.p_solo_mios) q = q.eq("responsable_usuario_id", ctx.usuarioId);
  if (f.p_hoy) {
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });
    const desde = new Date(`${hoy}T00:00:00-03:00`);
    q = q.gte("created_at", desde.toISOString()).lt("created_at", new Date(desde.getTime() + 86_400_000).toISOString());
  }
  if (c.p_cursor_at && c.p_cursor_id) {
    q = q.or(`updated_at.lt."${c.p_cursor_at}",and(updated_at.eq."${c.p_cursor_at}",id.lt.${c.p_cursor_id})`);
  }
  if (f.p_q) {
    const r = await ctx.db.rpc<unknown[]>("crm_candidatos", { p_q: f.p_q });
    if (r.error) return { error: r.error };
    const ids = (r.data ?? [])
      .map((x) => (typeof x === "string" ? x : (x as Record<string, unknown>)?.crm_candidatos ?? (x as Record<string, unknown>)?.id))
      .filter((x): x is string => typeof x === "string")
      .slice(0, MAX_CANDIDATOS);
    if (!ids.length) return { data: [] };
    q = q.in("id", ids);
  }
  const { data, error } = await q.order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(lim);
  if (error) return { error };
  return { data: await enriquecerTarjetas(ctx, (data ?? []) as unknown as Record<string, unknown>[]) };
}

/** ¿El usuario pertenece a la empresa y está activo? */
export async function usuarioValido(ctx: TenantContext, id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const { data } = await ctx.db.select("usuarios", "id").eq("id", id).eq("activo", true).limit(1);
  return !!data?.length;
}

/** ¿La etapa existe y está activa? Devuelve la fila. */
export async function etapaActiva(ctx: TenantContext, codigo: string) {
  const { data } = await ctx.db.select("crm_etapas", "codigo, es_ganado, es_perdido").eq("codigo", codigo).eq("activo", true).limit(1);
  return (data?.[0] as unknown as { codigo: string; es_ganado: boolean; es_perdido: boolean } | undefined) ?? null;
}
