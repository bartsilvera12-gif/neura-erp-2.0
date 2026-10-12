/**
 * Tipificación — lado servidor. Solo servidor (detrás de withTenant).
 * La agenda de capacitaciones (validación, anti-doble-reserva, alta) vive en el módulo
 * Agenda y el aviso en la campanita en Notificaciones; se re-exportan acá.
 */
import type { TenantDb } from "@/lib/api/tenant-db";
import { HORARIO_DEFECTO, type Horario, type PersonaEquipo } from "@/modules/tipificacion/dominio";
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
