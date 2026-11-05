/** Rubro Gimnasio (receta 150): lo que devuelven las funciones gim_* de la base. */

export type EstadoAsistencia = "pendiente" | "confirmada" | "cancelada" | "reagendada" | "en_espera" | "culminada" | "no_asistio";

export const ESTADOS_ASISTENCIA: Record<EstadoAsistencia, { label: string; clase: string }> = {
  pendiente: { label: "Pendiente", clase: "bg-slate-100 text-slate-600" },
  confirmada: { label: "Confirmada", clase: "bg-sky-50 text-sky-800" },
  en_espera: { label: "En espera", clase: "bg-amber-50 text-amber-800" },
  culminada: { label: "Culminada", clase: "bg-emerald-50 text-emerald-800" },
  no_asistio: { label: "No asistió", clase: "bg-rose-50 text-rose-700" },
  cancelada: { label: "Cancelada", clase: "bg-slate-100 text-slate-400 line-through" },
  reagendada: { label: "Reagendada", clase: "bg-violet-50 text-violet-800" },
};

/** Qué se puede hacer desde cada estado (la base lo vuelve a controlar). */
export const SIGUIENTES: Record<EstadoAsistencia, EstadoAsistencia[]> = {
  pendiente: ["confirmada", "en_espera", "culminada", "no_asistio", "reagendada", "cancelada"],
  confirmada: ["en_espera", "culminada", "no_asistio", "reagendada", "cancelada"],
  en_espera: ["culminada", "no_asistio", "cancelada"],
  culminada: [],
  no_asistio: [],
  cancelada: [],
  reagendada: [],
};

export type Asistencia = {
  id: string;
  cita_id: string | null;
  cliente_id: string;
  cliente: string;
  documento: string | null;
  fecha: string;
  estado: EstadoAsistencia;
  cubierta: boolean;
  venta_id: string | null;
  valor: number | null;
  forzada: boolean;
  llegada_at: string | null;
  culminada_at: string | null;
  clase: string;
  inicio_at: string | null;
  fin_at: string | null;
  profesor: string | null;
  /** solo en el día: debe y la empresa bloquea */
  bloqueado?: boolean;
};

export type ClaseDia = {
  cita_id: string;
  clase_id: string | null;
  titulo: string;
  inicio_at: string;
  fin_at: string;
  estado: string;
  profesor: string | null;
  ubicacion: string | null;
  individual: boolean;
  cupo: number | null;
  ocupados: number;
  alumnos: Asistencia[];
};

export type Dia = { fecha: string; clases: ClaseDia[]; libres: Asistencia[] };

export type FichaAlumno = {
  cliente: { id: string; nombre: string; documento: string | null; telefono: string | null };
  deuda_vencida: number;
  deuda_total: number;
  bloqueado: boolean;
  membresia: { suscripcion_id: string; plan: string; precio: number; clases_mes: number | null; usadas: number; restantes: number | null } | null;
  proximas: Asistencia[];
  historial: Asistencia[];
  mes: { culminadas: number; faltas: number };
};

export type Clase = {
  id: string;
  nombre: string;
  profesor_id: string | null;
  profesor: string | null;
  dias: number[];
  hora: string;
  duracion_min: number;
  cupo: number | null;
  precio_suelta: number | null;
  ubicacion: string | null;
  desde: string;
  hasta: string | null;
  activa: boolean;
};

export type ConfigGim = {
  precio_clase_suelta: number;
  tipo_iva: "10%" | "5%" | "exenta";
  bloquear_morosos: boolean;
  comision_modo: "ninguna" | "por_alumno" | "por_clase" | "porcentaje";
  comision_monto: number;
  comision_pct: number;
  puede_administrar: boolean;
  puede_forzar: boolean;
};

export type ComisionProfesor = { profesor_id: string; profesor: string; clases: number; alumnos: number; valor: number; comision: number };

export const DIAS: [number, string, string][] = [[1, "Lun", "Lunes"], [2, "Mar", "Martes"], [3, "Mié", "Miércoles"], [4, "Jue", "Jueves"], [5, "Vie", "Viernes"], [6, "Sáb", "Sábado"], [7, "Dom", "Domingo"]];

export const gs = (n: number | null | undefined) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
export const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Asuncion" }) : "");
