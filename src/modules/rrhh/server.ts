/**
 * Extractos del mes: junta los datos de la base, la comisión del mes y la cuenta de calculo.ts. Lo
 * cerrado sale tal cual se guardó, aunque después cambie el salario.
 */
import type { TenantContext } from "@/lib/api/with-tenant";
import { hoyPY } from "@/lib/fecha/paraguay";
import { armarPreview, etiquetaMes } from "@/modules/comisiones/calculo";
import type { DatosComisiones } from "@/modules/comisiones/tipos";
import { aguinaldo, antiguedad, liquidar, textoAntiguedad, vacaciones } from "@/modules/rrhh/calculo";
import type { ExtractoFila, ExtractoMes, PersonaMes } from "@/modules/rrhh/tipos";

type Datos = { personas: PersonaMes[]; sin_legajo: number };

async function comisionesDelMes(ctx: TenantContext, mes: string): Promise<Map<string, number>> {
  const [a, m] = mes.split("-").map(Number);
  const hasta = `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`;
  const { data, error } = await ctx.db.rpc<DatosComisiones>("comisiones_datos", { p_desde: `${mes}-01`, p_hasta: hasta });
  if (error || !data) throw new Error(error?.message ?? "No se pudieron calcular las comisiones");
  return new Map(armarPreview(data, mes).por_vendedor.map((v) => [v.vendedor_usuario_id, v.comision_estimada]));
}

function fila(p: PersonaMes, mes: string, comision: number): ExtractoFila {
  const hoy = hoyPY();
  const corte = p.fecha_egreso && p.fecha_egreso < hoy ? p.fecha_egreso : hoy;
  const cerrada = p.liquidacion?.estado === "cerrada" ? p.liquidacion.resultado : null;
  const resultado = cerrada ?? liquidar({
    periodo: mes,
    tipo_salario: p.tipo_salario,
    salario: Number(p.salario),
    aporta_ips: p.aporta_ips,
    fecha_ingreso: p.fecha_ingreso,
    fecha_egreso: p.fecha_egreso,
    dias_ausencia: p.ausencias.filter((a) => a.descuenta).reduce((s, a) => s + Number(a.dias), 0),
    dias_trabajados: p.liquidacion?.dias_trabajados == null ? null : Number(p.liquidacion.dias_trabajados),
    comision: p.comisiona ? comision : 0,
    ajustes: p.liquidacion?.ajustes ?? [],
  });
  const ag = aguinaldo({ mes, tipo_salario: p.tipo_salario, salario: Number(p.salario), fecha_ingreso: p.fecha_ingreso, fecha_egreso: p.fecha_egreso, cerradas: p.cerradas_anio });
  return {
    usuario_id: p.usuario_id, nombre: p.nombre, ci: p.ci, perfil: p.perfil, sucursal: p.sucursal, area: p.area, aporta_ips: p.aporta_ips, fecha_ingreso: p.fecha_ingreso,
    estado: cerrada ? "cerrada" : "abierta",
    cerrada_por: p.liquidacion?.cerrada_por ?? null,
    faltan_dias: !cerrada && p.tipo_salario === "jornalero" && p.liquidacion?.dias_trabajados == null,
    resultado,
    antiguedad: textoAntiguedad(antiguedad(p.fecha_ingreso, corte)),
    vacaciones_saldo: vacaciones(p.fecha_ingreso, corte, Number(p.vacaciones_tomadas)).saldo,
    aguinaldo: { total: ag.total, meses_cerrados: ag.meses_cerrados, meses_estimados: ag.meses_estimados },
  };
}

export async function extractoDelMes(ctx: TenantContext, mes: string): Promise<ExtractoMes> {
  const { data, error } = await ctx.db.rpc<Datos>("rrhh_liquidacion_datos", { p_periodo: mes });
  if (error || !data) throw new Error(error?.message ?? "No se pudieron leer las liquidaciones");
  const hayAbiertas = data.personas.some((p) => p.comisiona && p.liquidacion?.estado !== "cerrada");
  const comisiones = hayAbiertas ? await comisionesDelMes(ctx, mes) : new Map<string, number>();
  return { mes, periodo: etiquetaMes(mes), sin_legajo: Number(data.sin_legajo), filas: data.personas.map((p) => fila(p, mes, comisiones.get(p.usuario_id) ?? 0)) };
}
