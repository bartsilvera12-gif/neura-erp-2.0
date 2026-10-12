/**
 * Agenda — horario laboral y fechas en hora de Paraguay (isomórfico: lo usan la API y
 * las pantallas). Antes vivía en tipificacion/dominio; Tipificación lo re-exporta.
 *
 * El horario sale de soporte_config (hora_inicio, hora_fin, sabado_hasta): con él se
 * BLOQUEAN las capacitaciones fuera de horario (Tipificación) y se ADVIERTE en el
 * formulario de Agenda.
 */

export type Horario = { hora_inicio: number; hora_fin: number; sabado_hasta: number };
export const HORARIO_DEFECTO: Horario = { hora_inicio: 8, hora_fin: 17, sabado_hasta: 12 };

/** Paraguay: UTC-3 fijo (sin horario de verano desde 2024). */
const OFFSET_MIN = -180;
const MIN_MS = 60_000;
const DIA_MS = 24 * 60 * MIN_MS;

const aLocal = (ms: number) => ms + OFFSET_MIN * MIN_MS;

/** Ventana [desde, hasta) en minutos del día local, o null si no se trabaja. dow: 0=domingo. */
export function ventanaLaboral(h: Horario, dow: number): [number, number] | null {
  if (dow === 0) return null;
  const fin = dow === 6 ? h.sabado_hasta : h.hora_fin;
  if (!fin || fin <= h.hora_inicio) return null;
  return [h.hora_inicio * 60, fin * 60];
}

/** Texto del horario: "lun a vie 8 a 17, sáb 8 a 12". */
export function textoHorario(h: Horario = HORARIO_DEFECTO): string {
  const sab = h.sabado_hasta > h.hora_inicio ? `, sáb ${h.hora_inicio} a ${h.sabado_hasta}` : ", sáb no se trabaja";
  return `lun a vie ${h.hora_inicio} a ${h.hora_fin}${sab}`;
}

/** Mensaje del bloqueo por horario (igual que el actual, con el horario de la empresa). */
export function mensajeHorario(h: Horario = HORARIO_DEFECTO): string {
  const sab = h.sabado_hasta > h.hora_inicio ? ` y sábados de ${h.hora_inicio} a ${h.sabado_hasta}` : "";
  return `La capacitación tiene que entrar en horario laboral: lunes a viernes de ${h.hora_inicio} a ${h.hora_fin}${sab}.`;
}

/** ¿El rango [desde, hasta] entra completo en UNA jornada laboral? */
export function rangoEnHorarioLaboral(desdeMs: number, hastaMs: number, h: Horario = HORARIO_DEFECTO): boolean {
  if (!Number.isFinite(desdeMs) || !Number.isFinite(hastaMs) || hastaMs <= desdeMs) return false;
  const local = aLocal(desdeMs);
  const inicioDia = Math.floor(local / DIA_MS) * DIA_MS;
  const v = ventanaLaboral(h, new Date(inicioDia).getUTCDay());
  if (!v) return false;
  return local >= inicioDia + v[0] * MIN_MS && aLocal(hastaMs) <= inicioDia + v[1] * MIN_MS;
}

// ── Fechas (hora de Paraguay, sin depender del navegador) ───────────────────
/** `YYYY-MM-DDTHH:mm` (hora de Paraguay) → ISO. undefined si no se puede leer. */
export function fechaLocalAIso(v: string): string | undefined {
  const t = (v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)) return undefined;
  const ms = Date.parse(`${t}:00-03:00`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

/** ISO → `YYYY-MM-DDTHH:mm` en hora de Paraguay. */
export function isoAFechaLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(aLocal(ms)).toISOString().slice(0, 16);
}

/** "09:30" en hora de Paraguay. */
export function horaPY(iso: string | null | undefined): string {
  return isoAFechaLocal(iso).slice(11, 16) || "—";
}
