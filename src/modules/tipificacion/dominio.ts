/**
 * Tipificación — dominio isomórfico (lo usan la API y las pantallas).
 * Portado del sistema actual (lib/soporte/dominio, lib/proyectos/reloj-laboral,
 * lib/soporte/tipificacion-ticket): número de ticket, asunto desde la descripción,
 * horario laboral (configurable en soporte_config), SLA en horas laborales,
 * archivos permitidos y fechas en hora de Paraguay.
 */

// ── Catálogo: acción del sub-estado ─────────────────────────────────────────
export type Comportamiento = "ticket_error" | "ticket_cambio" | "capacitacion";
export const COMPORTAMIENTOS: { value: "" | Comportamiento; label: string; detalle: string }[] = [
  { value: "", label: "Ninguna", detalle: "Solo registra la tipificación" },
  { value: "ticket_error", label: "Ticket de error", detalle: "Crea un ticket de Soporte (Error)" },
  { value: "ticket_cambio", label: "Ticket de cambio", detalle: "Crea un ticket de Soporte (Cambio)" },
  { value: "capacitacion", label: "Agendar capacitación", detalle: "Agenda una capacitación" },
];
export const esComportamiento = (v: unknown): v is Comportamiento =>
  v === "ticket_error" || v === "ticket_cambio" || v === "capacitacion";

export type SubEstadoCat = { id: string; familia_id: string; nombre: string; sort_order: number; activo: boolean; comportamiento: Comportamiento | null };
export type EstadoCat = { id: string; nombre: string; sort_order: number; activo: boolean; subestados: SubEstadoCat[] };

// ── Tickets ──────────────────────────────────────────────────────────────────
/** #0001 */
export function numeroTicket(numero: number | string | null | undefined): string {
  const n = Number(numero);
  return Number.isFinite(n) && n > 0 ? `#${String(Math.trunc(n)).padStart(4, "0")}` : "#—";
}

/** Asunto del ticket: la primera línea de la descripción, cortada en una palabra (máx. 90). */
export function asuntoDesdeDescripcion(descripcion: unknown, max = 90): string {
  const texto = typeof descripcion === "string" ? descripcion.trim() : "";
  const linea = texto.split(/\r?\n/).find((l) => l.trim())?.trim().replace(/\s+/g, " ") ?? "";
  if (linea.length <= max) return linea;
  const corte = linea.slice(0, max);
  const espacio = corte.lastIndexOf(" ");
  return `${(espacio > max * 0.6 ? corte.slice(0, espacio) : corte).trim()}…`;
}

/** Tono del nivel según su SLA: cuanto más corto, más urgente se ve. */
export function tonoSla(horas: number): "rosa" | "ambar" | "verde" {
  if (horas <= 2) return "rosa";
  if (horas <= 5) return "ambar";
  return "verde";
}

// ── Horario laboral (soporte_config) ─────────────────────────────────────────
// El horario y las fechas en hora de Paraguay viven en el módulo Agenda (los usan la
// Agenda y la Tipificación); se re-exportan acá para no cambiar a quien ya los importa.
import { HORARIO_DEFECTO, isoAFechaLocal, ventanaLaboral as ventana, type Horario } from "@/modules/agenda/horario";
export {
  HORARIO_DEFECTO, fechaLocalAIso, isoAFechaLocal, mensajeHorario, rangoEnHorarioLaboral, textoHorario, type Horario,
} from "@/modules/agenda/horario";

/** Paraguay: UTC-3 fijo (sin horario de verano desde 2024). */
const OFFSET_MIN = -180;
const MIN_MS = 60_000;
const DIA_MS = 24 * 60 * MIN_MS;

const aLocal = (ms: number) => ms + OFFSET_MIN * MIN_MS;
const deLocal = (ms: number) => ms - OFFSET_MIN * MIN_MS;

/** Cuándo vence: `horas` de horario laboral contadas desde `desde` (mismo cálculo que la base). */
export function vencimientoSla(desde: number, horas: number | null | undefined, h: Horario = HORARIO_DEFECTO): string | null {
  if (horas == null || !Number.isFinite(Number(horas)) || Number(horas) <= 0 || !Number.isFinite(desde)) return null;
  let resto = Number(horas) * 60 * MIN_MS;
  let local = aLocal(desde);
  for (let guard = 0; guard < 400; guard++) {
    const inicioDia = Math.floor(local / DIA_MS) * DIA_MS;
    const v = ventana(h, new Date(inicioDia).getUTCDay());
    const sig = inicioDia + DIA_MS + h.hora_inicio * 60 * MIN_MS;
    if (!v || local >= inicioDia + v[1] * MIN_MS) { local = sig; continue; }
    if (local < inicioDia + v[0] * MIN_MS) local = inicioDia + v[0] * MIN_MS;
    const disp = inicioDia + v[1] * MIN_MS - local;
    if (resto <= disp) return new Date(deLocal(local + resto)).toISOString();
    resto -= disp;
    local = sig;
  }
  return null;
}

/** "18/09/2026 09:00" en hora de Paraguay. */
export function fechaHoraPy(iso: string | null | undefined): string {
  const l = isoAFechaLocal(iso);
  if (!l) return "—";
  return `${l.slice(8, 10)}/${l.slice(5, 7)}/${l.slice(0, 4)} ${l.slice(11, 16)}`;
}

/** "hace 5 min", "hace 2 h", "ayer"… */
export function fechaRelativa(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "recién";
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return "ayer";
  if (d < 7) return `hace ${d} días`;
  return fechaHoraPy(iso).slice(0, 10);
}

// ── Evidencias ──────────────────────────────────────────────────────────────
/**
 * Se acepta cualquier archivo salvo lo que se ejecuta o se abre como página: un .html o
 * .svg correría en el navegador de quien lo abre, y un .exe o .bat es la forma clásica de
 * colar un virus.
 */
const EXTENSIONES_BLOQUEADAS =
  /\.(exe|msi|msp|bat|cmd|com|scr|pif|cpl|dll|sys|vbs|vbe|js|mjs|jse|wsf|wsh|hta|ps1|psm1|sh|jar|app|apk|lnk|reg|html?|xhtml|svg|svgz|php|asp|aspx|jsp)$/i;
const MIMES_BLOQUEADOS = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/javascript",
  "text/javascript",
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-sh",
  "application/java-archive",
  "application/vnd.android.package-archive",
]);

/** 50 MB por archivo: el tope del bucket "soporte". */
export const ARCHIVO_MAX_BYTES = 50 * 1024 * 1024;

export function mimeAceptado(mime: string, nombre: string): boolean {
  if (EXTENSIONES_BLOQUEADAS.test((nombre ?? "").trim())) return false;
  return !MIMES_BLOQUEADOS.has((mime || "").toLowerCase());
}

export function tamanoLegible(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "").replace(".", ",")} MB`;
}

// ── Agenda ───────────────────────────────────────────────────────────────────
export const ESTADOS_CITA = [
  { codigo: "pendiente", nombre: "Pendiente", color: "bg-amber-100 text-amber-700" },
  { codigo: "confirmada", nombre: "Confirmada", color: "bg-sky-100 text-sky-700" },
  { codigo: "completada", nombre: "Completada", color: "bg-emerald-100 text-emerald-700" },
  { codigo: "no_asistio", nombre: "No asistió", color: "bg-rose-100 text-rose-700" },
  { codigo: "cancelada", nombre: "Cancelada", color: "bg-slate-200 text-slate-600" },
  { codigo: "reprogramada", nombre: "Reprogramada", color: "bg-violet-100 text-violet-700" },
] as const;
export type EstadoCita = (typeof ESTADOS_CITA)[number]["codigo"];
export const estadoCita = (c: string) => ESTADOS_CITA.find((e) => e.codigo === c) ?? { codigo: c, nombre: c, color: "bg-slate-100 text-slate-600" };

/** Duraciones rápidas de una capacitación, en minutos. */
export const DURACIONES = [30, 60, 90, 120];
export const textoDuracion = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60}` : `${m / 60} h`);

// ── Respuestas de la API ────────────────────────────────────────────────────
export type TicketDeTipificacion = {
  id: string;
  numero: number;
  asunto: string;
  estado_codigo: string;
  estado_nombre: string;
  estado_color: string | null;
  prioridad_codigo: string;
  prioridad_nombre: string;
};
export type CitaDeTipificacion = { id: string; inicio_at: string; fin_at: string; estado: string; responsable: string | null };
export type Tipificacion = {
  id: string;
  fecha: string;
  usuario: string;
  usuario_id: string | null;
  tipo_gestion: string;
  resultado: string;
  observacion: string;
  ticket: TicketDeTipificacion | null;
  cita: CitaDeTipificacion | null;
};
export type Clasificacion = { codigo: string; tipo_codigo: string; nombre: string; sla_horas: number; prioridad_sugerida: string | null };
export type PersonaEquipo = { id: string; nombre: string; rol: string };

/** Fila del registro (tipificaciones_registro, receta 81): la tipificación con su cliente. */
export type TipificacionRegistro = Tipificacion & {
  familia_id: string | null;
  estado_id: string | null;
  cliente: { id: string; nombre: string; codigo: string | null; ruc: string | null; documento: string | null };
};
export type RegistroTipificaciones = { total: number; filas: TipificacionRegistro[] };

export type ClienteTipificacion = {
  id: string; nombre: string; codigo: string | null; ruc: string | null; documento: string | null;
  telefono: string | null; email: string | null; activo: boolean; baja_at: string | null;
};
/** GET /api/clientes/[id]/tipificaciones: el cliente y su historial (más nuevas primero). */
export type HistorialTipificaciones = { cliente: ClienteTipificacion; total: number; tipificaciones: TipificacionRegistro[] };

/**
 * GET /api/tipificaciones/contexto: todo lo que el formulario necesita y NO depende del
 * cliente (catálogo activo, equipo, horario, clasificaciones de Soporte…). Se cachea en el
 * navegador: abrir el formulario no espera a la red.
 */
export type ContextoTipificacion = {
  familias: EstadoCat[];
  usuario_actual: { id: string; nombre: string };
  es_admin: boolean;
  equipo: PersonaEquipo[];
  puede_soporte: boolean;
  horario: Horario;
  clasificaciones: Clasificacion[];
  prioridades: { codigo: string; nombre: string; color: string | null }[];
  responsable_defecto: { id: string; nombre: string } | null;
};

/** Respuesta del alta: lo creado y la fila lista para sumar al historial sin recargar. */
export type AltaTipificacion = {
  tipificacion_id: string;
  ticket: { id: string; numero: number } | null;
  cita_id: string | null;
  fila: TipificacionRegistro | null;
};

/** Acción del sub-estado como texto corto ("crea ticket", "agenda capacitación"). */
export function sufijoAccion(c: Comportamiento | null | undefined): string {
  return c === "ticket_error" || c === "ticket_cambio" ? "crea ticket" : c === "capacitacion" ? "agenda capacitación" : "";
}
