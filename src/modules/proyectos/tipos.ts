/**
 * Proyectos — tipos y helpers compartidos (front y API). Sin dependencias de React.
 *
 * El reloj laboral es el MISMO de Soporte (msLaborables de soporte/dominio, horario de
 * soporte_config): el SLA de una tarjeta son las horas laborales que lleva en su estado
 * actual contra el objetivo del estado (sla_horas_objetivo). Los estados de tipo
 * 'cliente' (espera del cliente), 'pausado' y 'final' no cuentan.
 */
import { TZ_PY } from "@/lib/fecha/paraguay";
import { HORARIO_DEFECTO, SLA_UMBRAL_RIESGO, msLaborables, type HorarioLaboral } from "@/modules/soporte/dominio";

export type { HorarioLaboral };
export { HORARIO_DEFECTO };

export const TIPOS_SLA = ["interno", "cliente", "pausado", "final"] as const;
export type TipoSla = (typeof TIPOS_SLA)[number];
export const TIPO_SLA_LABEL: Record<TipoSla, string> = {
  interno: "Interno (cuenta SLA)",
  cliente: "Espera del cliente",
  pausado: "Pausado",
  final: "Final",
};

export const ROLES_ESTADO = ["nuevo", "en_curso", "revision", "espera_cliente", "pausado", "entregado", "cancelado"] as const;
export type RolEstado = (typeof ROLES_ESTADO)[number];
export const ROL_LABEL: Record<RolEstado, string> = {
  nuevo: "Nuevo",
  en_curso: "En curso",
  revision: "Revisión",
  espera_cliente: "Espera del cliente",
  pausado: "Pausado",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

export const PRIORIDADES = ["baja", "normal", "alta", "urgente"] as const;
export type Prioridad = (typeof PRIORIDADES)[number];
/** Como el sistema actual: "normal" se muestra "Media". */
export const PRIORIDAD_LABEL: Record<Prioridad, string> = { baja: "Baja", normal: "Media", alta: "Alta", urgente: "Urgente" };

export const BLOQUEO_TIPOS = ["cliente", "interno", "tercero"] as const;
export type BloqueoTipo = (typeof BLOQUEO_TIPOS)[number];
export const BLOQUEO_TIPO_LABEL: Record<BloqueoTipo, string> = { cliente: "Del cliente", interno: "Interno", tercero: "De un tercero" };

export const ESTADOS_TAREA = ["pendiente", "en_proceso", "completada", "bloqueada"] as const;
export type EstadoTarea = (typeof ESTADOS_TAREA)[number];
export const ESTADO_TAREA_LABEL: Record<EstadoTarea, string> = { pendiente: "Pendiente", en_proceso: "En proceso", completada: "Completada", bloqueada: "Bloqueada" };
export const ESTADO_TAREA_TONO: Record<EstadoTarea, string> = {
  pendiente: "border-slate-200 bg-slate-50 text-slate-600",
  en_proceso: "border-sky-200 bg-sky-50 text-sky-700",
  completada: "border-emerald-200 bg-emerald-50 text-emerald-700",
  bloqueada: "border-rose-200 bg-rose-50 text-rose-700",
};

export const CANALES = ["interno", "cliente"] as const;
export type Canal = (typeof CANALES)[number];
export const CANAL_LABEL: Record<Canal, string> = { interno: "Interno", cliente: "Cliente" };

// ── Tipos de datos ───────────────────────────────────────────────────────────
export type Estado = {
  id: string;
  codigo: string;
  nombre: string;
  color: string;
  orden: number;
  tipo_sla: TipoSla;
  sla_horas_objetivo: number | null;
  rol: RolEstado;
  es_final: boolean;
  es_inicial?: boolean;
  activo?: boolean;
};

/** Tarjeta del tablero (la misma forma devuelven proyectos_tablero, proyectos_tarjetas y la lista). */
export type Tarjeta = {
  id: string;
  numero: string;
  titulo: string;
  prioridad: Prioridad;
  estado_id: string;
  estado_desde: string;
  ultimo_movimiento_at: string;
  fecha_ingreso?: string | null;
  fecha_prometida: string | null;
  fecha_entrega: string | null;
  monto_vendido: number;
  moneda: "GS" | "USD";
  bloqueado: boolean;
  bloqueo_tipo: BloqueoTipo | null;
  bloqueo_motivo: string | null;
  bloqueo_responsable?: string | null;
  bloqueo_proxima_accion?: string | null;
  pausa_motivo: string | null;
  cancelacion_motivo?: string | null;
  cliente_id: string | null;
  cliente_nombre: string | null;
  responsable_comercial_id: string | null;
  comercial_nombre: string | null;
  responsable_tecnico_id: string | null;
  tecnico_nombre: string | null;
  project_manager_id: string | null;
  pm_nombre: string | null;
  tareas_total: number;
  tareas_hechas: number;
};

export type Columna = Estado & { cantidad: number; tarjetas: Tarjeta[] };

export type Kpis = {
  activos: number;
  vencidos: number;
  vencen_3_dias: number;
  sin_fecha: number;
  bloqueados: number;
  sin_movimiento: number;
  urgentes: number;
  entregados_mes: number;
};

export type Tablero = { columnas: Columna[]; kpis: Kpis; horario: HorarioLaboral };

export type Proyecto = Tarjeta & {
  descripcion: string | null;
  fecha_ingreso: string;
  pausado_at: string | null;
  pausa_horas_acumuladas: number;
  archivado: boolean;
  created_by: string | null;
  creado_por_nombre: string | null;
  created_at: string;
  updated_at: string;
};

export type Permisos = { editar: boolean; mover: boolean; eliminar: boolean };

/** GET /api/proyectos/[id]. `sla` = horas laborales de los tramos CERRADOS por tipo. */
export type Detalle = {
  proyecto: Proyecto;
  estado: Estado | null;
  permisos: Permisos;
  sla: { interno: number; cliente: number; pausado: number };
  tramo_actual: { entered_at: string; tipo_sla: string | null } | null;
  horario: HorarioLaboral;
};

export type UsuarioMin = { id: string; nombre: string; rol: string };

export type Tarea = {
  id: string;
  titulo: string;
  descripcion: string | null;
  estado: EstadoTarea;
  asignado_id: string | null;
  asignado_nombre: string | null;
  fecha_limite: string | null;
  orden: number;
  created_at: string;
};

export type Adjunto = { id: string; nombre: string; mime: string | null; size: number | null };

export type Comentario = {
  id: string;
  canal: Canal;
  contenido: string;
  menciones: string[];
  adjuntos: Adjunto[];
  usuario_id: string | null;
  usuario_nombre: string | null;
  editado_at: string | null;
  created_at: string;
};

export type Archivo = {
  id: string;
  nombre: string;
  mime: string | null;
  size: number | null;
  subido_por_nombre: string | null;
  created_at: string;
  url: string | null;
  url_descarga: string | null;
};

export type Tramo = {
  id: string;
  estado_id: string;
  estado_nombre: string;
  estado_color: string;
  entered_at: string;
  exited_at: string | null;
  horas_totales: number | null;
  horas_laborales: number | null;
  tipo_sla_snapshot: string | null;
  usuario_nombre: string | null;
};

export type Evento = {
  id: number;
  tipo: string;
  detalle: Record<string, unknown>;
  usuario_nombre: string | null;
  created_at: string;
};

// ── Filtros ──────────────────────────────────────────────────────────────────
export type Filtros = {
  q: string;
  responsable: string;
  cliente: string;
  prioridad: string;
  archivados: boolean;
  /** Rango de ENTREGA (solo acota las columnas de Entregado, como el actual). */
  desde: string;
  hasta: string;
};

export function filtrosQuery(f: Filtros): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.q.trim()) sp.set("q", f.q.trim());
  if (f.responsable) sp.set("responsable", f.responsable);
  if (f.cliente) sp.set("cliente", f.cliente);
  if (f.prioridad) sp.set("prioridad", f.prioridad);
  if (f.archivados) sp.set("archivados", "1");
  return sp;
}

// ── Formatos ─────────────────────────────────────────────────────────────────
export function monto(v: number | string | null | undefined, moneda: string | null | undefined = "GS"): string {
  const n = Number(v) || 0;
  if (moneda === "USD") return `US$ ${n.toLocaleString("es-PY", { maximumFractionDigits: 2 })}`;
  return `Gs. ${Math.round(n).toLocaleString("es-PY")}`;
}

/** dd/mm/aaaa en hora de Paraguay (acepta "YYYY-MM-DD" sin correrse de día). */
export function fechaCorta(v: string | null | undefined): string {
  if (!v) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split("-").reverse().join("/");
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "2-digit", year: "numeric" });
}

/** dd/mm/aaaa hh:mm en hora de Paraguay. */
export function fechaHoraPY(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** "Hace 5 min" · "Hace 3 h" · "Hace 2 d". */
export function haceCuanto(v: string | null | undefined, ahora = Date.now()): string {
  if (!v) return "—";
  const ms = ahora - Date.parse(v);
  if (!Number.isFinite(ms)) return "—";
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return "Recién";
  if (min < 60) return `Hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `Hace ${h} h`;
  return `Hace ${Math.round(h / 24)} d`;
}

/** Duración en horas (laborales) como el actual: "5h", "1d 3h" (días de 24 h). */
export function duracion(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  if (totalMin < 60) return `${totalMin}m`;
  const totalH = Math.floor(totalMin / 60);
  const d = Math.floor(totalH / 24);
  const h = totalH % 24;
  if (d > 0 && h > 0) return `${d}d ${h}h`;
  if (d > 0) return `${d}d`;
  const m = totalMin % 60;
  return m ? `${totalH}h ${m}m` : `${totalH}h`;
}

export const horasTexto = (h: number | null | undefined) => (h == null || !Number.isFinite(h) ? "—" : duracion(h * 3_600_000));

/** Nombre y primer apellido ("Emmanuel Guillén"), con mayúscula inicial. */
export function nombreCorto(nombre: string | null | undefined): string {
  const p = (nombre ?? "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "";
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const usar = p.length >= 3 ? [p[0], p[p.length >= 4 ? 2 : 1]] : p.slice(0, 2);
  return usar.map(cap).join(" ");
}

export function iniciales(nombre: string | null | undefined): string {
  const p = (nombre ?? "").trim().split(/\s+/).filter(Boolean);
  if (p.length >= 2) return `${p[0][0]}${p[1][0]}`.toUpperCase();
  return (p[0] ?? "?").slice(0, 2).toUpperCase();
}

// ── Prioridad (mismos tonos que el actual) ──────────────────────────────────
export type EstiloPrioridad = { borde: string; badge: string; punto: string };

export function estiloPrioridad(p: string | null | undefined): EstiloPrioridad {
  if (p === "baja") return { borde: "border-l-emerald-500 hover:border-emerald-200", badge: "border-emerald-200 bg-emerald-50 text-emerald-700", punto: "bg-emerald-500" };
  if (p === "alta") return { borde: "border-l-orange-500 hover:border-orange-200", badge: "border-orange-200 bg-orange-50 text-orange-700", punto: "bg-orange-500" };
  if (p === "urgente") return { borde: "border-l-rose-600 hover:border-rose-200", badge: "border-rose-200 bg-rose-50 text-rose-700", punto: "bg-rose-600" };
  if (p === "normal") return { borde: "border-l-sky-500 hover:border-sky-200", badge: "border-sky-200 bg-sky-50 text-sky-700", punto: "bg-sky-500" };
  return { borde: "border-l-slate-300 hover:border-slate-300", badge: "border-slate-200 bg-slate-50 text-slate-600", punto: "bg-slate-400" };
}

// ── SLA del estado actual ────────────────────────────────────────────────────
export type NivelSla = "en_tiempo" | "en_riesgo" | "vencido" | "sin_objetivo" | "no_cuenta";

export type InfoSlaEstado = { nivel: NivelSla; ms: number; objetivoMs: number | null; texto: string; titulo: string };

/** ¿El estado cuenta para el SLA? Espera del cliente, pausado y finales no cuentan. */
export const cuentaSla = (e: Pick<Estado, "tipo_sla"> | null | undefined) => !!e && e.tipo_sla === "interno";

/**
 * SLA de la tarjeta en su estado actual: horas LABORALES desde estado_desde hasta
 * `ahoraMs` contra el objetivo del estado. ≥ 75% = en riesgo; > 100% = vencido.
 */
export function slaEstado(
  estadoDesde: string | null | undefined,
  estado: Pick<Estado, "tipo_sla" | "sla_horas_objetivo"> | null | undefined,
  horario: HorarioLaboral,
  ahoraMs: number,
): InfoSlaEstado {
  const ms = Math.max(0, msLaborables(estadoDesde, new Date(ahoraMs).toISOString(), horario) ?? 0);
  const objetivo = estado?.sla_horas_objetivo == null ? null : Number(estado.sla_horas_objetivo);
  if (!cuentaSla(estado)) {
    return { nivel: "no_cuenta", ms, objetivoMs: null, texto: `En área: ${duracion(ms)}`, titulo: "Este estado no cuenta para el SLA (horas laborales en el estado)" };
  }
  if (objetivo == null || !Number.isFinite(objetivo) || objetivo <= 0) {
    return { nivel: "sin_objetivo", ms, objetivoMs: null, texto: `En área: ${duracion(ms)}`, titulo: "Horas laborales en el estado actual (sin objetivo de SLA)" };
  }
  const objetivoMs = objetivo * 3_600_000;
  const prop = ms / objetivoMs;
  if (prop > 1) {
    return { nivel: "vencido", ms, objetivoMs, texto: `Vencido: +${duracion(ms - objetivoMs)}`, titulo: `SLA vencido: ${duracion(ms)} de ${duracion(objetivoMs)} laborales` };
  }
  return {
    nivel: prop >= SLA_UMBRAL_RIESGO ? "en_riesgo" : "en_tiempo",
    ms,
    objetivoMs,
    texto: `En área: ${duracion(ms)} / ${duracion(objetivoMs)}`,
    titulo: prop >= SLA_UMBRAL_RIESGO ? `En riesgo: ${Math.round(prop * 100)}% del objetivo` : `En tiempo: ${Math.round(prop * 100)}% del objetivo`,
  };
}

export const TONO_SLA: Record<NivelSla, string> = {
  en_tiempo: "border-emerald-200 bg-emerald-50 text-emerald-700",
  en_riesgo: "border-amber-200 bg-amber-50 text-amber-700",
  vencido: "border-rose-200 bg-rose-50 text-rose-700",
  sin_objetivo: "border-slate-200 bg-slate-50 text-slate-600",
  no_cuenta: "border-slate-200 bg-slate-50 text-slate-500",
};

/** ¿Pasar a este estado exige motivo? (pausa o cancelación, igual que la base). */
export const pideMotivo = (e: Pick<Estado, "tipo_sla" | "rol"> | null | undefined) => !!e && (e.tipo_sla === "pausado" || e.rol === "cancelado");

/** Inicio del mes actual en Paraguay (ms). */
export function inicioMesPY(): number {
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: TZ_PY });
  return new Date(`${hoy.slice(0, 7)}-01T00:00:00-03:00`).getTime();
}

/** "YYYY-MM-DDTHH:mm" (hora PY) o "YYYY-MM-DD" (→ 17:00) a ISO. */
export function localAIso(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  const c = /^\d{4}-\d{2}-\d{2}$/.test(t) ? `${t}T17:00:00-03:00` : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t) ? `${t}:00-03:00` : t;
  const ms = Date.parse(c);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** ISO → "YYYY-MM-DDTHH:mm" en hora PY (formato de SelectorFechaHora / datetime-local). */
export function isoALocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms - 3 * 3_600_000).toISOString().slice(0, 16) : "";
}

/** Categoría de un archivo por extensión / mime (filtros de la pestaña Archivos). */
export type CategoriaArchivo = "pdf" | "imagen" | "video" | "audio" | "excel" | "documento" | "comprimido" | "otro";
export const CATEGORIAS_ARCHIVO: { key: CategoriaArchivo; label: string }[] = [
  { key: "pdf", label: "PDF" },
  { key: "imagen", label: "Imágenes" },
  { key: "video", label: "Videos" },
  { key: "audio", label: "Audio" },
  { key: "excel", label: "Hojas de cálculo" },
  { key: "documento", label: "Documentos" },
  { key: "comprimido", label: "Comprimidos" },
  { key: "otro", label: "Otros" },
];

export function categoriaArchivo(nombre: string, mime: string | null | undefined): CategoriaArchivo {
  const m = (mime ?? "").toLowerCase();
  const ext = (nombre.split(".").pop() ?? "").toLowerCase();
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (m.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "heic", "bmp"].includes(ext)) return "imagen";
  if (m.startsWith("video/") || ["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return "video";
  if (m.startsWith("audio/") || ["mp3", "ogg", "wav", "m4a", "opus"].includes(ext)) return "audio";
  if (["xls", "xlsx", "csv", "ods"].includes(ext) || m.includes("spreadsheet") || m.includes("excel")) return "excel";
  if (["doc", "docx", "odt", "txt", "rtf", "ppt", "pptx", "odp", "md"].includes(ext) || m.includes("word") || m.startsWith("text/")) return "documento";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext) || m.includes("zip") || m.includes("compressed")) return "comprimido";
  return "otro";
}

// ── Tareas del equipo · Dashboard Ejecutivo · Dashboard PM ──────────────────
/** Parámetros de seguimiento (proyecto_config). */
export type ProyectoConfig = { wip_por_tecnico: number; vence_pronto_dias: number; sin_movimiento_horas: number };
export const CONFIG_DEFECTO: ProyectoConfig = { wip_por_tecnico: 4, vence_pronto_dias: 3, sin_movimiento_horas: 9 };

/** Semáforo del SLA del estado: <70% verde, 70-90% amarillo, 90-100% naranja, >100% rojo. */
export type Semaforo = "verde" | "amarillo" | "naranja" | "rojo" | "sin_sla";
export const SEMAFORO_TONO: Record<Semaforo, string> = {
  verde: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amarillo: "border-amber-200 bg-amber-50 text-amber-700",
  naranja: "border-orange-200 bg-orange-50 text-orange-700",
  rojo: "border-rose-200 bg-rose-50 text-rose-700",
  sin_sla: "border-slate-200 bg-slate-50 text-slate-500",
};
export const SEMAFORO_PUNTO: Record<Semaforo, string> = {
  verde: "bg-emerald-500",
  amarillo: "bg-amber-400",
  naranja: "bg-orange-500",
  rojo: "bg-rose-500",
  sin_sla: "bg-slate-300",
};

/** Misma regla que proyectos_abiertos_metricas() (para recalcular en vivo). */
export function semaforoDe(horas: number, tipoSla: string | null | undefined, objetivo: number | null | undefined): { semaforo: Semaforo; pct: number | null } {
  const obj = objetivo == null ? 0 : Number(objetivo);
  if (tipoSla !== "interno" || !(obj > 0)) return { semaforo: "sin_sla", pct: null };
  const pct = Math.round((1000 * horas) / obj) / 10;
  const semaforo: Semaforo = horas > obj ? "rojo" : horas >= 0.9 * obj ? "naranja" : horas >= 0.7 * obj ? "amarillo" : "verde";
  return { semaforo, pct };
}

/** Una fila de proyectos_abiertos_metricas() (proyecto abierto con sus métricas vivas). */
export type Metrica = {
  id: string;
  numero: string;
  titulo: string;
  prioridad: Prioridad;
  cliente_id: string | null;
  cliente_nombre: string | null;
  estado_id: string;
  estado_nombre: string;
  estado_color: string;
  tipo_sla: TipoSla;
  rol: RolEstado;
  sla_horas_objetivo: number | null;
  estado_desde: string;
  horas_en_estado: number;
  sla_pct: number | null;
  semaforo: Semaforo;
  fecha_prometida: string | null;
  vencido: boolean;
  vence_pronto: boolean;
  sin_fecha: boolean;
  bloqueado: boolean;
  bloqueo_tipo: BloqueoTipo | null;
  bloqueo_motivo: string | null;
  sin_movimiento: boolean;
  ultimo_movimiento_at: string;
  responsable_tecnico_id: string | null;
  tecnico_nombre: string | null;
  project_manager_id: string | null;
  pm_nombre: string | null;
  responsable_comercial_id: string | null;
  comercial_nombre: string | null;
  monto_vendido: number;
  moneda: "GS" | "USD";
  tareas_total: number;
  tareas_hechas: number;
};

export type TecnicoEquipo = {
  id: string;
  nombre: string;
  activos: number;
  en_espera: number;
  vencidos: number;
  sla_rojo: number;
  sobre_wip: boolean;
  entregados_mes: number;
  proyectos: Metrica[];
};

/** GET /api/proyectos/equipo. `generado_at` = cuándo se calcularon las horas (corren desde ahí). */
export type EquipoResp = { wip: number; tecnicos: TecnicoEquipo[]; sin_tecnico: Metrica[]; horario: HorarioLaboral; generado_at: string };

export type KpisEjecutivo = {
  activos: number; en_curso: number; esperando_cliente: number; pausados: number; vencidos: number; vencen_pronto: number;
  sin_fecha: number; bloqueados: number; sin_movimiento: number; sla_rojo: number; ingresados: number; entregados: number;
  entregados_a_tiempo: number; entregados_con_fecha: number; monto_entregado_gs: number; monto_ingresado_gs: number;
  dias_promedio_entrega: number | null;
};

export type EstadoEjecutivo = {
  estado_id: string; nombre: string; color: string; tipo_sla: TipoSla; objetivo: number | null; cantidad: number; rojos: number;
  horas_promedio_actual: number | null; horas_promedio_periodo: number | null; pasaron_periodo: number;
};
export type TecnicoEjecutivo = { id: string | null; nombre: string; activos: number; en_espera: number; vencidos: number; sla_rojo: number; entregados: number; a_tiempo: number };
export type PmEjecutivo = { id: string | null; nombre: string; activos: number; vencidos: number; bloqueados: number; esperando_cliente: number; entregados: number };

/** GET /api/proyectos/dashboard/ejecutivo?desde&hasta */
export type EjecutivoResp = {
  periodo: { desde: string; hasta: string };
  kpis: KpisEjecutivo;
  por_estado: EstadoEjecutivo[];
  por_tecnico: TecnicoEjecutivo[];
  por_pm: PmEjecutivo[];
  atencion: Metrica[];
};

export type KpisPm = {
  activos: number; vencidos: number; vencen_pronto: number; sin_fecha: number; bloqueados: number;
  esperando_cliente: number; sin_movimiento: number; sla_rojo: number; entregados_mes: number;
};

export const SECCIONES_PM = ["vencidos", "vencen_pronto", "bloqueados", "esperando_cliente", "sin_movimiento", "sin_fecha"] as const;
export type SeccionPm = (typeof SECCIONES_PM)[number];

/** GET /api/proyectos/dashboard/pm?pm= */
export type PmResp = {
  pm: { id: string; nombre: string } | null;
  kpis: KpisPm;
  todos: Metrica[];
  /** Solo para ADMIN: los PM con proyectos abiertos (para el selector). */
  pms: { id: string; nombre: string }[];
} & Record<SeccionPm, Metrica[]>;

/** Motivos de atención de un proyecto abierto (el orden es el de gravedad). */
export function motivosAtencion(m: Pick<Metrica, "vencido" | "semaforo" | "bloqueado" | "sin_movimiento" | "vence_pronto">): { codigo: string; texto: string; tono: string }[] {
  const r: { codigo: string; texto: string; tono: string }[] = [];
  if (m.vencido) r.push({ codigo: "vencido", texto: "Vencido", tono: "bg-rose-50 text-rose-700" });
  if (m.semaforo === "rojo") r.push({ codigo: "sla_rojo", texto: "SLA vencido", tono: "bg-rose-50 text-rose-700" });
  if (m.bloqueado) r.push({ codigo: "bloqueado", texto: "Bloqueado", tono: "bg-slate-100 text-slate-700" });
  if (m.sin_movimiento) r.push({ codigo: "sin_movimiento", texto: "Sin movimiento", tono: "bg-orange-50 text-orange-700" });
  if (m.vence_pronto) r.push({ codigo: "vence_pronto", texto: "Vence pronto", tono: "bg-amber-50 text-amber-700" });
  return r;
}
