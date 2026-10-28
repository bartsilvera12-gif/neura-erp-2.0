/**
 * Conversaciones — dominio isomórfico (lo usan la API y las pantallas).
 * Tipos de la bandeja y del hilo, ventana de 24 h de WhatsApp, plantillas, límites de
 * adjuntos y formatos de hora (America/Asuncion).
 */
import { TZ_PY } from "@/lib/fecha/paraguay";

export type Vista = "mias" | "sin_asignar" | "todas" | "cerradas";
export const VISTAS: { id: Vista; label: string }[] = [
  { id: "mias", label: "Mías" },
  { id: "sin_asignar", label: "Sin asignar" },
  { id: "todas", label: "Todas" },
  { id: "cerradas", label: "Cerradas" },
];
export const esVista = (v: unknown): v is Vista => v === "mias" || v === "sin_asignar" || v === "todas" || v === "cerradas";

export type EstadoConversacion = "abierta" | "pendiente" | "cerrada";

/** Una fila de la lista (lo que devuelve chat_bandeja y /resumen). */
export type FilaBandeja = {
  id: string;
  estado: EstadoConversacion;
  asignado_id: string | null;
  asignado_nombre: string | null;
  canal_id: string;
  canal_tipo: string;
  canal_nombre: string;
  /** Cola de atención en la que está (null = sin cola). */
  cola_id?: string | null;
  cola_nombre?: string | null;
  prioridad: number;
  ultimo_mensaje_at: string | null;
  ultimo_preview: string | null;
  ultimo_from_me: boolean | null;
  ultimo_tipo: string | null;
  no_leidos: number;
  ventana_expira_at: string | null;
  /** SLA de primera respuesta (colas): vence a los N min de asignada; null si ya respondieron. */
  sla_vence_at?: string | null;
  primera_respuesta_at?: string | null;
  etiquetas: string[];
  contacto_id: string;
  contacto_nombre: string | null;
  contacto_telefono: string | null;
  avatar_url: string | null;
  cliente_id: string | null;
  prospecto_id: string | null;
  /** Con búsqueda: fragmento del mensaje anterior que coincidió (si no fue el último). */
  coincidencia?: string | null;
};

export type Contadores = { mias: number; mias_no_leidas: number; sin_asignar: number; abiertas: number };
export const CONTADORES_VACIOS: Contadores = { mias: 0, mias_no_leidas: 0, sin_asignar: 0, abiertas: 0 };

/** Sin búsqueda: keyset (at, id). Con búsqueda (orden por relevancia): `offset`. */
export type Cursor = { at: string; id: string; offset?: number };
export type PaginaBandeja = { rows: FilaBandeja[]; contadores: Contadores; siguiente: Cursor | null };

export type TipoMensaje =
  | "texto" | "imagen" | "audio" | "video" | "documento" | "sticker" | "ubicacion" | "plantilla" | "reaccion" | "sistema" | "nota";
export type EstadoEntrega = "pendiente" | "enviado" | "entregado" | "leido" | "fallido" | "recibido";

export type Mensaje = {
  id: string;
  from_me: boolean;
  tipo: TipoMensaje;
  contenido: string | null;
  media_path: string | null;
  media_mime: string | null;
  media_nombre: string | null;
  media_size: number | null;
  responde_a: string | null;
  estado_entrega: EstadoEntrega;
  error: string | null;
  autor_usuario_id: string | null;
  autor_nombre: string | null;
  created_at: string;
  /** Solo en el navegador: burbuja optimista (todavía sin confirmar por el servidor). */
  local?: { url?: string; fallo?: string };
};

/** Columnas del hilo (nunca el payload crudo). */
export const COLS_MENSAJE =
  "id, from_me, tipo, contenido, media_path, media_mime, media_nombre, media_size, responde_a, estado_entrega, error, autor_usuario_id, created_at, autor:usuarios!autor_usuario_id(nombre)";

export const PAGINA_HILO = 50;
export const PAGINA_LISTA = 40;

/** Respuestas rápidas ("/hola"). */
export type RespuestaRapida = { id: string; atajo: string; texto: string; orden: number; activo: boolean; canal_id: string | null };

/** Lo que la bandeja necesita una vez (cacheado en el navegador). */
export type OpcionesBandeja = {
  yo: string;
  es_admin: boolean;
  puede_soporte: boolean;
  canales: { id: string; nombre: string; tipo: string; proveedor: string; activo: boolean }[];
  equipo: { id: string; nombre: string; rol: string }[];
  /** Colas activas (filtro de la bandeja y "Derivar a una cola"). */
  colas: { id: string; nombre: string; estrategia: string; solo_transferencia: boolean }[];
  respuestas: RespuestaRapida[];
  plantillas: Plantilla[];
};

// ── Plantillas ────────────────────────────────────────────────────────────────
// Stub SIN tabla: cuando haya proveedor real (Meta/YCloud) se reemplaza por las plantillas
// aprobadas del canal. Las variables son {{1}}, {{2}}… como en WhatsApp.
export type Plantilla = { id: string; nombre: string; idioma: string; texto: string };
export const PLANTILLAS: Plantilla[] = [
  {
    id: "recontacto",
    nombre: "Recontacto",
    idioma: "es",
    texto: "Hola {{1}}, te escribimos para dar seguimiento a tu consulta. ¿Seguimos por acá?",
  },
  {
    id: "recordatorio_pago",
    nombre: "Recordatorio de pago",
    idioma: "es",
    texto: "Hola {{1}}, te recordamos que tenés un saldo pendiente de {{2}}. Cualquier duda, respondé este mensaje.",
  },
  {
    id: "seguimiento_soporte",
    nombre: "Seguimiento de soporte",
    idioma: "es",
    texto: "Hola {{1}}, queríamos saber si quedó resuelto tu pedido {{2}}. ¡Gracias por tu paciencia!",
  },
];

export function variablesDePlantilla(texto: string): string[] {
  const vistos = new Set<string>();
  for (const m of texto.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) vistos.add(m[1]);
  return [...vistos];
}

export function rellenarPlantilla(texto: string, valores: Record<string, string>): string {
  return texto.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => (valores[k]?.trim() ? valores[k].trim() : `{{${k}}}`));
}

// ── Ventana de 24 h ──────────────────────────────────────────────────────────
/** WhatsApp: fuera de las 24 h desde el último mensaje del CLIENTE solo se aceptan plantillas. */
export function ventanaAbierta(c: { canal_tipo: string; ventana_expira_at: string | null }, ahora = Date.now()): boolean {
  if (c.canal_tipo !== "whatsapp") return true;
  const t = c.ventana_expira_at ? Date.parse(c.ventana_expira_at) : NaN;
  return Number.isFinite(t) && t > ahora;
}

// ── Adjuntos ─────────────────────────────────────────────────────────────────
/** Como WhatsApp: 100 MB por archivo, 16 MB para video. */
export const MAX_ADJUNTO_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 16 * 1024 * 1024;

export type TipoMedia = "imagen" | "audio" | "video" | "documento";
export function tipoDesdeMime(mime: string): TipoMedia {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return "imagen";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  return "documento";
}

export function limiteAdjunto(tipo: TipoMedia): number {
  return tipo === "video" ? MAX_VIDEO_BYTES : MAX_ADJUNTO_BYTES;
}

/** Vista previa corta de un mensaje (para citas y respuestas). */
export function previewMensaje(m: Pick<Mensaje, "tipo" | "contenido" | "media_nombre">): string {
  if (m.contenido?.trim()) return m.contenido.trim().slice(0, 140);
  switch (m.tipo) {
    case "imagen": return "📷 Imagen";
    case "audio": return "🎤 Audio";
    case "video": return "🎬 Video";
    case "documento": return `📎 ${m.media_nombre ?? "Documento"}`;
    case "sticker": return "Sticker";
    case "ubicacion": return "📍 Ubicación";
    default: return "Mensaje";
  }
}

// ── Contacto ─────────────────────────────────────────────────────────────────
export function nombreContacto(c: { contacto_nombre: string | null; contacto_telefono: string | null }): string {
  const n = c.contacto_nombre?.trim();
  if (n && /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(n)) return n;
  return "Sin nombre";
}

export function inicial(nombre: string): string {
  const m = nombre.replace(/^[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]+/, "").match(/[A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]/);
  return (m?.[0] ?? "?").toUpperCase();
}

/** +595 981 123456 */
export function telefonoLegible(t: string | null | undefined): string {
  const d = (t ?? "").replace(/\D/g, "");
  if (!d) return "—";
  if (d.startsWith("595") && d.length >= 11) return `+595 ${d.slice(3, 6)} ${d.slice(6)}`;
  return `+${d}`;
}

// ── Fechas (America/Asuncion) ────────────────────────────────────────────────
const F_HORA = new Intl.DateTimeFormat("es-PY", { timeZone: TZ_PY, hour: "2-digit", minute: "2-digit", hour12: false });
const F_DIA = new Intl.DateTimeFormat("en-CA", { timeZone: TZ_PY, year: "numeric", month: "2-digit", day: "2-digit" });
const F_SEMANA = new Intl.DateTimeFormat("es-PY", { timeZone: TZ_PY, weekday: "long" });
const F_SEMANA_CORTA = new Intl.DateTimeFormat("es-PY", { timeZone: TZ_PY, weekday: "short" });

export const horaPy = (iso: string) => F_HORA.format(new Date(iso));
/** "YYYY-MM-DD" del día en Paraguay. */
export const diaPy = (iso: string | number) => F_DIA.format(new Date(iso));

function diasAtras(iso: string): number {
  const hoy = Date.parse(`${diaPy(Date.now())}T00:00:00Z`);
  const dia = Date.parse(`${diaPy(iso)}T00:00:00Z`);
  return Math.round((hoy - dia) / 86_400_000);
}

/** Separador de días del hilo: "Hoy", "Ayer", "lunes 12/10/2026". */
export function etiquetaDia(iso: string): string {
  const n = diasAtras(iso);
  if (n === 0) return "Hoy";
  if (n === 1) return "Ayer";
  const d = diaPy(iso);
  return `${F_SEMANA.format(new Date(iso))} ${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

/** Hora de la tarjeta: hoy → 14:05 · ayer → Ayer · esta semana → lun. · antes → 12/10/26. */
export function horaLista(iso: string | null): string {
  if (!iso) return "";
  const n = diasAtras(iso);
  if (n === 0) return horaPy(iso);
  if (n === 1) return "Ayer";
  if (n < 7) return F_SEMANA_CORTA.format(new Date(iso));
  const d = diaPy(iso);
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`;
}

export function tamanoLegible(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "").replace(".", ",")} MB`;
}

/** Orden de la lista: último mensaje primero (mismo orden que chat_bandeja). */
export function compararFilas(a: FilaBandeja, b: FilaBandeja): number {
  const ta = a.ultimo_mensaje_at ? Date.parse(a.ultimo_mensaje_at) : 0;
  const tb = b.ultimo_mensaje_at ? Date.parse(b.ultimo_mensaje_at) : 0;
  if (ta !== tb) return tb - ta;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** ¿La fila entra en la vista/filtros actuales? (para el parche en vivo de la lista). */
export function filaEnVista(
  f: Pick<FilaBandeja, "estado" | "asignado_id" | "canal_id" | "cola_id">,
  vista: Vista,
  yo: string,
  filtros: { canal: string; asesor: string; cola?: string },
): boolean {
  const abierta = f.estado !== "cerrada";
  const okVista =
    vista === "mias" ? abierta && f.asignado_id === yo
    : vista === "sin_asignar" ? abierta && !f.asignado_id
    : vista === "cerradas" ? !abierta
    : abierta;
  if (!okVista) return false;
  if (filtros.canal && f.canal_id !== filtros.canal) return false;
  if (filtros.asesor && f.asignado_id !== filtros.asesor) return false;
  if (filtros.cola && (f.cola_id ?? null) !== filtros.cola) return false;
  return true;
}

export const ESTADO_LABEL: Record<EstadoConversacion, string> = { abierta: "Abierta", pendiente: "Pendiente", cerrada: "Cerrada" };
export const ESTADO_CLASE: Record<EstadoConversacion, string> = {
  abierta: "text-sky-800 bg-sky-50 border-sky-200",
  pendiente: "text-amber-800 bg-amber-50 border-amber-200",
  cerrada: "text-slate-600 bg-slate-100 border-slate-200",
};
