/**
 * Agenda — lado servidor. Solo servidor (detrás de withTenant).
 * Portado de lib/agenda/{solapes,responsables,enrich,capacitacion}.ts del sistema actual.
 * Lo usan /api/agenda/** y la Tipificación (capacitaciones).
 */
import type { TenantDb } from "@/lib/api/tenant-db";
import { TZ_PY } from "@/lib/fecha/paraguay";
import { notificar } from "@/modules/notificaciones/server";
import {
  TIPO_CITA_CAPACITACION, type AgendaCitaEnriquecida, type AgendaCitaRow, type AgendaUsuarioRef,
} from "@/modules/agenda/dominio";
import {
  HORARIO_DEFECTO, fechaLocalAIso, isoAFechaLocal, mensajeHorario, rangoEnHorarioLaboral, type Horario,
} from "@/modules/agenda/horario";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uniq = (ids: (string | null | undefined)[]): string[] =>
  [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];

// ── Horario laboral ──────────────────────────────────────────────────────────
/** Horario laboral de la empresa (soporte_config); el de por defecto si no hay fila. */
export async function leerHorario(db: TenantDb): Promise<Horario> {
  const { data } = await db.select("soporte_config", "hora_inicio, hora_fin, sabado_hasta").limit(1);
  const c = (data?.[0] ?? null) as unknown as { hora_inicio: number; hora_fin: number; sabado_hasta: number } | null;
  if (!c) return HORARIO_DEFECTO;
  return {
    hora_inicio: Number(c.hora_inicio ?? HORARIO_DEFECTO.hora_inicio),
    hora_fin: Number(c.hora_fin ?? HORARIO_DEFECTO.hora_fin),
    sabado_hasta: Number(c.sabado_hasta ?? HORARIO_DEFECTO.sabado_hasta),
  };
}

// ── Anti-doble-reserva ───────────────────────────────────────────────────────
export type CitaConflicto = { id: string; titulo: string | null; inicio_at: string; fin_at: string; estado: string };

/**
 * Una cita ACTIVA del mismo responsable (principal) cuyo rango [inicio, fin) se solape con
 * el propuesto (a.inicio < b.fin && a.fin > b.inicio). Canceladas y reprogramadas no ocupan
 * horario. `excluirId` ignora la propia cita al editar/reprogramar.
 */
export async function buscarConflictoHorario(
  db: TenantDb,
  args: { responsableId: string; inicioIso: string; finIso: string; excluirId?: string | null },
): Promise<CitaConflicto | null> {
  let q = db
    .select("agenda_citas", "id, titulo, inicio_at, fin_at, estado")
    .eq("responsable_id", args.responsableId)
    .not("estado", "in", "(cancelada,reprogramada)")
    .lt("inicio_at", args.finIso)
    .gt("fin_at", args.inicioIso)
    .order("inicio_at", { ascending: true })
    .limit(1);
  if (args.excluirId) q = q.neq("id", args.excluirId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data?.[0] ?? null) as unknown as CitaConflicto | null;
}

/** Mensaje 409 legible a partir de un conflicto. */
export function mensajeConflicto(c: CitaConflicto): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? "?"
      : d.toLocaleString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  };
  return `El responsable ya tiene una cita en ese horario: "${c.titulo?.trim() || "otra cita"}" (${fmt(c.inicio_at)} – ${fmt(c.fin_at)}).`;
}

// ── Responsables (agenda_cita_responsables) ─────────────────────────────────
/** Responsables de varias citas, indexados por cita_id. */
export async function responsablesPorCita(db: TenantDb, citaIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (citaIds.length === 0) return out;
  const { data, error } = await db.select("agenda_cita_responsables", "cita_id, usuario_id").in("cita_id", citaIds);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as unknown as { cita_id: string; usuario_id: string }[]) {
    const arr = out.get(row.cita_id) ?? [];
    arr.push(row.usuario_id);
    out.set(row.cita_id, arr);
  }
  return out;
}

/**
 * Deja la lista de responsables de una cita EXACTAMENTE en `usuarioIds`, con el principal
 * forzado adentro (la columna responsable_id es la que usan disponibilidad y
 * anti-doble-reserva: las dos representaciones no pueden contradecirse).
 * Borra e inserta en vez de calcular el diff: son pocas filas por cita.
 */
export async function guardarResponsables(db: TenantDb, citaId: string, principalId: string, usuarioIds: string[]): Promise<void> {
  const ids = uniq([principalId, ...usuarioIds]);
  const del = await db.delete("agenda_cita_responsables").eq("cita_id", citaId);
  if (del.error) throw new Error(del.error.message);
  if (!ids.length) return;
  const ins = await db.insert("agenda_cita_responsables", ids.map((usuario_id) => ({ cita_id: citaId, usuario_id })));
  if (ins.error) throw new Error(ins.error.message);
}

/** Ids de las citas en las que participa un usuario como responsable (filtro por responsable). */
export async function citaIdsDeUsuario(db: TenantDb, usuarioId: string): Promise<string[]> {
  const { data, error } = await db.select("agenda_cita_responsables", "cita_id").eq("usuario_id", usuarioId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as { cita_id: string }[]).map((r) => r.cita_id);
}

/** De los ids recibidos, los que son usuarios ACTIVOS de la empresa (en el mismo orden). */
export async function usuariosValidos(db: TenantDb, ids: string[]): Promise<string[]> {
  const pedidos = uniq(ids).filter((id) => UUID_RE.test(id));
  if (!pedidos.length) return [];
  const { data } = await db.select("usuarios", "id, activo").in("id", pedidos);
  const ok = new Set(((data ?? []) as unknown as { id: string; activo: boolean | null }[]).filter((u) => u.activo !== false).map((u) => u.id));
  return pedidos.filter((id) => ok.has(id));
}

/** ¿El cliente existe en la empresa (y no está borrado)? */
export async function clienteExiste(db: TenantDb, clienteId: string): Promise<boolean> {
  if (!UUID_RE.test(clienteId)) return false;
  const { data } = await db.select("clientes", "id").eq("id", clienteId).is("deleted_at", null).limit(1);
  return !!data?.length;
}

// ── Permisos ─────────────────────────────────────────────────────────────────
/** Puede cambiar la cita: ADMIN, quien la cargó o cualquiera de sus responsables. */
export function puedeModificar(
  yo: { usuarioId: string; rol: string },
  cita: { responsable_id: string | null; created_by: string | null },
  responsables: string[] = [],
): boolean {
  return yo.rol === "ADMIN" || cita.created_by === yo.usuarioId || cita.responsable_id === yo.usuarioId || responsables.includes(yo.usuarioId);
}

// ── Enriquecido para la UI ──────────────────────────────────────────────────
/** Agrega cliente, responsables (el principal primero), quién la cargó y si la podés cambiar. */
export async function enrichAgendaRows(
  db: TenantDb,
  rows: AgendaCitaRow[],
  yo?: { usuarioId: string; rol: string },
): Promise<AgendaCitaEnriquecida[]> {
  if (rows.length === 0) return [];
  const extras = await responsablesPorCita(db, rows.map((r) => r.id));
  const clienteIds = uniq(rows.map((r) => r.cliente_id));
  const userIds = uniq([...rows.map((r) => r.responsable_id), ...rows.map((r) => r.created_by), ...[...extras.values()].flat()]);

  const [clientesR, usersR] = await Promise.all([
    clienteIds.length ? db.select("clientes", "id, nombre, telefono").in("id", clienteIds) : Promise.resolve({ data: [] as unknown[] }),
    userIds.length ? db.select("usuarios", "id, nombre").in("id", userIds) : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const clientes = new Map(((clientesR.data ?? []) as { id: string; nombre: string | null; telefono: string | null }[]).map((c) => [c.id, c]));
  const usuarios = new Map(((usersR.data ?? []) as { id: string; nombre: string | null }[]).map((u) => [u.id, u]));
  const ref = (id: string): AgendaUsuarioRef => ({ id, nombre: usuarios.get(id)?.nombre ?? null });

  return rows.map((r) => {
    const c = r.cliente_id ? clientes.get(r.cliente_id) : undefined;
    const idsExtra = extras.get(r.id) ?? [];
    const responsables = uniq([r.responsable_id, ...idsExtra]);
    return {
      ...r,
      metadata: r.metadata ?? {},
      cliente: r.cliente_id ? { id: r.cliente_id, nombre: c?.nombre ?? null, telefono: c?.telefono ?? null } : null,
      responsable: r.responsable_id ? ref(r.responsable_id) : null,
      responsables: responsables.map(ref),
      creado_por: r.created_by ? ref(r.created_by) : null,
      puede_editar: yo ? puedeModificar(yo, r, responsables) : undefined,
    };
  });
}

// ── Avisos en la campanita ───────────────────────────────────────────────────
/** "21/08 10:00" en hora de Paraguay. */
export function diaHoraCorta(iso: string): string {
  const l = isoAFechaLocal(iso);
  return l ? `${l.slice(8, 10)}/${l.slice(5, 7)} ${l.slice(11, 16)}` : "";
}

/**
 * Avisa en la campanita (bandeja General) a cada responsable NUEVO de la cita, salvo a
 * quien hizo el cambio. Nunca hace fallar la operación.
 */
export async function avisarResponsables(
  db: TenantDb,
  empresaId: string,
  args: {
    cita: { id: string; titulo: string; inicio_at: string };
    usuarioIds: string[];
    actorId: string;
    motivo: "nueva" | "asignada" | "reprogramada";
  },
): Promise<void> {
  const destino = uniq(args.usuarioIds).filter((id) => id !== args.actorId);
  if (!destino.length) return;
  let actor = "";
  try {
    const { data } = await db.select("usuarios", "nombre").eq("id", args.actorId).limit(1);
    actor = String((data?.[0] as { nombre?: string } | undefined)?.nombre ?? "");
  } catch {
    /* sin nombre */
  }
  const titulo =
    args.motivo === "reprogramada" ? `Cita reprogramada: ${args.cita.titulo}` :
    args.motivo === "asignada" ? `Te sumaron a una cita: ${args.cita.titulo}` :
    `Nueva cita: ${args.cita.titulo}`;
  const cuerpo = [diaHoraCorta(args.cita.inicio_at), actor ? `por ${actor}` : null].filter(Boolean).join(" · ");
  await Promise.all(
    destino.map((usuarioId) =>
      notificar(db, empresaId, { usuarioId, tipo: "agenda", bandeja: "general", titulo, cuerpo, url: `/clientes/agenda?cita=${args.cita.id}` }),
    ),
  );
}

// ── Capacitaciones (desde la Tipificación) ──────────────────────────────────
export type AgendaCapacitacion = { inicioIso: string; finIso: string; responsableId: string; ubicacion: string | null };

/** Lee y valida la agenda del formulario de tipificación. `inicio` llega como `YYYY-MM-DDTHH:mm` (hora de Paraguay). */
export function leerAgendaCapacitacion(
  v: unknown,
  equipo: { id: string }[],
  horario: Horario,
): { ok: true; agenda: AgendaCapacitacion } | { ok: false; mensaje: string } {
  if (!v || typeof v !== "object") return { ok: false, mensaje: "Completá la fecha de la capacitación" };
  const a = v as Record<string, unknown>;
  const inicioIso = typeof a.inicio === "string" ? fechaLocalAIso(a.inicio) : undefined;
  if (!inicioIso) return { ok: false, mensaje: "Elegí fecha y hora de la capacitación" };
  const duracion = Number(a.duracion_min);
  if (!Number.isFinite(duracion) || duracion < 15 || duracion > 8 * 60) return { ok: false, mensaje: "Duración inválida" };
  const responsableId = typeof a.responsable_id === "string" ? a.responsable_id : "";
  if (!equipo.some((p) => p.id === responsableId)) return { ok: false, mensaje: "Elegí quién da la capacitación" };
  const ubicacion = typeof a.ubicacion === "string" && a.ubicacion.trim() ? a.ubicacion.trim().slice(0, 500) : null;
  const finIso = new Date(Date.parse(inicioIso) + duracion * 60_000).toISOString();
  if (!rangoEnHorarioLaboral(Date.parse(inicioIso), Date.parse(finIso), horario)) return { ok: false, mensaje: mensajeHorario(horario) };
  return { ok: true, agenda: { inicioIso, finIso, responsableId, ubicacion } };
}

/**
 * Agenda la capacitación en agenda_citas, vinculada al cliente. Respeta la regla de Agenda
 * (el responsable no puede tener otra cita activa en ese horario → 409) y aparece en la
 * Agenda con sus recordatorios (60 y 30 min antes) como cualquier cita.
 */
export async function agendarCapacitacion(
  db: TenantDb,
  args: { clienteId: string; clienteNombre: string; agenda: AgendaCapacitacion; observaciones: string; creadoPor: string },
): Promise<{ ok: true; id: string } | { ok: false; mensaje: string; status: number }> {
  const conflicto = await buscarConflictoHorario(db, {
    responsableId: args.agenda.responsableId,
    inicioIso: args.agenda.inicioIso,
    finIso: args.agenda.finIso,
  });
  if (conflicto) return { ok: false, mensaje: mensajeConflicto(conflicto), status: 409 };

  const { data, error } = await db.insert("agenda_citas", {
    cliente_id: args.clienteId,
    responsable_id: args.agenda.responsableId,
    titulo: `Capacitación · ${args.clienteNombre}`.slice(0, 200),
    tipo: TIPO_CITA_CAPACITACION,
    estado: "pendiente",
    inicio_at: args.agenda.inicioIso,
    fin_at: args.agenda.finIso,
    ubicacion: args.agenda.ubicacion,
    observaciones: args.observaciones,
    metadata: { origen: "tipificacion" },
    created_by: args.creadoPor,
    updated_by: args.creadoPor,
  });
  const fila = (data?.[0] ?? null) as { id?: string } | null;
  if (error || !fila?.id) return { ok: false, mensaje: error?.message ?? "No se pudo agendar la capacitación", status: 400 };
  const id = String(fila.id);
  await guardarResponsables(db, id, args.agenda.responsableId, []).catch((e: Error) => console.error("[agenda] responsables", e.message));
  return { ok: true, id };
}
