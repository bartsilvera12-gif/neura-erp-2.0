/**
 * CRM Funnel — tipos y helpers compartidos (front y API). Sin dependencias de React.
 */
import { TZ_PY } from "@/lib/fecha/paraguay";

/** Tarjeta del tablero (la misma forma devuelven crm_tablero, crm_columna y crm_lista). */
export type Tarjeta = {
  id: string;
  numero_control: string;
  empresa: string | null;
  contacto: string;
  telefono: string | null;
  email: string | null;
  servicio: string | null;
  valor_estimado: number;
  etapa: string;
  proxima_accion: string | null;
  fecha_proxima_accion: string | null;
  origen_creacion: Origen;
  responsable_usuario_id: string | null;
  responsable_nombre: string | null;
  cliente_id: string | null;
  updated_at: string;
  created_at: string;
  etapa_desde: string;
  accion_vencida: boolean;
};

export type Etapa = {
  codigo: string;
  nombre: string;
  color: string;
  orden: number;
  es_ganado: boolean;
  es_perdido: boolean;
};

export type Columna = Etapa & { cantidad: number; total: number; tarjetas: Tarjeta[] };

export type Kpis = {
  leads_hoy: number;
  leads_mes: number;
  en_negociacion: number;
  ganados_mes: number;
  acciones_vencidas: number;
};

export type Tablero = { columnas: Columna[]; kpis: Kpis };

/** Prospecto completo (detalle). */
export type Prospecto = Tarjeta & {
  observaciones: string | null;
  origen_detalle: string | null;
  motivo_perdida: string | null;
  created_by: string | null;
  creado_por_nombre: string | null;
};

export type Nota = {
  id: string;
  tipo: "nota" | "llamada" | "whatsapp" | "email" | "reunion" | "cambio_etapa" | "sistema";
  texto: string;
  usuario_id: string | null;
  usuario_nombre: string | null;
  created_at: string;
};

export const ORIGENES = ["manual", "whatsapp", "formulario_web", "referido", "campana", "automatizacion", "otro"] as const;
export type Origen = (typeof ORIGENES)[number];

export const ORIGEN_LABEL: Record<Origen, string> = {
  manual: "Manual",
  whatsapp: "WhatsApp",
  formulario_web: "Formulario web",
  referido: "Referido",
  campana: "Campaña",
  automatizacion: "Automatización",
  otro: "Otro",
};

export const COLORES_ETAPA = ["gray", "blue", "amber", "green", "red", "violet", "cyan", "pink"] as const;
export const COLOR_LABEL: Record<string, string> = {
  gray: "Gris", blue: "Azul", amber: "Ámbar", green: "Verde", red: "Rojo", violet: "Violeta", cyan: "Cian", pink: "Rosa",
};

/** Filtros del tablero / lista (los mismos parámetros en las tres consultas). */
export type Filtros = { q: string; responsable: string; mios: boolean; hoy: boolean };

export function filtrosQuery(f: Filtros): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.q.trim()) sp.set("q", f.q.trim());
  if (f.responsable) sp.set("responsable", f.responsable);
  if (f.mios) sp.set("mios", "1");
  if (f.hoy) sp.set("hoy", "1");
  return sp;
}

// ── Formatos ──────────────────────────────────────────────────────────────────
export const gsCompleto = (v: number | string | null | undefined) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;

/** Monto corto para totales de columna / KPIs: 1,2M · 350k. */
export function gsCorto(valor: number): string {
  const v = Number(valor) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString("es-PY", { maximumFractionDigits: 1 })}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000).toLocaleString("es-PY")}k`;
  return v.toLocaleString("es-PY");
}

/** dd/mm en hora de Paraguay. */
export function diaMes(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "2-digit" });
}

/** "YYYY-MM-DD" (fecha sin hora) → dd/mm/yyyy, sin correrse de día por zona horaria. */
export function fechaSimple(ymd: string | null | undefined): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : "";
}

/** Teléfono: solo dígitos (y un + inicial). */
export const limpiarTelefono = (t: string) => t.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "").slice(0, 16);

/** 0981100453 → 0981 100 453 (solo para mostrar). */
export function telefonoLindo(t: string | null | undefined): string {
  const raw = (t ?? "").trim();
  const d = raw.replace(/\D/g, "");
  if (d.length === 10 && d.startsWith("0")) return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  if (d.length === 12 && d.startsWith("595")) return `+595 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;
  return raw;
}

export const telefonoValido = (t: string) => {
  const d = t.replace(/\D/g, "");
  return d.length >= 6 && d.length <= 15;
};

// ── Colores de etapa (mismos tonos que el sistema actual) ────────────────────
export type Tono = { borderLeft: string; dot: string; headerBg: string; headerBorder: string; badge: string };

const TONOS: Record<string, Tono> = {
  gray: { borderLeft: "border-l-slate-400", dot: "bg-slate-400", headerBg: "bg-slate-50/70", headerBorder: "border-slate-200", badge: "border-slate-200 bg-slate-50 text-slate-600" },
  blue: { borderLeft: "border-l-sky-500", dot: "bg-sky-500", headerBg: "bg-sky-50/70", headerBorder: "border-sky-200", badge: "border-sky-200 bg-sky-50 text-sky-700" },
  amber: { borderLeft: "border-l-amber-500", dot: "bg-amber-500", headerBg: "bg-amber-50/70", headerBorder: "border-amber-200", badge: "border-amber-200 bg-amber-50 text-amber-700" },
  green: { borderLeft: "border-l-emerald-500", dot: "bg-emerald-500", headerBg: "bg-emerald-50/70", headerBorder: "border-emerald-200", badge: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  red: { borderLeft: "border-l-rose-500", dot: "bg-rose-500", headerBg: "bg-rose-50/70", headerBorder: "border-rose-200", badge: "border-rose-200 bg-rose-50 text-rose-700" },
  violet: { borderLeft: "border-l-violet-500", dot: "bg-violet-500", headerBg: "bg-violet-50/70", headerBorder: "border-violet-200", badge: "border-violet-200 bg-violet-50 text-violet-700" },
  cyan: { borderLeft: "border-l-cyan-500", dot: "bg-cyan-500", headerBg: "bg-cyan-50/70", headerBorder: "border-cyan-200", badge: "border-cyan-200 bg-cyan-50 text-cyan-700" },
  pink: { borderLeft: "border-l-pink-500", dot: "bg-pink-500", headerBg: "bg-pink-50/70", headerBorder: "border-pink-200", badge: "border-pink-200 bg-pink-50 text-pink-700" },
};

export const tonoEtapa = (color: string | null | undefined): Tono => TONOS[color ?? ""] ?? TONOS.gray;

/** ¿La etapa es "abierta" (cuenta para el valor en negociación)? */
export const etapaAbierta = (e: Pick<Etapa, "es_ganado" | "es_perdido"> | undefined) => !!e && !e.es_ganado && !e.es_perdido;
