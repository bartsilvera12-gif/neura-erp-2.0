/**
 * Tipificación — lado servidor. Solo servidor (detrás de withTenant).
 * Portado de lib/agenda/capacitacion.ts + solapes.ts y del aviso de Soporte del actual.
 */
import type { TenantDb } from "@/lib/api/tenant-db";
import { TZ_PY } from "@/lib/fecha/paraguay";
import {
  HORARIO_DEFECTO, fechaLocalAIso, mensajeHorario, rangoEnHorarioLaboral, type Horario, type PersonaEquipo,
} from "@/modules/tipificacion/dominio";

export const TIPO_CITA_CAPACITACION = "capacitacion";
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Id que sigue a `segmento` en la URL (/api/clientes/<id>/…). */
export function idDeRuta(req: { url: string }, segmento: string): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf(segmento);
  const v = i >= 0 ? segs[i + 1] : null;
  return v && UUID_RE.test(v) ? v : null;
}

type Config = { horario: Horario; responsable_defecto_id: string | null };

/** soporte_config de la empresa (horario laboral + responsable por defecto). */
export async function leerConfig(db: TenantDb): Promise<Config> {
  const { data } = await db.select("soporte_config", "hora_inicio, hora_fin, sabado_hasta, responsable_defecto_id").limit(1);
  const c = (data?.[0] ?? null) as unknown as { hora_inicio: number; hora_fin: number; sabado_hasta: number; responsable_defecto_id: string | null } | null;
  if (!c) return { horario: HORARIO_DEFECTO, responsable_defecto_id: null };
  return {
    horario: { hora_inicio: Number(c.hora_inicio ?? 8), hora_fin: Number(c.hora_fin ?? 17), sabado_hasta: Number(c.sabado_hasta ?? 12) },
    responsable_defecto_id: c.responsable_defecto_id ?? null,
  };
}

type UsuarioFila = { id: string; nombre: string; rol: string; activo: boolean; es_tecnico: boolean | null; es_qa: boolean | null; usa_soporte: boolean | null };

/** Equipo de la empresa (usuarios activos) + la fila del usuario actual. */
export async function leerEquipo(db: TenantDb, usuarioId: string): Promise<{ equipo: PersonaEquipo[]; yo: UsuarioFila | null }> {
  const { data } = await db.select("usuarios", "id, nombre, rol, activo, es_tecnico, es_qa, usa_soporte").order("nombre");
  const filas = (data ?? []) as unknown as UsuarioFila[];
  return {
    equipo: filas.filter((u) => u.activo !== false).map((u) => ({ id: u.id, nombre: u.nombre, rol: u.rol })),
    yo: filas.find((u) => u.id === usuarioId) ?? null,
  };
}

/** Quién puede escalar a Soporte desde una tipificación: ADMIN o quien usa Soporte. */
export function puedeCargarSoporte(rol: string, yo: UsuarioFila | null): boolean {
  return rol === "ADMIN" || yo?.usa_soporte === true || yo?.es_tecnico === true || yo?.es_qa === true;
}

// ── Agenda de capacitaciones ─────────────────────────────────────────────────
export type AgendaCapacitacion = { inicioIso: string; finIso: string; responsableId: string; ubicacion: string | null };

/** Lee y valida la agenda del formulario. `inicio` llega como `YYYY-MM-DDTHH:mm` (hora de Paraguay). */
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

type CitaConflicto = { id: string; titulo: string | null; inicio_at: string; fin_at: string; estado: string };

/**
 * Anti-doble-reserva: una cita ACTIVA del mismo responsable que se solape con el rango
 * (a.inicio < b.fin && a.fin > b.inicio). Canceladas y reprogramadas no ocupan horario.
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
  return ((data?.[0] ?? null) as unknown as CitaConflicto | null);
}

export function mensajeConflicto(c: CitaConflicto): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? "?"
      : d.toLocaleString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  };
  return `El responsable ya tiene una cita en ese horario: "${c.titulo?.trim() || "otra cita"}" (${fmt(c.inicio_at)} – ${fmt(c.fin_at)}).`;
}

/** Agenda la capacitación en agenda_citas, vinculada al cliente. 409 si choca. */
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
  });
  const fila = (data?.[0] ?? null) as { id?: string } | null;
  if (error || !fila?.id) return { ok: false, mensaje: error?.message ?? "No se pudo agendar la capacitación", status: 400 };
  return { ok: true, id: String(fila.id) };
}

// ── Notificaciones ───────────────────────────────────────────────────────────
/**
 * Inserta un aviso en la campanita de OTRO usuario. Sin `.select()`: la RLS de
 * usuario_notificaciones sólo deja LEER las propias, y pedir la fila insertada
 * haría fallar el insert. Nunca hace fallar la operación que avisa.
 */
export async function notificar(
  db: TenantDb,
  empresaId: string,
  n: { usuarioId: string; tipo: string; bandeja: "general" | "soporte"; titulo: string; cuerpo?: string | null; url?: string | null },
): Promise<void> {
  try {
    const { error } = await db.unsafeRaw().from("usuario_notificaciones").insert({
      empresa_id: empresaId,
      usuario_id: n.usuarioId,
      tipo: n.tipo,
      bandeja: n.bandeja,
      titulo: n.titulo.slice(0, 200),
      cuerpo: n.cuerpo ? n.cuerpo.slice(0, 500) : null,
      url: n.url ?? null,
    });
    if (error) console.error("[notificar]", error.message);
  } catch (e) {
    console.error("[notificar]", (e as Error)?.message);
  }
}
