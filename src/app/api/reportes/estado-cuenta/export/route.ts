/**
 * Estado de cuenta en Excel: estado de resultados, IVA / cuentas / flujo, gastos por
 * categoría, pérdidas por motivo y evolución mensual.
 *   GET /api/reportes/estado-cuenta/export?desde&hasta&sucursal → .xlsx
 */
import { withTenant } from "@/lib/api/with-tenant";
import { buildXlsx, hoja, xlsxHeaders } from "@/lib/excel/xlsx";
import { mesCorto } from "@/components/graficos/formato";
import { argsRango, describirRango, filtrosRango, leerReporte, nombreArchivo } from "@/modules/reportes/server/rpc";
import { derivados, renglones } from "@/modules/reportes/estado-cuenta";
import type { EstadoCuenta } from "@/modules/reportes/tipos";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const r = await leerReporte<EstadoCuenta>(ctx.db, "reporte_estado_cuenta", argsRango(filtrosRango(new URL(req.url).searchParams)));
    if (!r.ok) return r.res;
    const d = r.data;
    const x = derivados(d);
    const otros = [
      { c: "Período", v: describirRango(d) },
      { c: "IVA débito (ventas)", v: Number(d.ventas.iva) },
      { c: "IVA crédito (compras y gastos)", v: Number(d.gastos.iva_credito) },
      { c: x.ivaSaldo >= 0 ? "IVA a pagar (estimado)" : "IVA a favor (estimado)", v: Math.abs(x.ivaSaldo) },
      { c: "Cuentas por cobrar al cierre", v: Number(d.cxc.saldo) },
      { c: "  de las cuales vencidas", v: Number(d.cxc.vencido) },
      { c: "Cuentas por pagar al cierre", v: Number(d.cxp.saldo) },
      { c: "  de las cuales vencidas", v: Number(d.cxp.vencido) },
      { c: "Cobrado: ventas de contado", v: Number(d.flujo.ventas_contado) },
      { c: "Cobrado: cobros de cuentas", v: Number(d.flujo.cobros) },
      { c: "Pagado: compras de contado", v: Number(d.flujo.compras_contado) },
      { c: "Pagado: gastos de contado", v: Number(d.flujo.gastos_contado) },
      { c: "Pagado: pagos a proveedores", v: Number(d.flujo.pagos_proveedores) },
      { c: "Pagado: devoluciones a clientes", v: Number(d.flujo.devoluciones) },
      { c: "Flujo neto (cobrado − pagado)", v: x.neto },
      { c: "Compras de mercadería (entran al stock)", v: Number(d.gastos.compras) },
      { c: "Ventas anuladas (no suman)", v: Number(d.anuladas.total) },
    ];
    const xlsx = buildXlsx([
      hoja("Estado de resultados", renglones(d), [
        { header: "Concepto", value: (f) => f.concepto, width: 44 },
        { header: "Monto (Gs.)", value: (f) => Math.round(f.monto), width: 18 },
        { header: "% sobre ventas / nota", value: (f) => f.nota, width: 18 },
      ]),
      hoja("IVA, cuentas y flujo", otros, [
        { header: "Concepto", value: (f) => f.c, width: 44 },
        { header: "Valor", value: (f) => f.v, width: 22 },
      ]),
      hoja("Gastos por categoría", d.gastos.por_rubro, [
        { header: "Categoría", value: (f) => f.nombre, width: 32 },
        { header: "Total (Gs.)", value: (f) => Number(f.total), width: 16 },
      ]),
      hoja("Pérdidas por motivo", d.perdidas.por_motivo, [
        { header: "Motivo", value: (f) => f.label, width: 28 },
        { header: "Valor al costo (Gs.)", value: (f) => Number(f.valor), width: 18 },
      ]),
      hoja("Por mes", x.meses, [
        { header: "Mes", value: (f) => mesCorto(f.mes), width: 10 },
        { header: "Ventas", value: (f) => Number(f.ventas), width: 15 },
        { header: "Costo de lo vendido", value: (f) => Number(f.cmv), width: 15 },
        { header: "Margen bruto", value: (f) => f.margen, width: 15 },
        { header: "Gastos operativos", value: (f) => Number(f.operativos), width: 15 },
        { header: "Pérdidas", value: (f) => Number(f.perdidas), width: 13 },
        { header: "Resultado", value: (f) => f.resultado, width: 15 },
        { header: "Compras de mercadería", value: (f) => Number(f.compras), width: 15 },
      ]),
    ]);
    return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders(nombreArchivo("estado-de-cuenta", d.desde, d.hasta)) });
  },
  { permiso: ["ver_reportes_financieros", "exportar"] },
);
