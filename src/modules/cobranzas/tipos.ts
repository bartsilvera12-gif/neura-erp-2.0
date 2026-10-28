/** Cobranzas — tipos y formato compartidos por las pantallas y la API. */

export type TramoKey = "por_vencer" | "tramo_1" | "tramo_2" | "tramo_3";

export type ServicioCobranza = {
  suscripcion_id: string | null;
  /** Nombre del plan de la suscripción; null = deuda sin suscripción ("General"). */
  plan: string | null;
  monto_mensual: number | null;
  total_adeudado: number;
  cuotas_vencidas: number;
  meses_adeudados: string[];
  tramo: TramoKey;
  proximo_vencimiento: string | null;
};

export type ClienteCobranza = {
  cliente_id: string;
  cliente_label: string;
  telefono: string | null;
  categoria: string | null;
  categoria_color: string | null;
  servicios: ServicioCobranza[];
  ultimo_pago: string | null;
  promesa_fecha: string | null;
  cobranza_enviada: boolean;
  mensaje_mes_fecha: string | null;
};

export type Seguimiento = { hoy: string; mes: string; clientes: ClienteCobranza[]; puede_registrar: boolean; es_admin: boolean };

export type CuotaDetalle = {
  id: string;
  numero: string;
  fecha_emision: string;
  vencimiento: string;
  monto: number;
  saldo: number;
  vencida: boolean;
  en_aprobacion: number;
  dias_atraso: number;
};

export type PromesaPago = {
  id: string;
  fecha_promesa: string;
  estado: "pendiente" | "cumplida" | "cancelada";
  creado_por: string | null;
  created_at: string;
  cerrada_motivo: string | null;
  cerrada_por: string | null;
};

export type DetalleCobranza = {
  hoy: string;
  cliente: {
    cliente_id: string; cliente_label: string; telefono: string | null; alta: string | null;
    categoria: string | null; categoria_color: string | null; mensaje_mes_fecha: string | null;
  };
  total_deuda: number;
  cuotas_vencidas: number;
  tramo: TramoKey;
  meses_adeudados: string[];
  monto_mensual: number | null;
  mas_vieja: { id: string; numero: string } | null;
  servicios: (Omit<ServicioCobranza, "meses_adeudados" | "proximo_vencimiento"> & { cuotas: CuotaDetalle[] })[];
  ultimo_pago: { id: string; numero_recibo: string; fecha: string; total: number; metodos: string | null; aplicado_a: string | null } | null;
  promesas: PromesaPago[];
  en_aprobacion: { id: string; numero: string; monto: number; fecha: string; banco_origen: string; numero_operacion: string }[];
  puede_registrar: boolean;
};

export type EstadoCobroPendiente = "pendiente" | "aprobado" | "rechazado" | "anulado";

export type CobroPendiente = {
  id: string;
  cxc_id: string;
  cliente_id: string;
  monto: number;
  fecha: string;
  banco_origen: string;
  titular: string;
  numero_operacion: string;
  referencia_generada: boolean;
  grupo_id: string | null;
  estado: EstadoCobroPendiente;
  motivo_rechazo: string | null;
  motivo_anulacion: string | null;
  comprobante_path: string | null;
  cobro_id: string | null;
  creado_por_nombre: string | null;
  created_at: string;
  aprobado_por_nombre: string | null; aprobado_at: string | null;
  rechazado_por_nombre: string | null; rechazado_at: string | null;
  anulado_por_nombre: string | null; anulado_at: string | null;
  numero_factura: string;
  saldo_factura: number;
  vencimiento_factura: string;
  cliente_nombre: string;
  plan: string | null;
  categoria: string | null;
};

export type ListaConciliacion = {
  conteos: Record<EstadoCobroPendiente | "todas", number>;
  total_monto: number;
  cobros: CobroPendiente[];
};

export type Banco = { id: string; nombre: string; sin_referencia: boolean; prefijo: string | null; activo: boolean; orden: number };

export const TRAMO_LABEL: Record<TramoKey, string> = { por_vencer: "Por vencer", tramo_1: "Tramo 1", tramo_2: "Tramo 2", tramo_3: "Tramo 3" };
export const TRAMO_CLASS: Record<TramoKey, string> = {
  por_vencer: "border-sky-200 bg-sky-50 text-sky-700",
  tramo_1: "border-amber-200 bg-amber-50 text-amber-700",
  tramo_2: "border-orange-200 bg-orange-50 text-orange-700",
  tramo_3: "border-rose-200 bg-rose-50 text-rose-700",
};
export const TRAMO_PESO: Record<TramoKey, number> = { por_vencer: 0, tramo_1: 1, tramo_2: 2, tramo_3: 3 };

export const ESTADO_COBRO: Record<EstadoCobroPendiente, { label: string; cls: string }> = {
  pendiente: { label: "Pendiente", cls: "bg-amber-50 text-amber-700" },
  aprobado: { label: "Aprobado", cls: "bg-emerald-50 text-emerald-700" },
  rechazado: { label: "Rechazado", cls: "bg-red-50 text-red-700" },
  anulado: { label: "Anulado", cls: "bg-slate-100 text-slate-500 line-through" },
};

/** Plan de un servicio para mostrar/filtrar: el de la suscripción o "General". */
export const planDe = (s: { plan: string | null }) => s.plan ?? "General";

export const MES_CORTO = ["", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function gs(n: number | null | undefined): string {
  if (n == null) return "—";
  return `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`; // como el resto del sistema (antes "₲")
}
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}
export function mesCorto(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MES_CORTO[Number(m)] ?? m} ${y?.slice(2) ?? ""}`;
}

/** Roles que pueden REGISTRAR una transferencia (queda pendiente). Aprobar: solo ADMIN. */
export const ROLES_REGISTRAR = ["ADMIN", "SUPERVISOR", "CAJERO"];

/** ¿N° de operación vacío o placeholder (solo ceros)? */
export const esOperacionPlaceholder = (op: string) => /^0*$/.test(op.replace(/[^a-zA-Z0-9]/g, ""));

/** Referencia para un banco sin comprobante: PREFIJO-YYMMDD-HHMMSS-RR (hora de Paraguay). */
export function generarReferencia(prefijo: string | null | undefined, ahora = new Date()): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "America/Asuncion", year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(ahora).map((x) => [x.type, x.value]),
  );
  const rand = Math.random().toString(36).slice(2, 4).toUpperCase().padEnd(2, "X");
  return `${(prefijo || "SR").toUpperCase()}-${p.year}${p.month}${p.day}-${p.hour === "24" ? "00" : p.hour}${p.minute}${p.second}-${rand}`;
}
