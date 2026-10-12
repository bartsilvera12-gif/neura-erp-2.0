/**
 * Proyectos — helpers del lado servidor para las rutas /api/proyectos/**. Solo servidor.
 *
 * Permisos (como el actual, vuelto genérico):
 *   · ADMIN: todo.
 *   · técnico responsable / PM: editan y mueven de estado.
 *   · comercial: edita los datos pero NO mueve estados.
 *   · el resto: ve el tablero, comenta; no edita.
 */
import { fail } from "@/lib/api/responses";
import type { TenantContext } from "@/lib/api/with-tenant";
import { notificar } from "@/modules/notificaciones/server";
import type { Permisos, Tarjeta } from "@/modules/proyectos/tipos";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const esUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** Id que sigue a `segmento` en la URL: idTras(req, "proyectos") → /api/proyectos/<id>/… */
export function idTras(req: { url: string }, segmento: string): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf(segmento);
  const id = i >= 0 ? segs[i + 1] : undefined;
  return id && UUID_RE.test(id) ? id : null;
}

/** Errores de la base: los `raise exception` propios se muestran tal cual. */
export function errorProy(error: { message: string; code?: string } | null | undefined, porDefecto = "No se pudo completar la operación") {
  const msg = (error?.message ?? "").replace(/^.*?ERROR:\s*/, "").trim();
  if (!msg || /violates|syntax|relation|column|function .* does not exist|permission denied|schema cache|invalid input/i.test(msg)) {
    if (error?.message) console.error("[proyectos]", error.message);
    return fail(porDefecto, 422);
  }
  return fail(msg, 422);
}

// ── Filtros / cursor ─────────────────────────────────────────────────────────
export function filtrosRpc(sp: URLSearchParams) {
  const resp = sp.get("responsable");
  const cli = sp.get("cliente");
  const prio = sp.get("prioridad");
  return {
    p_q: sp.get("q")?.trim().slice(0, 200) || null,
    p_responsable: esUuid(resp) ? resp : null,
    p_cliente: esUuid(cli) ? cli : null,
    p_prioridad: prio && ["baja", "normal", "alta", "urgente"].includes(prio) ? prio : null,
    p_archivados: sp.get("archivados") === "1",
  };
}

export function cursorRpc(sp: URLSearchParams) {
  const at = sp.get("cursor_at");
  const id = sp.get("cursor_id");
  const ms = at ? Date.parse(at) : NaN;
  return Number.isFinite(ms) && esUuid(id) ? { p_cursor_at: at, p_cursor_id: id } : { p_cursor_at: null, p_cursor_id: null };
}

export function limite(sp: URLSearchParams, def = 30) {
  const n = Number(sp.get("limite") ?? sp.get("n"));
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 100) : def;
}

// ── Columnas ─────────────────────────────────────────────────────────────────
/** Columnas de la tarjeta leídas con select (la lista y "cargar más" con rango de entrega). */
export const COLS_TARJETA =
  "id, numero, titulo, prioridad, estado_id, estado_desde, ultimo_movimiento_at, fecha_ingreso, fecha_prometida, fecha_entrega, " +
  "monto_vendido, moneda, bloqueado, bloqueo_tipo, bloqueo_motivo, bloqueo_responsable, bloqueo_proxima_accion, pausa_motivo, " +
  "cancelacion_motivo, cliente_id, responsable_comercial_id, responsable_tecnico_id, project_manager_id";

export const COLS_PROYECTO =
  `${COLS_TARJETA}, descripcion, pausado_at, pausa_horas_acumuladas, archivado, created_by, created_at, updated_at`;

export type FilaProyecto = {
  id: string;
  numero: string;
  titulo: string;
  descripcion: string | null;
  cliente_id: string | null;
  estado_id: string;
  prioridad: string;
  responsable_comercial_id: string | null;
  responsable_tecnico_id: string | null;
  project_manager_id: string | null;
  fecha_ingreso: string;
  fecha_prometida: string | null;
  fecha_entrega: string | null;
  monto_vendido: number | string;
  moneda: string;
  bloqueado: boolean;
  bloqueo_tipo: string | null;
  bloqueo_motivo: string | null;
  bloqueo_responsable: string | null;
  bloqueo_proxima_accion: string | null;
  pausado_at: string | null;
  pausa_motivo: string | null;
  pausa_horas_acumuladas: number | string;
  cancelacion_motivo: string | null;
  archivado: boolean;
  estado_desde: string;
  ultimo_movimiento_at: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export async function proyectoBase(ctx: TenantContext, id: string): Promise<FilaProyecto | null> {
  const { data } = await ctx.db.select("proyectos", COLS_PROYECTO).eq("id", id).maybeSingle();
  return (data as unknown as FilaProyecto | null) ?? null;
}

// ── Permisos ─────────────────────────────────────────────────────────────────
type ConResponsables = Pick<FilaProyecto, "responsable_comercial_id" | "responsable_tecnico_id" | "project_manager_id">;

export function permisosDe(ctx: TenantContext, p: ConResponsables): Permisos {
  const admin = ctx.rol === "ADMIN";
  const yo = ctx.usuarioId;
  const tecOPm = p.responsable_tecnico_id === yo || p.project_manager_id === yo;
  return {
    editar: admin || tecOPm || p.responsable_comercial_id === yo,
    mover: admin || tecOPm,
    eliminar: admin,
  };
}

export const sinPermiso = (que = "editar este proyecto") => fail(`No tenés permiso para ${que}.`, 403, "forbidden");

// ── Nombres / enriquecido ────────────────────────────────────────────────────
const uniq = (ids: (string | null | undefined)[]) => [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];

export async function nombresUsuarios(ctx: TenantContext, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const u = uniq(ids);
  const m = new Map<string, string>();
  if (!u.length) return m;
  const { data } = await ctx.db.select("usuarios", "id, nombre").in("id", u);
  for (const r of (data ?? []) as unknown as { id: string; nombre: string }[]) m.set(r.id, r.nombre);
  return m;
}

export async function nombresClientes(ctx: TenantContext, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const u = uniq(ids);
  const m = new Map<string, string>();
  if (!u.length) return m;
  const { data } = await ctx.db.select("clientes", "id, nombre").in("id", u);
  for (const r of (data ?? []) as unknown as { id: string; nombre: string }[]) m.set(r.id, r.nombre);
  return m;
}

/** Nombre del usuario logueado (para la bitácora). */
export async function nombreActor(ctx: TenantContext): Promise<string> {
  const m = await nombresUsuarios(ctx, [ctx.usuarioId]);
  return m.get(ctx.usuarioId) ?? ctx.user.email ?? "Usuario";
}

/** Normaliza números de las tarjetas que vienen de las RPC (numeric/bigint llegan como string). */
export function normalizarTarjetas(rows: unknown): Tarjeta[] {
  return (Array.isArray(rows) ? rows : []).map((t) => {
    const x = t as Tarjeta;
    return { ...x, monto_vendido: Number(x.monto_vendido) || 0, tareas_total: Number(x.tareas_total) || 0, tareas_hechas: Number(x.tareas_hechas) || 0 };
  });
}

/** Completa nombres y conteo de tareas en filas leídas con select (sin RPC). */
export async function enriquecerTarjetas(ctx: TenantContext, filas: Record<string, unknown>[]): Promise<Tarjeta[]> {
  if (!filas.length) return [];
  const ids = filas.map((f) => f.id as string);
  const [usuarios, clientes, tareas] = await Promise.all([
    nombresUsuarios(ctx, filas.flatMap((f) => [f.responsable_comercial_id, f.responsable_tecnico_id, f.project_manager_id] as (string | null)[])),
    nombresClientes(ctx, filas.map((f) => f.cliente_id as string | null)),
    ctx.db.select("proyecto_tareas", "proyecto_id, estado").in("proyecto_id", ids),
  ]);
  const cuenta = new Map<string, { t: number; h: number }>();
  for (const r of (tareas.data ?? []) as unknown as { proyecto_id: string; estado: string }[]) {
    const c = cuenta.get(r.proyecto_id) ?? { t: 0, h: 0 };
    c.t++;
    if (r.estado === "completada") c.h++;
    cuenta.set(r.proyecto_id, c);
  }
  const nom = (m: Map<string, string>, id: unknown) => (typeof id === "string" ? (m.get(id) ?? null) : null);
  return filas.map((f) => ({
    ...(f as unknown as Tarjeta),
    monto_vendido: Number(f.monto_vendido) || 0,
    cliente_nombre: nom(clientes, f.cliente_id),
    comercial_nombre: nom(usuarios, f.responsable_comercial_id),
    tecnico_nombre: nom(usuarios, f.responsable_tecnico_id),
    pm_nombre: nom(usuarios, f.project_manager_id),
    tareas_total: cuenta.get(f.id as string)?.t ?? 0,
    tareas_hechas: cuenta.get(f.id as string)?.h ?? 0,
  }));
}

// ── Lista (select con filtros + cursor) ─────────────────────────────────────
const MAX_CANDIDATOS = 300;

/**
 * Proyectos con los mismos filtros del tablero, por último movimiento desc y cursor
 * keyset. Además: ?estado=<uuid>, ?desde/&hasta=YYYY-MM-DD (rango de ENTREGA),
 * ?archivados=todos (activos y archivados) y ?conteo=1 (devuelve el total).
 */
export async function listarProyectos(
  ctx: TenantContext,
  sp: URLSearchParams,
): Promise<{ data: Tarjeta[]; total: number | null } | { error: { message: string; code?: string } }> {
  const f = filtrosRpc(sp);
  const c = cursorRpc(sp);
  const lim = limite(sp, 30);
  const estado = sp.get("estado");
  const conteo = sp.get("conteo") === "1";
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const desde = sp.get("desde");
  const hasta = sp.get("hasta");

  let q = ctx.db.select("proyectos", COLS_TARJETA, conteo ? { count: "exact" } : undefined);
  if (sp.get("archivados") !== "todos") q = q.eq("archivado", f.p_archivados);
  if (esUuid(estado)) q = q.eq("estado_id", estado);
  if (f.p_cliente) q = q.eq("cliente_id", f.p_cliente);
  if (f.p_prioridad) q = q.eq("prioridad", f.p_prioridad);
  const grupos: string[] = [];
  // Rango de ENTREGA. En una columna (?estado) acota esa columna; en la lista general solo
  // saca a los entregados fuera del rango (los no entregados tienen fecha_entrega vacía).
  const rango: string[] = [];
  if (desde && ymd.test(desde)) rango.push(`fecha_entrega.gte."${new Date(`${desde}T00:00:00-03:00`).toISOString()}"`);
  if (hasta && ymd.test(hasta)) rango.push(`fecha_entrega.lt."${new Date(new Date(`${hasta}T00:00:00-03:00`).getTime() + 86_400_000).toISOString()}"`);
  if (rango.length) {
    if (esUuid(estado)) grupos.push(rango.length === 1 ? rango[0] : `and(${rango.join(",")})`);
    else grupos.push(`fecha_entrega.is.null,and(${rango.join(",")})`);
  }
  if (f.p_responsable) {
    const r = f.p_responsable;
    grupos.push(`responsable_tecnico_id.eq.${r},responsable_comercial_id.eq.${r},project_manager_id.eq.${r}`);
  }
  if (c.p_cursor_at && c.p_cursor_id) {
    grupos.push(`ultimo_movimiento_at.lt."${c.p_cursor_at}",and(ultimo_movimiento_at.eq."${c.p_cursor_at}",id.lt.${c.p_cursor_id})`);
  }
  if (grupos.length === 1) q = q.or(grupos[0]);
  else if (grupos.length > 1) q = q.or(`and(${grupos.map((g) => `or(${g})`).join(",")})`);

  if (f.p_q) {
    const r = await ctx.db.rpc<unknown[]>("proyectos_candidatos", { p_q: f.p_q });
    if (r.error) return { error: r.error };
    const ids = (r.data ?? [])
      .map((x) => (typeof x === "string" ? x : ((x as Record<string, unknown>)?.proyectos_candidatos ?? (x as Record<string, unknown>)?.id)))
      .filter((x): x is string => typeof x === "string")
      .slice(0, MAX_CANDIDATOS);
    if (!ids.length) return { data: [], total: conteo ? 0 : null };
    q = q.in("id", ids);
  }
  const { data, error, count } = await q.order("ultimo_movimiento_at", { ascending: false }).order("id", { ascending: false }).limit(lim);
  if (error) return { error };
  return { data: await enriquecerTarjetas(ctx, (data ?? []) as unknown as Record<string, unknown>[]), total: conteo ? (count ?? null) : null };
}

// ── Bitácora / avisos ────────────────────────────────────────────────────────
/** Deja un evento en la bitácora del proyecto (insert-only). Nunca hace fallar la operación. */
export async function registrarEvento(ctx: TenantContext, proyectoId: string, tipo: string, detalle: Record<string, unknown>, actor?: string) {
  try {
    const { error } = await ctx.db.insert("proyecto_eventos", {
      proyecto_id: proyectoId,
      tipo,
      detalle,
      usuario_id: ctx.usuarioId,
      usuario_nombre: actor ?? (await nombreActor(ctx)),
    });
    if (error) console.error("[proyectos/evento]", error.message);
  } catch (e) {
    console.error("[proyectos/evento]", (e as Error)?.message);
  }
}

/** Marca actividad (ordena el tablero y apaga "sin movimiento"). */
export async function tocarProyecto(ctx: TenantContext, id: string) {
  const ahora = new Date().toISOString();
  await ctx.db.update("proyectos", { ultimo_movimiento_at: ahora, updated_at: ahora }).eq("id", id);
}

/** Aviso en la campanita (bandeja general, tipo 'proyecto') a cada usuario, nunca al que actúa. */
export async function avisarUsuarios(
  ctx: TenantContext,
  usuarios: (string | null | undefined)[],
  a: { proyectoId: string; titulo: string; cuerpo?: string | null },
) {
  const destino = uniq(usuarios).filter((u) => u !== ctx.usuarioId);
  await Promise.all(
    destino.map((u) =>
      notificar(ctx.db, ctx.empresaId, { usuarioId: u, tipo: "proyecto", bandeja: "general", titulo: a.titulo, cuerpo: a.cuerpo ?? null, url: `/proyectos/${a.proyectoId}` }),
    ),
  );
}

/** ¿El usuario pertenece a la empresa y está activo? */
export async function usuariosValidos(ctx: TenantContext, ids: string[]): Promise<boolean> {
  const u = uniq(ids);
  if (!u.length) return true;
  if (u.some((x) => !UUID_RE.test(x))) return false;
  const { data } = await ctx.db.select("usuarios", "id").in("id", u).eq("activo", true);
  return (data ?? []).length === u.length;
}

export async function clienteValido(ctx: TenantContext, id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const { data } = await ctx.db.select("clientes", "id").eq("id", id).is("deleted_at", null).limit(1);
  return !!data?.length;
}
