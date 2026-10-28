/**
 * Estado de cuenta de la empresa — cálculos derivados compartidos por la pantalla, el Excel
 * y el PDF (todo lo demás sale sumado de la base: reporte_estado_cuenta).
 */
import type { EstadoCuenta } from "@/modules/reportes/tipos";

export function derivados(d: EstadoCuenta) {
  const ventas = Number(d.ventas.netas);
  const cmv = Number(d.ventas.cmv);
  const margen = ventas - cmv;
  const operativos = Number(d.gastos.operativos);
  const perdidas = Number(d.perdidas.total);
  const resultado = margen - operativos - perdidas;
  const ivaSaldo = Number(d.ventas.iva) - Number(d.gastos.iva_credito);
  const entro = Number(d.flujo.ventas_contado) + Number(d.flujo.cobros);
  const salio = Number(d.flujo.compras_contado) + Number(d.flujo.gastos_contado) + Number(d.flujo.pagos_proveedores);
  const meses = d.por_mes.map((m) => ({
    ...m,
    margen: Number(m.ventas) - Number(m.cmv),
    resultado: Number(m.ventas) - Number(m.cmv) - Number(m.operativos) - Number(m.perdidas),
  }));
  return { ventas, cmv, margen, operativos, perdidas, resultado, ivaSaldo, entro, salio, neto: entro - salio, meses };
}

/** Renglones del estado de resultados (para Excel / PDF). */
export function renglones(d: EstadoCuenta) {
  const x = derivados(d);
  const p = (a: number) => (x.ventas ? `${((a / x.ventas) * 100).toFixed(1).replace(".", ",")} %` : "");
  return [
    { concepto: "Ventas netas (IVA incluido, sin anuladas)", monto: x.ventas, nota: `${d.ventas.cantidad} ventas` },
    { concepto: "(−) Costo de lo vendido", monto: -x.cmv, nota: p(x.cmv) },
    { concepto: "= Margen bruto", monto: x.margen, nota: p(x.margen), fuerte: true },
    ...d.gastos.por_rubro.map((r) => ({ concepto: `(−) ${r.nombre}`, monto: -Number(r.total), nota: p(Number(r.total)) })),
    { concepto: "(−) Total gastos operativos", monto: -x.operativos, nota: p(x.operativos) },
    { concepto: "(−) Pérdidas de producto", monto: -x.perdidas, nota: p(x.perdidas) },
    { concepto: "= Resultado del período", monto: x.resultado, nota: p(x.resultado), fuerte: true },
  ];
}
