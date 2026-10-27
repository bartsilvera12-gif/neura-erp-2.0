/**
 * Conversaciones · fase 2 — dominio isomórfico de Monitoreo, Finalizadas, Historial
 * omnicanal, presencia del asesor y colas (lo usan la API y las pantallas).
 * Las formas salen de las funciones de base de 38_conversaciones_colas.sql.
 */

// ── Presencia del asesor ─────────────────────────────────────────────────────
export type EstadoAgente = "disponible" | "ocupado" | "pausa" | "desconectado";
export const ESTADOS_ELEGIBLES: { id: Exclude<EstadoAgente, "desconectado">; label: string; detalle: string }[] = [
  { id: "disponible", label: "Disponible", detalle: "Recibís chats nuevos automáticamente." },
  { id: "ocupado", label: "Ocupado", detalle: "Seguís con tus chats, pero no te llegan nuevos." },
  { id: "pausa", label: "En pausa", detalle: "Descanso: no te llegan chats nuevos." },
];
export const ESTADO_AGENTE_LABEL: Record<EstadoAgente, string> = {
  disponible: "Disponible",
  ocupado: "Ocupado",
  pausa: "En pausa",
  desconectado: "Desconectado",
};
export const ESTADO_AGENTE_CLASE: Record<EstadoAgente, { pill: string; dot: string }> = {
  disponible: { pill: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  ocupado: { pill: "border-amber-200 bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  pausa: { pill: "border-sky-200 bg-sky-50 text-sky-700", dot: "bg-sky-500" },
  desconectado: { pill: "border-slate-200 bg-slate-50 text-slate-500", dot: "bg-slate-400" },
};
export const esEstadoAgente = (v: unknown): v is EstadoAgente =>
  v === "disponible" || v === "ocupado" || v === "pausa" || v === "desconectado";

/** Cada cuánto late la bandeja / el monitoreo (la base da "en línea" hasta 90 s). */
export const LATIDO_MS = 30_000;

// ── Monitoreo (chat_monitoreo + lo que agrega la API) ───────────────────────
export type ResumenMonitoreo = {
  abiertas: number;
  sin_asignar: number;
  esperando_respuesta: number;
  sla_vencidos: number;
  fuera_de_ventana: number;
  agentes_online: number;
  nuevos_hoy: number;
  cerradas_hoy: number;
};

export type MotivoEspera = "sin_cola" | "sin_agente" | "cola_manual" | null;

export type SinAsignar = {
  id: string;
  contacto: string | null;
  telefono: string | null;
  canal: string | null;
  canal_tipo: string | null;
  cola: string | null;
  ultimo_mensaje_at: string | null;
  preview: string | null;
  motivo: MotivoEspera;
};

export type Esperando = {
  id: string;
  contacto: string | null;
  telefono: string | null;
  canal: string | null;
  asignado_id: string;
  desde: string | null;
  preview: string | null;
  sla_vence_at: string | null;
};

export type AgenteMonitoreo = {
  id: string;
  nombre: string;
  estado: EstadoAgente;
  online: boolean;
  ultimo_latido_at: string | null;
  carga: number;
  esperando_respuesta: number;
  sla_vencidos: number;
  asignadas_hoy: number;
  cerradas_hoy: number;
  colas: string[] | null;
  /** Asignaciones automáticas del día elegido (chat_asignaciones_dia). */
  leads: number;
};

export type DatosMonitoreo = {
  resumen: ResumenMonitoreo;
  sin_asignar: SinAsignar[];
  esperando: Esperando[];
  agentes: AgenteMonitoreo[];
  fecha_leads: string;
  es_admin: boolean;
  /** Supervisor con equipo asignado: los asesores y chats en espera son solo los de su equipo. */
  equipo_limitado?: boolean;
};

/** Chats asignados a un asesor en un día (detalle de "Leads del día"). */
export type LeadDia = {
  id: string;
  contacto: string | null;
  telefono: string | null;
  canal: string | null;
  estado: "abierta" | "pendiente" | "cerrada";
  asignada_at: string | null;
  ultimo_mensaje_at: string | null;
  ultimo_preview: string | null;
  primera_respuesta_seg: number | null;
  sin_respuesta: boolean;
};

/** Agente para el modal Transferir (punto en línea + carga). */
export type AgenteCarga = { id: string; estado: EstadoAgente; online: boolean; carga: number };

export const MOTIVO_LABEL: Record<string, { label: string; clase: string }> = {
  sin_agente: { label: "Sin agentes listos", clase: "text-amber-900 bg-amber-50 border-amber-200" },
  cola_manual: { label: "Asignación manual", clase: "text-indigo-900 bg-indigo-50 border-indigo-200" },
  sin_cola: { label: "Sin cola", clase: "text-slate-700 bg-slate-50 border-slate-200" },
};
export function motivoEspera(m: MotivoEspera, cola: string | null) {
  if (m && MOTIVO_LABEL[m]) return MOTIVO_LABEL[m];
  return cola ? { label: "En cola", clase: "text-slate-700 bg-slate-50 border-slate-200" } : MOTIVO_LABEL.sin_cola;
}

// ── Finalizadas (chat_finalizadas) ──────────────────────────────────────────
export type Finalizada = {
  id: string;
  cerrada_at: string;
  cierre_observacion: string | null;
  etiquetas: string[] | null;
  created_at: string;
  primera_respuesta_at: string | null;
  contacto_nombre: string | null;
  contacto_telefono: string | null;
  cliente_id: string | null;
  cerrada_por_nombre: string | null;
  cierre_familia: string | null;
  cierre_estado: string | null;
  canal: string;
  asignado_id: string | null;
  asignado_nombre: string | null;
  cola_id: string | null;
  cola: string | null;
  /** Último mensaje humano saliente y días desde ese día (America/Asuncion). */
  ultimo_msg_asesor_at: string | null;
  dias_asesor: number | null;
  semaforo: Semaforo;
  /** Próxima acción del cierre ("YYYY-MM-DD") y su nota; hecha = seguimiento cumplido. */
  proxima_accion_fecha: string | null;
  proxima_accion_nota: string | null;
  seguimiento_hecho_at: string | null;
};
export type ConteoSeguimientos = { pendientes: number; vencidos: number };
export type PaginaFinalizadas = {
  rows: Finalizada[];
  /** Cursor: cerrada_at (finalizadas) o la fecha de la próxima acción (seguimientos); con
   *  búsqueda (orden por relevancia), `offset`. */
  siguiente: { at: string; id: string; offset?: number } | null;
  seguimientos: ConteoSeguimientos;
};

// ── Semáforo del último mensaje del asesor ──────────────────────────────────
export type Semaforo = "verde" | "ambar" | "rojo" | "sin";
export const SEMAFORO: Record<Semaforo, { label: string; detalle: string; dot: string; pill: string }> = {
  verde: { label: "Al día", detalle: "hasta 2 días", dot: "bg-emerald-500", pill: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  ambar: { label: "Atención", detalle: "3 a 6 días", dot: "bg-amber-500", pill: "border-amber-200 bg-amber-50 text-amber-800" },
  rojo: { label: "Frío", detalle: "7 días o más", dot: "bg-rose-500", pill: "border-rose-200 bg-rose-50 text-rose-800" },
  sin: { label: "Sin mensaje", detalle: "el asesor nunca escribió", dot: "bg-slate-300", pill: "border-slate-200 bg-slate-50 text-slate-600" },
};
export const esSemaforo = (v: unknown): v is Semaforo => v === "verde" || v === "ambar" || v === "rojo" || v === "sin";
/** "hoy", "ayer", "hace 5 días". */
export function diasLegible(d: number | null | undefined): string {
  if (d == null) return "—";
  if (d <= 0) return "hoy";
  if (d === 1) return "ayer";
  return `hace ${d} días`;
}
export const PAGINA_FINALIZADAS = 50;

// ── Historial omnicanal (chat_historial_contacto) ───────────────────────────
export type ContactoBuscado = {
  id: string;
  nombre: string | null;
  telefono: string | null;
  canales: string[];
  conversaciones: number;
  ultimo_mensaje_at: string | null;
  cliente_id: string | null;
};
export type ConversacionHistorial = {
  id: string;
  canal: string;
  estado: "abierta" | "pendiente" | "cerrada";
  created_at: string;
  cerrada_at: string | null;
  asignado: string | null;
  cierre_estado: string | null;
  cierre_observacion: string | null;
  ultimo_preview: string | null;
  ultimo_mensaje_at: string | null;
  cola?: string | null;
};
export type EventoRuteo = { evento: string; a: string | null; de: string | null; cola?: string | null; created_at: string };
export type Historial = {
  contacto: { id: string; nombre: string | null; telefono: string | null; cliente_id: string | null; prospecto_id: string | null; created_at: string } | null;
  conversaciones: ConversacionHistorial[];
  ruteo: EventoRuteo[];
};

export const EVENTO_RUTEO: Record<string, { label: string; clase: string }> = {
  asignada_auto: { label: "Asignada automáticamente", clase: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  sin_agente: { label: "En espera: sin agentes listos", clase: "border-amber-200 bg-amber-50 text-amber-700" },
  cola_manual: { label: "En cola (asignación manual)", clase: "border-indigo-200 bg-indigo-50 text-indigo-700" },
  reasignada_sla: { label: "Reasignada por SLA", clase: "border-orange-200 bg-orange-50 text-orange-700" },
  sla_tope: { label: "SLA vencido (tope de reasignaciones)", clase: "border-rose-200 bg-rose-50 text-rose-700" },
  tomada: { label: "Tomada", clase: "border-[#4FAEB2]/30 bg-[#4FAEB2]/10 text-[#3F8E91]" },
  transferida: { label: "Transferida", clase: "border-violet-200 bg-violet-50 text-violet-700" },
  asignada_supervisor: { label: "Asignada por supervisor", clase: "border-violet-200 bg-violet-50 text-violet-700" },
  liberada: { label: "Quedó sin asignar", clase: "border-slate-200 bg-slate-50 text-slate-600" },
  derivada: { label: "Derivada a una cola", clase: "border-sky-200 bg-sky-50 text-sky-700" },
};
export const eventoRuteo = (e: string) => EVENTO_RUTEO[e] ?? { label: e, clase: "border-slate-200 bg-slate-50 text-slate-600" };

// ── Colas ────────────────────────────────────────────────────────────────────
export type Estrategia = "equitativa" | "circular" | "menor_carga" | "manual";
export const ESTRATEGIA_LABEL: Record<Estrategia, string> = {
  equitativa: "Equitativa",
  circular: "Circular (turno fijo)",
  menor_carga: "Menor carga",
  manual: "Manual (sin autoasignación)",
};
export type AgenteCola = { usuario_id: string; recibe_nuevos: boolean; max_conversaciones: number; es_supervisor: boolean };
export type Cola = {
  id: string;
  nombre: string;
  estrategia: Estrategia;
  prioridad: number;
  sla_minutos: number;
  max_reasignaciones: number;
  mismo_asesor_horas: number;
  activo: boolean;
  /** No recibe entrantes automáticos: solo chats que le derivan. */
  solo_transferencia: boolean;
  /** Mensaje automático al derivar (por ahora queda como nota en el hilo). */
  mensaje_derivacion: string | null;
  canales: string[];
  agentes: AgenteCola[];
};
export type DatosColas = {
  colas: Cola[];
  canales: { id: string; nombre: string; tipo: string; activo: boolean }[];
  usuarios: { id: string; nombre: string; rol: string }[];
  /** Supervisor → asesores que ve en Monitoreo y Finalizadas (sin filas = ve a todos). */
  supervisores: { supervisor_id: string; asesores: string[] }[];
};

// ── Formatos ─────────────────────────────────────────────────────────────────
/** Espera legible (como el sistema actual): "<1 min", "5 min", "1 h 20 min". */
export function esperaLegible(iso: string | null | undefined, ahora = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const m = Math.floor(Math.max(0, ahora - t) / 60_000);
  if (m < 1) return "<1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h >= 48) return `${Math.floor(h / 24)} d`;
  const rm = m % 60;
  return rm > 0 ? `${h} h ${rm} min` : `${h} h`;
}

/** Duración en segundos: "45s", "3m 12s", "1h 5m". */
export function duracionCorta(totalSeg: number | null | undefined): string {
  if (totalSeg == null || !Number.isFinite(totalSeg)) return "—";
  const s = Math.max(0, Math.round(totalSeg));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

/** Segundos entre dos fechas (null si falta alguna o el orden no tiene sentido). */
export function segundosEntre(desde: string | null | undefined, hasta: string | null | undefined): number | null {
  if (!desde || !hasta) return null;
  const a = Date.parse(desde);
  const b = Date.parse(hasta);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return (b - a) / 1000;
}

/** Color estable por nombre para los avatares (6 tonos, como el sistema actual). */
const TONOS_AVATAR = [
  "bg-[#4FAEB2]/12 text-[#3F8E91] border-[#4FAEB2]/30",
  "bg-violet-50 text-violet-700 border-violet-200",
  "bg-amber-50 text-amber-700 border-amber-200",
  "bg-emerald-50 text-emerald-700 border-emerald-200",
  "bg-rose-50 text-rose-700 border-rose-200",
  "bg-sky-50 text-sky-700 border-sky-200",
];
export function tonoAvatar(nombre: string | null | undefined): string {
  const s = nombre ?? "";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return TONOS_AVATAR[Math.abs(h) % TONOS_AVATAR.length];
}
