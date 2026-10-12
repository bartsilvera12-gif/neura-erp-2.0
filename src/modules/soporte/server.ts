/**
 * Soporte — ayudas del lado servidor (rutas /api/soporte/**). Solo servidor.
 *
 * Copia de src/lib/soporte/{servidor,subtareas,tickets-servidor}.ts del sistema
 * actual, sobre el portón withTenant: todo pasa por ctx.db (atado a la empresa).
 */
import type { TenantContext } from "@/lib/api/with-tenant";
import { fail } from "@/lib/api/responses";
import {
  HORARIO_DEFECTO,
  calcularSla,
  etiquetaTipo,
  numeroTicket,
  subtareaAbierta,
  type CatalogosSoporte,
  type ConfigSoporte,
  type InfoSla,
  type Persona,
  type SoporteClasificacion,
  type SoporteEstado,
  type SoportePrioridad,
  type SoporteTipo,
  type TicketFila,
  TICKET_CAMPOS,
} from "@/modules/soporte/dominio";

// ------------------------------------------------------------------ util

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const esUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** Id que viene en la URL justo después de `segmento` (ej. "tickets"), o null si no es un uuid. */
export function idTras(req: { url: string }, segmento: string): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf(segmento);
  const id = i >= 0 ? segs[i + 1] : undefined;
  return esUuid(id) ? id : null;
}

export const falla = (mensaje: string, status = 400) => fail(mensaje, status);

/** Body JSON suelto (las rutas de Soporte validan campo por campo, como el actual). */
export async function cuerpo(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type Fila = Record<string, unknown>;
const filas = <T>(data: unknown): T[] => ((data ?? []) as unknown as T[]);

/** Memoria corta por clave (empresa): los catálogos y el equipo casi no cambian. */
class Memoria<T> {
  private datos = new Map<string, { hasta: number; promesa: Promise<T> }>();
  constructor(private ttl: number) {}
  obtener(clave: string, cargar: () => Promise<T>): Promise<T> {
    const hit = this.datos.get(clave);
    if (hit && hit.hasta > Date.now()) return hit.promesa;
    const promesa = cargar();
    const entrada = { hasta: Date.now() + this.ttl, promesa };
    this.datos.set(clave, entrada);
    promesa.catch(() => this.datos.get(clave) === entrada && this.datos.delete(clave));
    return promesa;
  }
  borrar(clave: string) {
    this.datos.delete(clave);
  }
}

const claveDe = (ctx: TenantContext) => `${ctx.schema}|${ctx.empresaId}`;

// ------------------------------------------------------------------ personas

function areaDe(u: { rol?: unknown; es_qa?: unknown; es_tecnico?: unknown }): string {
  if (u.es_qa === true) return "QA";
  if (u.es_tecnico === true) return "Técnico";
  if (String(u.rol ?? "").toUpperCase() === "ADMIN") return "Admin";
  return "Equipo";
}

/** Nombre corto: nombre + primer apellido (con cuatro palabras, la tercera). */
export function nombreCorto(nombre: string | null | undefined): string {
  const w = (nombre ?? "").trim().split(/\s+/).filter(Boolean);
  if (w.length === 0) return "";
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase();
  if (w.length >= 4) return `${cap(w[0])} ${cap(w[2])}`;
  return w.slice(0, 2).map(cap).join(" ");
}

function aPersona(u: Fila): Persona {
  return {
    id: String(u.id),
    nombre: nombreCorto(String(u.nombre ?? u.email ?? "")) || "Usuario",
    rol: (u.rol as string) ?? null,
    area: areaDe(u),
    es_tecnico: u.es_tecnico === true,
    es_qa: u.es_qa === true,
    usa_soporte: u.usa_soporte === true,
  };
}

const COLS_USUARIO = "id, nombre, email, rol, activo, es_tecnico, es_qa, usa_soporte";
const memoriaEquipo = new Memoria<Persona[]>(60_000);
const memoriaTodos = new Memoria<Map<string, Persona>>(60_000);

/** Usuarios ACTIVOS de la empresa, para los selectores de responsable. */
export function personasDeEmpresa(ctx: TenantContext): Promise<Persona[]> {
  return memoriaEquipo.obtener(claveDe(ctx), async () => {
    const { data, error } = await ctx.db.select("usuarios", COLS_USUARIO).eq("activo", true).order("nombre");
    if (error) throw new Error(error.message);
    return filas<Fila>(data).map(aPersona);
  });
}

/** Todas las personas (también inactivas) por id: los tickets viejos guardan ids de gente que ya no está. */
export async function personasPorId(ctx: TenantContext, ids: (string | null | undefined)[]): Promise<Map<string, Persona>> {
  const todos = await memoriaTodos.obtener(claveDe(ctx), async () => {
    const { data, error } = await ctx.db.select("usuarios", COLS_USUARIO);
    if (error) throw new Error(error.message);
    return new Map(filas<Fila>(data).map((u) => [String(u.id), aPersona(u)]));
  });
  const m = new Map<string, Persona>();
  for (const id of ids) if (id && todos.has(id)) m.set(id, todos.get(id)!);
  return m;
}

export function invalidarEquipo(ctx: TenantContext) {
  memoriaEquipo.borrar(claveDe(ctx));
  memoriaTodos.borrar(claveDe(ctx));
}

/** ¿Hay alguien marcado como Técnico o QA? Si no, puede quedar a cargo un ADMIN. */
export async function hayEquipoSoporte(ctx: TenantContext): Promise<boolean> {
  return (await personasDeEmpresa(ctx)).some((p) => p.es_tecnico || p.es_qa);
}

// ------------------------------------------------------------------ acceso

export type AccesoSoporte = {
  yo: Persona;
  esAdmin: boolean;
  /** La configuración (estados, SLA, equipo, General): solo ADMIN. */
  puedeConfigurar: boolean;
  /** El Dashboard: todos los que usan Soporte menos el equipo operativo (Técnico/QA no admin). */
  veDashboard: boolean;
};

/**
 * Quién puede usar Soporte: ADMIN o quien tenga usuarios.usa_soporte. Se decide
 * en CADA ruta (la pantalla no alcanza).
 */
export async function accesoSoporte(ctx: TenantContext): Promise<AccesoSoporte | null> {
  const { data, error } = await ctx.db.select("usuarios", COLS_USUARIO).eq("id", ctx.usuarioId).maybeSingle();
  if (error || !data) return null;
  const u = data as unknown as Fila;
  const esAdmin = ctx.rol === "ADMIN";
  if (!esAdmin && u.usa_soporte !== true) return null;
  const yo = aPersona(u);
  const operativo = !esAdmin && (yo.es_tecnico || yo.es_qa);
  return { yo, esAdmin, puedeConfigurar: esAdmin, veDashboard: !operativo };
}

export const sinAccesoSoporte = () => falla("No tenés habilitado el módulo Soporte. Pedíselo a un administrador.", 403);

// ------------------------------------------------------------------ config y catálogos

const memoriaConfig = new Memoria<ConfigSoporte>(30_000);

export function leerConfig(ctx: TenantContext): Promise<ConfigSoporte> {
  return memoriaConfig.obtener(claveDe(ctx), async () => {
    const { data } = await ctx.db
      .select("soporte_config", "qa_activo, responsable_defecto_id, hora_inicio, hora_fin, sabado_hasta")
      .maybeSingle();
    const c = (data ?? null) as unknown as Partial<ConfigSoporte> | null;
    return {
      qa_activo: c?.qa_activo === true,
      responsable_defecto_id: c?.responsable_defecto_id ?? null,
      hora_inicio: Number(c?.hora_inicio ?? HORARIO_DEFECTO.hora_inicio),
      hora_fin: Number(c?.hora_fin ?? HORARIO_DEFECTO.hora_fin),
      sabado_hasta: Number(c?.sabado_hasta ?? HORARIO_DEFECTO.sabado_hasta),
    };
  });
}

export function invalidarConfig(ctx: TenantContext) {
  memoriaConfig.borrar(claveDe(ctx));
}

export const TABLAS_CATALOGO = {
  estados: "soporte_estados",
  tipos: "soporte_tipos",
  clasificaciones: "soporte_clasificaciones",
  prioridades: "soporte_prioridades",
} as const;

const memoriaCatalogos = new Memoria<CatalogosSoporte>(60_000);

export function leerCatalogos(ctx: TenantContext): Promise<CatalogosSoporte> {
  return memoriaCatalogos.obtener(claveDe(ctx), async () => {
    const [e, t, c, p] = await Promise.all([
      ctx.db.select(TABLAS_CATALOGO.estados, "codigo, nombre, tipo, color, area, detiene_sla, es_inicial, sort_order, activo").order("sort_order"),
      ctx.db.select(TABLAS_CATALOGO.tipos, "codigo, nombre, sla_horas, sort_order, activo").order("sort_order"),
      ctx.db.select(TABLAS_CATALOGO.clasificaciones, "codigo, tipo_codigo, nombre, sla_horas, prioridad_sugerida, sort_order, activo").order("sort_order"),
      ctx.db.select(TABLAS_CATALOGO.prioridades, "codigo, nombre, color, sort_order, activo").order("sort_order"),
    ]);
    const err = e.error ?? t.error ?? c.error ?? p.error;
    if (err) throw new Error(err.message);
    const num = <T extends { sla_horas: unknown }>(rows: T[]) => rows.map((r) => ({ ...r, sla_horas: r.sla_horas == null ? null : Number(r.sla_horas) }));
    return {
      estados: filas<SoporteEstado>(e.data).map((x) => ({ ...x, color: x.color || "#94a3b8" })),
      tipos: num(filas<SoporteTipo>(t.data)) as SoporteTipo[],
      clasificaciones: num(filas<SoporteClasificacion>(c.data)) as SoporteClasificacion[],
      prioridades: filas<SoportePrioridad>(p.data).map((x) => ({ ...x, color: x.color || "#94a3b8" })),
    };
  });
}

export function invalidarCatalogos(ctx: TenantContext) {
  memoriaCatalogos.borrar(claveDe(ctx));
}

// ------------------------------------------------------------------ clientes

/** Nombres de clientes por id (la tabla de Clientes no se duplica). */
export async function clientesPorId(ctx: TenantContext, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x): x is string => esUuid(x)))];
  const m = new Map<string, string>();
  for (let i = 0; i < unicos.length; i += 200) {
    const { data } = await ctx.db.select("clientes", "id, nombre").in("id", unicos.slice(i, i + 200));
    for (const c of filas<{ id: string; nombre: string | null }>(data)) m.set(c.id, c.nombre?.trim() || "Cliente");
  }
  return m;
}

// ------------------------------------------------------------------ tickets

export async function ticketDeEmpresa<T = TicketFila>(ctx: TenantContext, id: string, campos: string = TICKET_CAMPOS): Promise<T | null> {
  if (!esUuid(id)) return null;
  const { data } = await ctx.db.select("soporte_tickets", campos).eq("id", id).maybeSingle();
  return (data as unknown as T | null) ?? null;
}

export type TicketVista = TicketFila & {
  cliente_nombre: string | null;
  responsable: Persona | null;
  creador: Persona | null;
  tipo_etiqueta: string;
  clasificacion_nombre: string | null;
  estado_nombre: string;
  estado_color: string;
  estado_tipo: "abierto" | "cerrado";
  estado_area: string | null;
  prioridad_nombre: string;
  prioridad_color: string;
  sla: InfoSla;
};

/** Tickets listos para mostrar: etiquetas, personas, cliente y SLA (en lote, no por fila). */
export async function enriquecerTickets(ctx: TenantContext, cat: CatalogosSoporte, cfg: ConfigSoporte, lista: TicketFila[]): Promise<TicketVista[]> {
  const [personas, clientes] = await Promise.all([
    personasPorId(ctx, lista.flatMap((t) => [t.responsable_id, t.created_by])),
    clientesPorId(ctx, lista.map((t) => t.cliente_id)),
  ]);
  const ahora = new Date().toISOString();
  return lista.map((t) => {
    const estado = cat.estados.find((e) => e.codigo === t.estado_codigo);
    const prioridad = cat.prioridades.find((p) => p.codigo === t.prioridad_codigo);
    const clasif = cat.clasificaciones.find((c) => c.codigo === t.clasificacion_codigo);
    return {
      ...t,
      cliente_nombre: t.cliente_id ? (clientes.get(t.cliente_id) ?? null) : null,
      responsable: t.responsable_id ? (personas.get(t.responsable_id) ?? null) : null,
      creador: t.created_by ? (personas.get(t.created_by) ?? null) : null,
      tipo_etiqueta: etiquetaTipo(cat, t.tipo_codigo, t.clasificacion_codigo),
      clasificacion_nombre: clasif?.nombre ?? null,
      estado_nombre: estado?.nombre ?? t.estado_codigo,
      estado_color: estado?.color ?? "#94a3b8",
      estado_tipo: estado?.tipo ?? "abierto",
      estado_area: estado?.area ?? null,
      prioridad_nombre: prioridad?.nombre ?? t.prioridad_codigo,
      prioridad_color: prioridad?.color ?? "#94a3b8",
      sla: calcularSla(t, cfg, ahora),
    };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Consulta = any;

/** Todos los tickets que cumplen un filtro, sin paginar (tableros y reportes agregan en memoria). */
export async function ticketsParaAgregar(ctx: TenantContext, filtro?: (q: Consulta) => Consulta): Promise<TicketFila[]> {
  const todos: TicketFila[] = [];
  for (let desde = 0; desde < 50_000; desde += 1000) {
    let q: Consulta = ctx.db.select("soporte_tickets", TICKET_CAMPOS);
    if (filtro) q = filtro(q);
    const { data, error } = await q.order("created_at", { ascending: true }).range(desde, desde + 999);
    if (error) throw new Error(error.message);
    const lote = filas<TicketFila>(data);
    todos.push(...lote);
    if (lote.length < 1000) break;
  }
  return todos;
}

// ------------------------------------------------------------------ historial

export type EventoHistorial = {
  tipo_evento: string;
  valor_anterior?: string | null;
  valor_nuevo?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Agrega eventos al historial (sólo inserta: la base no deja editarlo ni borrarlo).
 * Si falla se registra y se sigue: el cambio del ticket ya quedó hecho.
 */
export async function registrarHistorial(ctx: TenantContext, ticketId: string, eventos: EventoHistorial[]): Promise<void> {
  if (eventos.length === 0) return;
  const rows = eventos.map((ev) => ({
    ticket_id: ticketId,
    usuario_id: ctx.usuarioId,
    tipo_evento: ev.tipo_evento,
    valor_anterior: ev.valor_anterior ?? null,
    valor_nuevo: ev.valor_nuevo ?? null,
    metadata: ev.metadata ?? {},
  }));
  const { error } = await ctx.db.insert("soporte_ticket_historial", rows);
  if (error) console.error("[soporte] no se pudo registrar historial", error.message);
}

/** Toca updated_at del ticket: comentar o adjuntar también es actividad. */
export async function tocarTicket(ctx: TenantContext, ticketId: string): Promise<void> {
  await ctx.db.update("soporte_tickets", { updated_at: new Date().toISOString(), updated_by: ctx.usuarioId }).eq("id", ticketId);
}

// ------------------------------------------------------------------ notificaciones

/**
 * Aviso en la campanita (usuario_notificaciones, bandeja "soporte"). Nunca al
 * que hizo la acción. Nunca lanza: perder un aviso no puede voltear el cambio.
 *
 * Se inserta SIN devolver la fila: la RLS de lectura sólo deja ver las propias,
 * y un RETURNING de una fila ajena fallaría.
 */
export async function notificar(
  ctx: TenantContext,
  args: { usuarioId: string | null | undefined; titulo: string; cuerpo?: string | null; ticketId: string },
): Promise<void> {
  if (!args.usuarioId || args.usuarioId === ctx.usuarioId) return;
  try {
    const { error } = await ctx.db
      .unsafeRaw()
      .from("usuario_notificaciones")
      .insert({
        empresa_id: ctx.empresaId,
        usuario_id: args.usuarioId,
        tipo: "soporte_revision",
        bandeja: "soporte",
        titulo: args.titulo.slice(0, 200),
        cuerpo: (args.cuerpo ?? "").slice(0, 300) || null,
        url: `/soporte/tickets/${args.ticketId}`,
      });
    if (error) console.error("[soporte] no se pudo avisar", error.message);
  } catch (e) {
    console.error("[soporte] no se pudo avisar", (e as Error)?.message);
  }
}

const TITULO_PARA_CREADOR: Record<string, (n: number) => string> = {
  resuelto: (n) => `Ticket ${numeroTicket(n)} resuelto`,
  falta_informacion: (n) => `Ticket ${numeroTicket(n)} necesita información del cliente`,
};

/**
 * Resuelto o Falta información: avisa a quien cargó el ticket (es quien habla
 * con el cliente). En el actual iba a las PM; acá, a created_by.
 */
export async function avisarEstadoACreador(
  ctx: TenantContext,
  ticket: { id: string; numero: number; asunto: string; created_by: string | null; cliente_id?: string | null },
  estadoCodigo: string,
): Promise<void> {
  const titulo = TITULO_PARA_CREADOR[estadoCodigo];
  if (!titulo || !ticket.created_by) return;
  const cliente = ticket.cliente_id ? (await clientesPorId(ctx, [ticket.cliente_id])).get(ticket.cliente_id) : null;
  await notificar(ctx, {
    usuarioId: ticket.created_by,
    titulo: titulo(ticket.numero),
    cuerpo: cliente ? `${cliente} · ${ticket.asunto}` : ticket.asunto,
    ticketId: ticket.id,
  });
}

// ------------------------------------------------------------------ subtareas (revisión QA)

export type SubtareaFila = {
  id: string;
  ticket_id: string;
  numero: number;
  tipo: string;
  titulo: string;
  estado: string;
  asignado_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  finalizado_at: string | null;
};

export const SUBTAREA_CAMPOS = "id, ticket_id, numero, tipo, titulo, estado, asignado_id, created_by, created_at, updated_at, finalizado_at";

export async function subtareasSinFinalizar(ctx: TenantContext, ticketId: string): Promise<SubtareaFila[]> {
  const { data } = await ctx.db.select("soporte_subtareas", SUBTAREA_CAMPOS).eq("ticket_id", ticketId);
  return filas<SubtareaFila>(data).filter((s) => subtareaAbierta(s.estado));
}

/**
 * Al pasar a "Listo para revisión": deja lista la revisión de QA y le avisa.
 *   · Si hay una pendiente o en proceso, se usa esa.
 *   · Si no, se crea "Revisión QA #N", para la misma persona de QA que la
 *     devolvió la vez anterior (o la primera QA de la empresa).
 */
export async function abrirRevisionQa(ctx: TenantContext, ticket: { id: string; numero: number; asunto: string }): Promise<SubtareaFila | null> {
  const [{ data: previas }, equipo] = await Promise.all([
    ctx.db.select("soporte_subtareas", SUBTAREA_CAMPOS).eq("ticket_id", ticket.id).order("numero", { ascending: false }),
    personasDeEmpresa(ctx),
  ]);
  const todas = filas<SubtareaFila>(previas);
  const enCurso = todas.find((s) => subtareaAbierta(s.estado));
  if (enCurso) return enCurso;

  const numero = (todas[0]?.numero ?? 0) + 1;
  const devuelta = todas.find((s) => s.estado === "cambios_solicitados") ?? null;
  const qaDevolvio = devuelta?.asignado_id ? equipo.find((p) => p.id === devuelta.asignado_id && p.es_qa) : null;
  const qa = qaDevolvio ?? equipo.find((p) => p.es_qa) ?? null;

  const { data, error } = await ctx.db.insert("soporte_subtareas", {
    ticket_id: ticket.id,
    numero,
    tipo: "revision_qa",
    titulo: `Revisión QA #${numero}`,
    estado: "pendiente",
    asignado_id: qa?.id ?? null,
    created_by: ctx.usuarioId,
  });
  const sub = filas<SubtareaFila>(data)[0];
  if (error || !sub) {
    console.error("[soporte] no se pudo abrir la revisión", error?.message);
    return null;
  }
  await registrarHistorial(ctx, ticket.id, [
    { tipo_evento: "subtarea_creada", valor_nuevo: sub.titulo, metadata: { subtarea_id: sub.id, asignado_id: sub.asignado_id, reentrega: !!devuelta } },
  ]);
  await notificar(ctx, {
    usuarioId: sub.asignado_id,
    titulo: devuelta
      ? `Ticket ${numeroTicket(ticket.numero)} corregido, listo para revisar de nuevo`
      : `Ticket ${numeroTicket(ticket.numero)} listo para revisión`,
    cuerpo: ticket.asunto,
    ticketId: ticket.id,
  });
  return sub;
}
