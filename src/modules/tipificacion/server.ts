/**
 * Tipificación — lado servidor. Solo servidor (detrás de withTenant).
 * La agenda de capacitaciones (validación, anti-doble-reserva, alta) vive en el módulo
 * Agenda y el aviso en la campanita en Notificaciones; se re-exportan acá.
 */
import type { TenantDb } from "@/lib/api/tenant-db";
import {
  HORARIO_DEFECTO, type Horario, type PersonaEquipo, type RegistroTipificaciones, type TipificacionRegistro,
} from "@/modules/tipificacion/dominio";
import { UUID_RE } from "@/modules/agenda/server";

export {
  UUID_RE, agendarCapacitacion, buscarConflictoHorario, leerAgendaCapacitacion, mensajeConflicto, type AgendaCapacitacion,
} from "@/modules/agenda/server";
export { TIPO_CITA_CAPACITACION } from "@/modules/agenda/dominio";
export { notificar } from "@/modules/notificaciones/server";

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

/** Filtros del registro (receta 81). Lo que no vale, no se manda. */
export type FiltrosRegistro = {
  q?: string | null; desde?: string | null; hasta?: string | null; familia?: string | null; usuario?: string | null;
  accion?: string | null; cliente?: string | null; id?: string | null; limite?: number; offset?: number;
};
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const ACCIONES_REGISTRO = new Set(["ticket", "capacitacion", "ninguna"]);

/** Lee los filtros del registro desde la URL (?q&desde&hasta&familia&usuario&accion&pagina&por). */
export function filtrosDesdeUrl(sp: URLSearchParams): FiltrosRegistro {
  const por = Math.min(Math.max(Number(sp.get("por")) || 25, 1), 100);
  const pagina = Math.max(Number(sp.get("pagina")) || 1, 1);
  return {
    q: sp.get("q")?.trim().slice(0, 200) || null,
    desde: sp.get("desde") ?? null,
    hasta: sp.get("hasta") ?? null,
    familia: sp.get("familia") ?? null,
    usuario: sp.get("usuario") ?? null,
    accion: sp.get("accion") ?? null,
    limite: por,
    offset: (pagina - 1) * por,
  };
}

/** tipificaciones_registro: UNA consulta con cliente, ticket y capacitación en vivo. */
export async function leerRegistro(db: TenantDb, f: FiltrosRegistro): Promise<RegistroTipificaciones> {
  const p: Record<string, unknown> = {};
  if (f.q) p.q = f.q;
  if (f.desde && FECHA_RE.test(f.desde)) p.desde = f.desde;
  if (f.hasta && FECHA_RE.test(f.hasta)) p.hasta = f.hasta;
  for (const k of ["familia", "usuario", "cliente", "id"] as const) if (f[k] && UUID_RE.test(f[k]!)) p[k] = f[k];
  if (f.accion && ACCIONES_REGISTRO.has(f.accion)) p.accion = f.accion;
  if (f.limite) p.limite = f.limite;
  if (f.offset) p.offset = f.offset;
  const { data, error } = await db.rpc<RegistroTipificaciones>("tipificaciones_registro", { p });
  if (error || !data) throw new Error(error?.message ?? "No se pudo leer el registro de tipificaciones");
  return { total: Number(data.total) || 0, filas: (data.filas ?? []).map((t) => ({ ...t, ticket: t.ticket ? { ...t.ticket, numero: Number(t.ticket.numero) } : null })) };
}

/** Una tipificación con su cliente, ticket y capacitación (para devolverla recién creada). */
export async function leerFila(db: TenantDb, id: string): Promise<TipificacionRegistro | null> {
  try {
    return (await leerRegistro(db, { id, limite: 1 })).filas[0] ?? null;
  } catch {
    return null;
  }
}
