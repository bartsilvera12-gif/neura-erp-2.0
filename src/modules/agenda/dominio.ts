/**
 * Agenda — tipos y reglas compartidas (isomórfico). Portado de lib/agenda/types.ts del
 * sistema actual. Sin CRM: una cita es contra un cliente o contra un contacto libre
 * (nombre + teléfono); no hay prospecto_id.
 */

export const AGENDA_ESTADOS = [
  "pendiente",
  "confirmada",
  "completada",
  "no_asistio",
  "cancelada",
  "reprogramada",
] as const;

export type AgendaEstado = (typeof AGENDA_ESTADOS)[number];

/** Estados que NO ocupan el horario del responsable (no bloquean disponibilidad). */
export const ESTADOS_NO_BLOQUEAN: ReadonlySet<string> = new Set<string>(["cancelada", "reprogramada"]);

/** Estados terminales: no admiten más transiciones. */
export const ESTADOS_TERMINALES: ReadonlySet<string> = new Set<string>([
  "completada",
  "no_asistio",
  "cancelada",
  "reprogramada",
]);

export function isAgendaEstado(v: unknown): v is AgendaEstado {
  return typeof v === "string" && (AGENDA_ESTADOS as readonly string[]).includes(v);
}

/** Tipo de cita de las capacitaciones que salen de una tipificación. */
export const TIPO_CITA_CAPACITACION = "capacitacion";

/** Tipos de cita sugeridos (los genéricos del actual; demo/consulta/servicio eran de Neura). */
export const TIPOS_CITA = ["reunion", "llamada", "visita", "seguimiento", "capacitacion", "otro"];

export type AgendaCitaRow = {
  id: string;
  empresa_id: string;
  cliente_id: string | null;
  responsable_id: string;
  contacto_nombre: string | null;
  contacto_telefono: string | null;
  titulo: string;
  tipo: string | null;
  estado: AgendaEstado;
  inicio_at: string;
  fin_at: string;
  ubicacion: string | null;
  observaciones: string | null;
  reprogramada_de_id: string | null;
  cancelada_motivo: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AgendaUsuarioRef = { id: string; nombre?: string | null };

/** Cita enriquecida con datos de cliente y responsables para la UI. */
export type AgendaCitaEnriquecida = AgendaCitaRow & {
  cliente?: { id: string; nombre?: string | null; telefono?: string | null } | null;
  /** Responsable PRINCIPAL (`responsable_id`). */
  responsable?: AgendaUsuarioRef | null;
  /** Todos los responsables, el principal incluido y siempre primero. */
  responsables?: AgendaUsuarioRef[];
  /** Quién cargó la cita (`created_by`), para mostrarlo en la ficha. */
  creado_por?: AgendaUsuarioRef | null;
  /** ¿El usuario de la sesión puede cambiarla? (ADMIN, responsable o quien la cargó). */
  puede_editar?: boolean;
};

// ── Nombres (portado de lib/format/nombres) ─────────────────────────────────
const PARTICULAS = new Set(["de", "del", "la", "las", "los", "da", "do", "dos", "y", "e"]);

/** Los nombres vienen en MAYÚSCULAS del catálogo: se muestran en capitular. */
export function nombreCapitular(name: string | null | undefined): string {
  const limpio = (name ?? "").trim();
  if (!limpio) return "—";
  // Si ya viene en mixto se respeta tal cual.
  if (limpio !== limpio.toUpperCase()) return limpio;
  return limpio
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && PARTICULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Iniciales para un avatar: dos letras a partir del nombre y el apellido. */
export function inicialesNombre(name: string | null | undefined): string {
  const limpio = (name ?? "").trim();
  if (!limpio) return "?";
  const partes = limpio.split(/\s+/).filter(Boolean);
  if (partes.length >= 2) return `${partes[0][0]}${partes[1][0]}`.toUpperCase();
  return limpio.slice(0, 2).toUpperCase();
}
