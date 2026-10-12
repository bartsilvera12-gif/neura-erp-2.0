/**
 * Dominio del módulo Soporte (copia fiel del sistema actual, vuelto genérico):
 * tipos, flujo de estados, reloj laboral, SLA y formatos.
 *
 * Isomórfico: lo importan las rutas de API y las pantallas. No toca la base.
 *
 * Diferencias con el actual (decisiones del 9-oct-2026):
 *   · no hay Proyecto: el ticket va contra el cliente;
 *   · la revisión de QA se activa por empresa (soporte_config.qa_activo). Apagada,
 *     En proceso / Re-abierto pasan directo a Resuelto y no se ofrece "Listo para revisión";
 *   · no hay guardias: el horario laboral sale de soporte_config.
 */

// ---------------------------------------------------------------- catálogos

export type SoporteEstado = {
  codigo: string;
  nombre: string;
  tipo: "abierto" | "cerrado";
  color: string;
  area: string | null;
  detiene_sla: boolean;
  es_inicial: boolean;
  sort_order: number;
  activo: boolean;
};

export type SoporteTipo = { codigo: string; nombre: string; sla_horas: number | null; sort_order: number; activo: boolean };

export type SoporteClasificacion = {
  codigo: string;
  tipo_codigo: string;
  nombre: string;
  sla_horas: number | null;
  prioridad_sugerida: string | null;
  sort_order: number;
  activo: boolean;
};

export type SoportePrioridad = { codigo: string; nombre: string; color: string; sort_order: number; activo: boolean };

/** Horario laboral del SLA (soporte_config). sabado_hasta = 0: el sábado no se trabaja. */
export type HorarioLaboral = { hora_inicio: number; hora_fin: number; sabado_hasta: number };

export const HORARIO_DEFECTO: HorarioLaboral = { hora_inicio: 8, hora_fin: 17, sabado_hasta: 12 };

export type ConfigSoporte = HorarioLaboral & { qa_activo: boolean; responsable_defecto_id: string | null };

export type CatalogosSoporte = {
  estados: SoporteEstado[];
  tipos: SoporteTipo[];
  clasificaciones: SoporteClasificacion[];
  prioridades: SoportePrioridad[];
};

// -------------------------------------------------------------------- flujo

/**
 * Transiciones del flujo (iguales al actual):
 *
 *   Pendiente → En proceso · Falta información · Cancelado
 *   En proceso → Cancelado · Falta información · Listo para revisión
 *   Falta información → En proceso · Cancelado
 *   Listo para revisión → Resuelto (con las subtareas finalizadas)
 *     · a Re-abierto / En proceso lo lleva QA al pedir cambios en la subtarea, no a mano
 *   Re-abierto → En proceso · Falta información · Cancelado
 *   Resuelto → Re-abierto · Cerrado
 *   Cancelado y Cerrado son finales.
 *
 * Un estado creado desde Configuración no tiene reglas propias: se permite
 * moverse libremente desde y hacia él.
 */
export const TRANSICIONES: Record<string, string[]> = {
  pendiente: ["en_proceso", "falta_informacion", "cancelado"],
  en_proceso: ["cancelado", "falta_informacion", "listo_revision"],
  falta_informacion: ["en_proceso", "cancelado"],
  listo_revision: ["resuelto"],
  reabierto: ["en_proceso", "falta_informacion", "cancelado"],
  resuelto: ["reabierto", "cerrado"],
  cancelado: [],
  cerrado: [],
};

/** Número visible del ticket, con cuatro dígitos: 1 → "#0001". */
export function numeroTicket(numero: number | string | null | undefined): string {
  const n = Number(numero);
  return Number.isFinite(n) && n > 0 ? `#${String(Math.trunc(n)).padStart(4, "0")}` : "#—";
}

/** Mensaje de un estado final: desde acá ya no hay cambios de estado. */
export function mensajeEstadoFinal(ticket: { numero: number; estado_codigo: string }, nombreEstado: string): string | null {
  const reglas = TRANSICIONES[ticket.estado_codigo];
  if (!reglas || reglas.length > 0) return null;
  return `Error, Ticket ${numeroTicket(ticket.numero)} ${nombreEstado}: ya no pueden realizarse cambios de estado`;
}

/** Estados a los que no se puede pasar con subtareas sin finalizar. */
export const ESTADOS_EXIGEN_SUBTAREAS_FINALIZADAS = ["resuelto", "cerrado"];

/** Sin QA, estos estados pueden pasar directo a Resuelto. */
export const ESTADOS_RESOLUBLES_SIN_QA = ["en_proceso", "reabierto"];

export function transicionPermitida(desde: string, hacia: string, opciones: { qaActivo: boolean }): boolean {
  if (desde === hacia) return false;
  const sinQa = !opciones.qaActivo;
  if (sinQa && hacia === "resuelto" && ESTADOS_RESOLUBLES_SIN_QA.includes(desde)) return true;
  if (sinQa && hacia === "listo_revision") return false;
  const reglas = TRANSICIONES[desde];
  if (!reglas) return true;
  if (!(hacia in TRANSICIONES)) return true;
  return reglas.includes(hacia);
}

/**
 * El evento de historial que corresponde a un cambio de estado. Los hitos de QA
 * y el cierre tienen nombre propio: son los que cuentan los reportes.
 */
export function eventoDeTransicion(desde: string, hacia: string): string {
  if (hacia === "listo_revision") return "entrega_qa";
  if (desde === "listo_revision" && hacia === "reabierto") return "devolucion_qa";
  if (desde === "listo_revision" && hacia === "resuelto") return "confirmacion_qa";
  if (hacia === "resuelto" && ESTADOS_RESOLUBLES_SIN_QA.includes(desde)) return "resuelto_sin_qa";
  if (hacia === "cerrado") return "cierre";
  if (hacia === "cancelado") return "cancelacion";
  if (hacia === "reabierto") return "reapertura";
  return "cambio_estado";
}

/** Eventos de historial cuyo valor es un código de estado. */
export const EVENTOS_DE_ESTADO = [
  "cambio_estado",
  "entrega_qa",
  "devolucion_qa",
  "confirmacion_qa",
  "resuelto_sin_qa",
  "cierre",
  "cancelacion",
  "reapertura",
  "creacion",
];

// --------------------------------------------------------------- subtareas

export type EstadoSubtarea = "pendiente" | "en_proceso" | "cambios_solicitados" | "finalizado";

export const ESTADOS_SUBTAREA: { codigo: EstadoSubtarea; nombre: string; color: string }[] = [
  { codigo: "pendiente", nombre: "Pendiente", color: "#94a3b8" },
  { codigo: "en_proceso", nombre: "En proceso", color: "#0ea5e9" },
  { codigo: "cambios_solicitados", nombre: "Cambios solicitados", color: "#f97316" },
  { codigo: "finalizado", nombre: "Finalizado", color: "#10b981" },
];

export const TRANSICIONES_SUBTAREA: Record<EstadoSubtarea, EstadoSubtarea[]> = {
  pendiente: ["en_proceso", "cambios_solicitados", "finalizado"],
  en_proceso: ["cambios_solicitados", "finalizado"],
  cambios_solicitados: [],
  finalizado: [],
};

/** Una subtarea está abierta mientras QA la tiene en mano (Pendiente o En proceso). */
export function subtareaAbierta(estado: string): boolean {
  return estado === "pendiente" || estado === "en_proceso";
}

export function nombreEstadoSubtarea(codigo: string): string {
  return ESTADOS_SUBTAREA.find((e) => e.codigo === codigo)?.nombre ?? codigo;
}

/**
 * Quién puede quedar a cargo de un ticket: Técnico o QA. Si en la empresa nadie
 * tiene esos tildes, puede quedar a cargo un ADMIN (para no trabar el flujo).
 */
export function puedeEstarACargo(
  p: { es_tecnico?: boolean | null; es_qa?: boolean | null; rol?: string | null },
  hayEquipo: boolean,
): boolean {
  if (p.es_tecnico === true || p.es_qa === true) return true;
  return !hayEquipo && (p.rol ?? "").toUpperCase() === "ADMIN";
}

/** Un estado abierto que no es el inicial necesita a alguien con la próxima acción. */
export function requiereResponsable(estado: SoporteEstado | undefined): boolean {
  if (!estado) return false;
  return estado.tipo === "abierto" && !estado.es_inicial;
}

// ------------------------------------------------------------- reloj laboral

/** Paraguay: UTC-3 fijo (sin horario de verano desde 2024). */
export const TZ_OFFSET_MIN = -180;
const MIN_MS = 60_000;
const HORA_MS = 60 * MIN_MS;
const DIA_MS = 24 * HORA_MS;
const SEMANA_MS = 7 * DIA_MS;
/** Lunes 3 de enero de 2000, 00:00 local. */
const ANCLA_LOCAL_MS = Date.UTC(2000, 0, 3);

type Ventana = readonly [number, number] | null;

/** Ventanas por día, desde el LUNES (0) al domingo (6), en minutos locales. */
function ventanas(h: HorarioLaboral): Ventana[] {
  const ini = h.hora_inicio * 60;
  const semana: Ventana = h.hora_fin > h.hora_inicio ? [ini, h.hora_fin * 60] : null;
  const sabado: Ventana = h.sabado_hasta > h.hora_inicio ? [ini, h.sabado_hasta * 60] : null;
  return [semana, semana, semana, semana, semana, sabado, null];
}

const aLocal = (ms: number) => ms + TZ_OFFSET_MIN * MIN_MS;

function acumulado(localMs: number, vs: Ventana[], msSemana: number): number {
  const delta = localMs - ANCLA_LOCAL_MS;
  if (delta <= 0) return 0;
  const semanas = Math.floor(delta / SEMANA_MS);
  const resto = delta - semanas * SEMANA_MS;
  let total = semanas * msSemana;
  for (let d = 0; d < 7; d++) {
    const v = vs[d];
    if (!v) continue;
    const inicio = d * DIA_MS + v[0] * MIN_MS;
    const fin = d * DIA_MS + v[1] * MIN_MS;
    if (resto <= inicio) break;
    total += Math.min(resto, fin) - inicio;
    if (resto <= fin) break;
  }
  return total;
}

/** Milisegundos de horario laboral entre dos instantes (hasta = ahora si falta). */
export function msLaborables(desdeIso: string | null | undefined, hastaIso: string | null | undefined, horario: HorarioLaboral): number | null {
  if (typeof desdeIso !== "string" || !desdeIso.trim()) return null;
  const desde = Date.parse(desdeIso);
  if (!Number.isFinite(desde)) return null;
  const hasta = typeof hastaIso === "string" && hastaIso.trim() ? Date.parse(hastaIso) : Date.now();
  if (!Number.isFinite(hasta)) return null;
  const vs = ventanas(horario);
  const msSemana = vs.reduce((s, v) => s + (v ? (v[1] - v[0]) * MIN_MS : 0), 0);
  if (msSemana <= 0) return 0;
  return Math.max(0, acumulado(aLocal(hasta), vs, msSemana) - acumulado(aLocal(desde), vs, msSemana));
}

/** El instante en que se cumplen `ms` laborales contados desde `desdeMs`. */
export function sumarMsLaborables(desdeMs: number, ms: number, horario: HorarioLaboral): number {
  if (!Number.isFinite(desdeMs) || !Number.isFinite(ms) || ms <= 0) return desdeMs;
  const vs = ventanas(horario);
  if (!vs.some(Boolean)) return desdeMs;
  let restante = ms;
  let local = aLocal(desdeMs);
  for (let i = 0; i < 3660; i++) {
    const delta = local - ANCLA_LOCAL_MS;
    const enSemana = ((delta % SEMANA_MS) + SEMANA_MS) % SEMANA_MS;
    const dia = Math.floor(enSemana / DIA_MS);
    const inicioDia = local - (enSemana - dia * DIA_MS);
    const v = vs[dia];
    if (v) {
      const abre = inicioDia + v[0] * MIN_MS;
      const cierra = inicioDia + v[1] * MIN_MS;
      const desde = Math.max(local, abre);
      if (desde < cierra) {
        const disponible = cierra - desde;
        if (restante <= disponible) return desde + restante - TZ_OFFSET_MIN * MIN_MS;
        restante -= disponible;
      }
    }
    local = inicioDia + DIA_MS;
  }
  return local - TZ_OFFSET_MIN * MIN_MS;
}

// ---------------------------------------------------------------------- SLA

export type EstadoSla = "sin_sla" | "en_tiempo" | "en_riesgo" | "vencido" | "cumplido" | "incumplido";

export type InfoSla = { estado: EstadoSla; transcurridoMs: number; objetivoMs: number | null; proporcion: number | null };

/** A partir del 75% del SLA consumido, el ticket está "en riesgo". */
export const SLA_UMBRAL_RIESGO = 0.75;

/**
 * Estado del SLA, medido en horas LABORALES desde la creación hasta que el
 * ticket entra a un estado que detiene el SLA (resuelto_at) o hasta ahora.
 */
export function calcularSla(
  t: { created_at: string; sla_horas: number | string | null; resuelto_at: string | null },
  horario: HorarioLaboral,
  ahoraIso: string = new Date().toISOString(),
): InfoSla {
  const horas = t.sla_horas == null ? null : Number(t.sla_horas);
  const hasta = t.resuelto_at ?? ahoraIso;
  const transcurridoMs = Math.max(0, msLaborables(t.created_at, hasta, horario) ?? 0);
  if (horas == null || !Number.isFinite(horas) || horas <= 0) {
    return { estado: "sin_sla", transcurridoMs, objetivoMs: null, proporcion: null };
  }
  const objetivoMs = horas * HORA_MS;
  const proporcion = transcurridoMs / objetivoMs;
  let estado: EstadoSla;
  if (t.resuelto_at) estado = proporcion <= 1 ? "cumplido" : "incumplido";
  else if (proporcion > 1) estado = "vencido";
  else if (proporcion >= SLA_UMBRAL_RIESGO) estado = "en_riesgo";
  else estado = "en_tiempo";
  return { estado, transcurridoMs, objetivoMs, proporcion };
}

/** Cuándo vence: `horas` laborales contadas desde `desde`. */
export function vencimientoSla(desde: string | number, horas: number | null | undefined, horario: HorarioLaboral): string | null {
  if (horas == null || !Number.isFinite(Number(horas)) || Number(horas) <= 0) return null;
  const ms = typeof desde === "number" ? desde : Date.parse(desde);
  if (!Number.isFinite(ms)) return null;
  return new Date(sumarMsLaborables(ms, Number(horas) * HORA_MS, horario)).toISOString();
}

/** SLA de un ticket según su clasificación, o el del tipo si no tiene. */
export function slaDe(cat: CatalogosSoporte, tipoCodigo: string, clasificacionCodigo: string | null | undefined): number | null {
  if (clasificacionCodigo) {
    const c = cat.clasificaciones.find((x) => x.codigo === clasificacionCodigo);
    if (c) return c.sla_horas == null ? null : Number(c.sla_horas);
  }
  const t = cat.tipos.find((x) => x.codigo === tipoCodigo);
  return t?.sla_horas == null ? null : Number(t.sla_horas);
}

/** Etiqueta del tipo: los cambios se abren en estético/funcional (SLA muy distinto). */
export function etiquetaTipo(cat: CatalogosSoporte, tipoCodigo: string, clasificacionCodigo: string | null): string {
  if (tipoCodigo === "cambio" && clasificacionCodigo) {
    const c = cat.clasificaciones.find((x) => x.codigo === clasificacionCodigo);
    if (c) return c.nombre;
  }
  return cat.tipos.find((x) => x.codigo === tipoCodigo)?.nombre ?? tipoCodigo;
}

// ------------------------------------------------------------------ tickets

export type TicketFila = {
  id: string;
  numero: number;
  asunto: string;
  descripcion: string | null;
  resultado_esperado: string | null;
  impacto_operativo: string | null;
  cliente_id: string | null;
  tipo_codigo: string;
  clasificacion_codigo: string | null;
  prioridad_codigo: string;
  estado_codigo: string;
  responsable_id: string | null;
  proxima_accion: string | null;
  sla_horas: number | string | null;
  fecha_objetivo: string | null;
  fase: number;
  origen: string | null;
  tipificacion_id: string | null;
  resuelto_at: string | null;
  cerrado_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export const TICKET_CAMPOS =
  "id, numero, asunto, descripcion, resultado_esperado, impacto_operativo, cliente_id, tipo_codigo, clasificacion_codigo, prioridad_codigo, estado_codigo, responsable_id, proxima_accion, sla_horas, fecha_objetivo, fase, origen, tipificacion_id, resuelto_at, cerrado_at, created_by, updated_by, created_at, updated_at";

export type Persona = {
  id: string;
  nombre: string;
  rol: string | null;
  /** Etiqueta junto al nombre: Técnico, QA, Admin, Equipo. */
  area: string;
  es_tecnico: boolean;
  es_qa: boolean;
  usa_soporte: boolean;
};

/** Pestañas del listado. */
export const PESTANAS_TICKETS = [
  { id: "todos", etiqueta: "Todos", estados: null as string[] | null },
  { id: "pendientes", etiqueta: "Pendientes", estados: ["pendiente"] },
  { id: "en_proceso", etiqueta: "En proceso", estados: ["en_proceso", "reabierto"] },
  { id: "falta_informacion", etiqueta: "Falta información", estados: ["falta_informacion"] },
  { id: "revision", etiqueta: "En revisión", estados: ["listo_revision"] },
  { id: "resueltos", etiqueta: "Resueltos", estados: ["resuelto"] },
  { id: "cerrados", etiqueta: "Cerrados", estados: ["cerrado", "cancelado"] },
] as const;

export const TIPOS_RELACION = [
  { codigo: "relacionado", nombre: "Relacionado con" },
  { codigo: "duplicado_de", nombre: "Duplicado de" },
  { codigo: "bloquea", nombre: "Bloquea" },
  { codigo: "bloqueado_por", nombre: "Bloqueado por" },
  { codigo: "deriva_de", nombre: "Deriva de" },
] as const;

// ------------------------------------------------------------------ archivos

/**
 * Se acepta cualquier archivo salvo lo que se ejecuta o se abre como página
 * (.exe, .bat, .html, .svg…): el bucket se sirve por URL firmada.
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
  if (EXTENSIONES_BLOQUEADAS.test(nombre.trim())) return false;
  return !MIMES_BLOQUEADOS.has((mime || "").toLowerCase());
}

export function tamanoLegible(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ------------------------------------------------------------------ formatos

const OFFSET_PY = "-03:00";

/** Fecha objetivo del formulario (`YYYY-MM-DDTHH:mm` hora PY, o fecha sola → 17:00) a ISO. */
export function fechaObjetivoAIso(v: string): string | undefined {
  const t = v.trim();
  let candidato: string;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)) candidato = `${t}:00${OFFSET_PY}`;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(t)) candidato = `${t}T17:00:00${OFFSET_PY}`;
  else candidato = t;
  const ms = Date.parse(candidato);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

/** ISO → `YYYY-MM-DDTHH:mm` en hora de Paraguay, para <input type="datetime-local">. */
export function isoAFechaHoraLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + TZ_OFFSET_MIN * 60_000).toISOString().slice(0, 16);
}

/** "18/09/2026 09:00" en hora de Paraguay. */
export function fechaHora(iso: string | null | undefined): string {
  const l = isoAFechaHoraLocal(iso);
  if (!l) return "—";
  return `${l.slice(8, 10)}/${l.slice(5, 7)}/${l.slice(0, 4)} ${l.slice(11, 16)}`;
}

/** "18/09/2026" (acepta YYYY-MM-DD o un instante). */
export function fecha(valor: string | null | undefined): string {
  if (!valor) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor.split("-").reverse().join("/");
  return fechaHora(valor).slice(0, 10);
}

/** "1h 12m" — lectura humana de una duración. */
export function duracionCorta(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Hoy en Paraguay, "YYYY-MM-DD". */
export function hoyPy(): string {
  return new Date(Date.now() + TZ_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}
