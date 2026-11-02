/** RR HH (receta 118): lo que devuelven las funciones de la base y recibe la pantalla. */
import type { Ajuste, ResultadoLiquidacion, TipoSalario } from "@/modules/rrhh/calculo";

export type PersonaFila = {
  id: string;
  nombre: string;
  ci: string | null;
  telefono: string | null;
  email: string | null;
  activo: boolean;
  perfil: string | null;
  sucursal: string | null;
  tiene_legajo: boolean;
  area: string | null;
  tipo_salario: TipoSalario | null;
  salario: number | null;
  fecha_ingreso: string | null;
  fecha_egreso: string | null;
  aporta_ips: boolean | null;
  comisiona: boolean | null;
};

export type Legajo = {
  fecha_nacimiento: string | null;
  direccion: string | null;
  barrio: string | null;
  ciudad: string | null;
  emergencia_nombre: string | null;
  emergencia_telefono: string | null;
  fecha_ingreso: string;
  fecha_egreso: string | null;
  tipo_salario: TipoSalario;
  salario: number;
  aporta_ips: boolean;
  comisiona: boolean;
  area: string | null;
  horario_dias: number[];
  horario_entrada: string | null;
  horario_salida: string | null;
  horario_nota: string | null;
};

export type TipoAusencia = "injustificada" | "permiso_sin_goce" | "permiso_con_goce" | "reposo";
export const TIPOS_AUSENCIA: { id: TipoAusencia; label: string; descuenta: boolean }[] = [
  { id: "injustificada", label: "Falta sin justificar", descuenta: true },
  { id: "permiso_sin_goce", label: "Permiso sin goce de sueldo", descuenta: true },
  { id: "permiso_con_goce", label: "Permiso con goce de sueldo", descuenta: false },
  { id: "reposo", label: "Reposo médico", descuenta: false },
];
export const etiquetaAusencia = (t: string) => TIPOS_AUSENCIA.find((x) => x.id === t)?.label ?? t;

export type Ausencia = { id: string; fecha: string; dias: number; tipo: TipoAusencia; descuenta: boolean; motivo: string | null; anulada_at: string | null; anulada_motivo: string | null };
export type Vacacion = { id: string; desde: string; hasta: string; dias: number; nota: string | null; anulada_at: string | null; anulada_motivo: string | null };
export type LiquidacionResumen = { periodo: string; estado: "abierta" | "cerrada"; imponible: number | null; neto: number | null; cerrada_at: string | null; resultado: ResultadoLiquidacion | null };
export type EventoRrhh = { id: string; accion: string; detalle: Record<string, unknown>; actor: string | null; created_at: string };

export type FichaRrhh = {
  usuario: { id: string; nombre: string; nombres: string; apellidos: string | null; ci: string | null; telefono: string | null; email: string | null; activo: boolean; perfil: string | null; sucursal: string | null };
  legajo: Legajo | null;
  ausencias: Ausencia[];
  vacaciones: Vacacion[];
  liquidaciones: LiquidacionResumen[];
  historial: EventoRrhh[];
};

export type PersonaMes = {
  usuario_id: string;
  nombre: string;
  ci: string | null;
  perfil: string | null;
  sucursal: string | null;
  area: string | null;
  tipo_salario: TipoSalario;
  salario: number;
  aporta_ips: boolean;
  comisiona: boolean;
  fecha_ingreso: string;
  fecha_egreso: string | null;
  ausencias: { fecha: string; dias: number; tipo: string; descuenta: boolean }[];
  vacaciones_tomadas: number;
  cerradas_anio: { periodo: string; imponible: number }[];
  liquidacion: { estado: "abierta" | "cerrada"; dias_trabajados: number | null; ajustes: Ajuste[]; resultado: ResultadoLiquidacion | null; cerrada_por: string | null; cerrada_at: string | null } | null;
};

export type ExtractoFila = {
  usuario_id: string;
  nombre: string;
  ci: string | null;
  perfil: string | null;
  sucursal: string | null;
  area: string | null;
  aporta_ips: boolean;
  fecha_ingreso: string;
  estado: "abierta" | "cerrada";
  cerrada_por: string | null;
  /** Jornalero sin los días trabajados: no se puede cerrar. */
  faltan_dias: boolean;
  resultado: ResultadoLiquidacion;
  antiguedad: string;
  vacaciones_saldo: number;
  aguinaldo: { total: number; meses_cerrados: number; meses_estimados: number };
};

export type ExtractoMes = { mes: string; periodo: string; sin_legajo: number; filas: ExtractoFila[] };

export const TIPOS_NOTA: [string, string][] = [
  ["ascenso", "Ascenso o cambio de puesto"],
  ["felicitacion", "Felicitación"],
  ["capacitacion", "Capacitación"],
  ["llamada_atencion", "Llamada de atención"],
  ["otro", "Otro"],
];
