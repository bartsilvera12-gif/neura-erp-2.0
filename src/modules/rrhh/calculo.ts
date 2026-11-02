/**
 * Cuentas de RR HH (Paraguay), sin base de datos. El extracto lo revisa el asesor.
 *
 *   Antigüedad: desde la fecha de ingreso hasta hoy o la salida.
 *   Vacaciones (art. 218 Código Laboral): 12 días hábiles hasta 5 años, 18 hasta 10, 30 después.
 *   Aguinaldo (art. 243): la doceava parte de lo ganado en el año.
 *   IPS: 9 % el trabajador y 16,5 % la empresa, sobre lo imponible.
 *   Mensualero: salario / 30 por día. Jornalero: jornal × días trabajados, y la ausencia ya no suma.
 */
export const IPS_TRABAJADOR = 9;
export const IPS_EMPRESA = 16.5;

export type TipoSalario = "mensualero" | "jornalero";
export type Ajuste = { concepto: string; monto: number; tipo: "extra" | "descuento"; imponible: boolean };

const redondo = (n: number) => Math.round(n);
const partes = (iso: string) => iso.slice(0, 10).split("-").map(Number) as [number, number, number];

export function antiguedad(ingreso: string, hasta: string): { anios: number; meses: number; dias: number } {
  const [a1, m1, d1] = partes(ingreso);
  const [a2, m2, d2] = partes(hasta);
  let anios = a2 - a1;
  let meses = m2 - m1;
  let dias = d2 - d1;
  if (dias < 0) { meses--; dias += new Date(a2, m2 - 1, 0).getDate(); }
  if (meses < 0) { anios--; meses += 12; }
  if (anios < 0) return { anios: 0, meses: 0, dias: 0 };
  return { anios, meses, dias };
}

export function textoAntiguedad(a: { anios: number; meses: number; dias: number }): string {
  const t = [a.anios ? `${a.anios} ${a.anios === 1 ? "año" : "años"}` : "", a.meses ? `${a.meses} ${a.meses === 1 ? "mes" : "meses"}` : ""].filter(Boolean).join(" y ");
  return t || `${a.dias} ${a.dias === 1 ? "día" : "días"}`;
}

/** Días que da el año de trabajo número `anio` (el primero es 1). */
export const diasDelAnio = (anio: number) => (anio <= 5 ? 12 : anio <= 10 ? 18 : 30);

export function vacaciones(ingreso: string, hasta: string, tomados: number) {
  const { anios } = antiguedad(ingreso, hasta);
  let generados = 0;
  for (let k = 1; k <= anios; k++) generados += diasDelAnio(k);
  const [a, m, d] = partes(ingreso);
  const proxima = `${a + anios + 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { generados, tomados, saldo: generados - tomados, proxima, proximos_dias: diasDelAnio(anios + 1) };
}

const finDeMes = (periodo: string) => {
  const [a, m] = periodo.split("-").map(Number);
  return `${periodo}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`;
};

/** Días que se pagan del mes, sobre 30: el mes de entrada o de salida va proporcional. */
export function diasPagables(periodo: string, ingreso: string, egreso: string | null): number {
  const desde = ingreso.slice(0, 7) === periodo ? partes(ingreso)[2] : 1;
  const salida = egreso && egreso.slice(0, 7) === periodo ? egreso : null;
  // Un mes completo son 30 días aunque tenga 28 o 31.
  const hasta = salida && salida !== finDeMes(periodo) ? Math.min(partes(salida)[2], 30) : 30;
  return Math.max(0, hasta - Math.min(desde, 30) + 1);
}

export type EntradaLiquidacion = {
  periodo: string;
  tipo_salario: TipoSalario;
  salario: number;
  aporta_ips: boolean;
  fecha_ingreso: string;
  fecha_egreso: string | null;
  dias_ausencia: number;
  /** Solo jornalero: los días que trabajó en el mes. */
  dias_trabajados: number | null;
  comision: number;
  ajustes: Ajuste[];
};

export type ResultadoLiquidacion = {
  periodo: string;
  tipo_salario: TipoSalario;
  salario: number;
  dias_pagados: number;
  dias_trabajados: number | null;
  dias_ausencia: number;
  salario_base: number;
  descuento_ausencias: number;
  comision: number;
  extras_imponibles: number;
  extras_no_imponibles: number;
  imponible: number;
  ips_trabajador: number;
  ips_empresa: number;
  otros_descuentos: number;
  neto: number;
  ajustes: Ajuste[];
};

export function liquidar(e: EntradaLiquidacion): ResultadoLiquidacion {
  const jornalero = e.tipo_salario === "jornalero";
  const diasPagados = jornalero ? Number(e.dias_trabajados) || 0 : diasPagables(e.periodo, e.fecha_ingreso, e.fecha_egreso);
  const base = jornalero ? redondo(e.salario * diasPagados) : redondo((e.salario / 30) * diasPagados);
  // Nunca se descuenta más que lo que se paga.
  const descuento = jornalero ? 0 : Math.min(base, redondo((e.salario / 30) * e.dias_ausencia));
  const suma = (f: (a: Ajuste) => boolean) => e.ajustes.filter(f).reduce((s, a) => s + redondo(Number(a.monto) || 0), 0);
  const extrasImp = suma((a) => a.tipo === "extra" && a.imponible);
  const extrasNo = suma((a) => a.tipo === "extra" && !a.imponible);
  const otros = suma((a) => a.tipo === "descuento");
  const comision = redondo(e.comision);
  const imponible = base - descuento + comision + extrasImp;
  const ipsT = e.aporta_ips ? redondo((imponible * IPS_TRABAJADOR) / 100) : 0;
  const ipsE = e.aporta_ips ? redondo((imponible * IPS_EMPRESA) / 100) : 0;
  return {
    periodo: e.periodo, tipo_salario: e.tipo_salario, salario: e.salario, dias_pagados: diasPagados, dias_trabajados: jornalero ? diasPagados : null,
    dias_ausencia: e.dias_ausencia, salario_base: base, descuento_ausencias: descuento, comision, extras_imponibles: extrasImp, extras_no_imponibles: extrasNo,
    imponible, ips_trabajador: ipsT, ips_empresa: ipsE, otros_descuentos: otros, neto: imponible + extrasNo - ipsT - otros, ajustes: e.ajustes,
  };
}

/**
 * Aguinaldo del año hasta `mes` (YYYY-MM): lo cerrado es real; los meses sin cerrar del mensualero se
 * estiman con su salario actual. El jornalero sin cierre no se estima: depende de los días trabajados.
 */
export function aguinaldo(p: {
  mes: string;
  tipo_salario: TipoSalario;
  salario: number;
  fecha_ingreso: string;
  fecha_egreso: string | null;
  cerradas: { periodo: string; imponible: number }[];
}) {
  const anio = p.mes.slice(0, 4);
  const mesFin = Number(p.mes.slice(5, 7));
  const delAnio = p.cerradas.filter((c) => c.periodo.slice(0, 4) === anio);
  const cerradas = new Set(delAnio.map((c) => c.periodo));
  const real = delAnio.reduce((s, c) => s + Number(c.imponible || 0), 0);
  let estimado = 0;
  let mesesEstimados = 0;
  if (p.tipo_salario === "mensualero") {
    for (let m = 1; m <= mesFin; m++) {
      const periodo = `${anio}-${String(m).padStart(2, "0")}`;
      if (cerradas.has(periodo) || periodo < p.fecha_ingreso.slice(0, 7) || (p.fecha_egreso && periodo > p.fecha_egreso.slice(0, 7))) continue;
      estimado += redondo((p.salario / 30) * diasPagables(periodo, p.fecha_ingreso, p.fecha_egreso));
      mesesEstimados++;
    }
  }
  return { total: redondo((real + estimado) / 12), real, estimado, meses_cerrados: delAnio.length, meses_estimados: mesesEstimados };
}
