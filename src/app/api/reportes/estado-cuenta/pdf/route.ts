/**
 * Estado de cuenta en PDF gerencial (A4): resultado del período, IVA, cuentas al cierre,
 * flujo de caja, gastos por categoría, pérdidas y evolución mensual.
 *   GET /api/reportes/estado-cuenta/pdf?desde&hasta&sucursal → descarga
 */
import { withTenant } from "@/lib/api/with-tenant";
import { COLOR, encabezado, gs, M, nuevoDocumento, pieDePagina, respuestaPdf, tituloSeccion, W, asegurarEspacio } from "@/lib/pdf/documento";
import { kpisPdf, renglon, tablaPdf } from "@/lib/pdf/tabla";
import { mesCorto } from "@/components/graficos/formato";
import { argsRango, describirRango, filtrosRango, leerReporte, nombreArchivo } from "@/modules/reportes/server/rpc";
import { derivados } from "@/modules/reportes/estado-cuenta";
import type { EstadoCuenta } from "@/modules/reportes/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const g = (n: number) => `${n < 0 ? "- " : ""}Gs. ${gs(Math.abs(n))}`;
const pc = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)} %` : "—");

export const GET = withTenant(
  async (ctx, req) => {
    const r = await leerReporte<EstadoCuenta>(ctx.db, "reporte_estado_cuenta", argsRango(filtrosRango(new URL(req.url).searchParams)));
    if (!r.ok) return r.res;
    const d = r.data;
    const x = derivados(d);
    const doc = nuevoDocumento();
    let y = await encabezado(doc, "ESTADO DE CUENTA DE LA EMPRESA", describirRango(d));

    y = kpisPdf(doc, y, [
      { label: "Ventas netas", valor: g(x.ventas), sub: `${d.ventas.cantidad} ventas` , color: COLOR.teal },
      { label: "Margen bruto", valor: g(x.margen), sub: pc(x.margen, x.ventas) },
      { label: "Gastos y pérdidas", valor: g(x.operativos + x.perdidas) },
      { label: "Resultado", valor: g(x.resultado), sub: pc(x.resultado, x.ventas), color: x.resultado < 0 ? COLOR.rojo : COLOR.verde },
    ]);

    // Estado de resultados (izquierda) · IVA y cuentas (derecha)
    const col = (W - 10) / 2;
    const xd = M + col + 10;
    tituloSeccion(doc, "RESULTADO DEL PERÍODO", M, y, col);
    tituloSeccion(doc, "IVA, CUENTAS Y FLUJO DE CAJA", xd, y, col);
    let yi = y + 8;
    yi = renglon(doc, yi, "Ventas netas (IVA incluido)", g(x.ventas), { ancho: col });
    yi = renglon(doc, yi, "(-) Costo de lo vendido", g(-x.cmv), { gris: true, ancho: col });
    yi = renglon(doc, yi + 1.5, `Margen bruto · ${pc(x.margen, x.ventas)}`, g(x.margen), { bold: true, linea: true, color: COLOR.teal, ancho: col });
    for (const rb of d.gastos.por_rubro) yi = renglon(doc, yi, `(-) ${rb.nombre}`, g(-Number(rb.total)), { gris: true, sangria: 2, ancho: col });
    yi = renglon(doc, yi, "(-) Gastos operativos", g(-x.operativos), { ancho: col });
    yi = renglon(doc, yi, "(-) Pérdidas de producto", g(-x.perdidas), { ancho: col });
    yi = renglon(doc, yi + 1.5, `RESULTADO · ${pc(x.resultado, x.ventas)}`, g(x.resultado), { bold: true, linea: true, color: x.resultado < 0 ? COLOR.rojo : COLOR.verde, ancho: col });
    doc.setFont("helvetica", "normal").setFontSize(6.8).setTextColor(...COLOR.grisClaro);
    doc.text(`Anuladas fuera del total: ${d.anuladas.cantidad} por Gs. ${gs(d.anuladas.total)}.`, M, yi);
    yi += 4;
    if (d.ventas.productos_sin_costo) {
      doc.setTextColor(...COLOR.ambar).text(`${d.ventas.productos_sin_costo} producto(s) vendidos sin costo: el margen está sobreestimado.`, M, yi);
      yi += 4;
    }

    let yd = y + 8;
    const o = { x: xd, ancho: col };
    yd = renglon(doc, yd, "IVA débito (ventas)", g(Number(d.ventas.iva)), o);
    yd = renglon(doc, yd, "IVA crédito (compras y gastos)", g(-Number(d.gastos.iva_credito)), { ...o, gris: true });
    yd = renglon(doc, yd + 1.5, x.ivaSaldo >= 0 ? "IVA a pagar (estimado)" : "IVA a favor (estimado)", g(Math.abs(x.ivaSaldo)), { ...o, bold: true, linea: true });
    yd += 2;
    yd = renglon(doc, yd, "Cuentas por cobrar al cierre", g(Number(d.cxc.saldo)), o);
    yd = renglon(doc, yd, "   vencidas", g(Number(d.cxc.vencido)), { ...o, gris: true });
    yd = renglon(doc, yd, "Cuentas por pagar al cierre", g(Number(d.cxp.saldo)), o);
    yd = renglon(doc, yd, "   vencidas", g(Number(d.cxp.vencido)), { ...o, gris: true });
    yd += 2;
    yd = renglon(doc, yd, "Cobrado (contado + cobros)", g(x.entro), o);
    yd = renglon(doc, yd, "Pagado (compras, gastos, proveedores)", g(-x.salio), { ...o, gris: true });
    yd = renglon(doc, yd + 1.5, "Flujo neto", g(x.neto), { ...o, bold: true, linea: true, color: x.neto < 0 ? COLOR.rojo : COLOR.negro });
    yd = renglon(doc, yd, "Compras de mercadería (al stock)", g(Number(d.gastos.compras)), { ...o, gris: true });

    y = Math.max(yi, yd) + 6;
    y = asegurarEspacio(doc, y, 30);
    y = tablaPdf(doc, y, "EVOLUCIÓN MENSUAL", ["MES", "VENTAS", "COSTO VENDIDO", "MARGEN", "GASTOS OPER.", "PÉRDIDAS", "RESULTADO"],
      x.meses.map((m) => [mesCorto(m.mes), gs(m.ventas), gs(m.cmv), gs(m.margen), gs(m.operativos), gs(m.perdidas), g(m.resultado)]), [1, 2, 3, 4, 5, 6]);
    if (d.perdidas.por_motivo.length) {
      y = tablaPdf(doc, y, "PÉRDIDAS POR MOTIVO (AL COSTO)", ["MOTIVO", "VALOR", "% S/ VENTAS"],
        d.perdidas.por_motivo.map((p) => [p.label, g(Number(p.valor)), pc(Number(p.valor), x.ventas)]), [1, 2]);
    }
    doc.setFont("helvetica", "normal").setFontSize(6.8).setTextColor(...COLOR.grisClaro);
    y = asegurarEspacio(doc, y, 10);
    doc.text(doc.splitTextToSize("Montos con IVA incluido. Costo de lo vendido = costo guardado en cada venta. Gastos operativos y compras: los mismos de Gastos empresariales. Pérdidas = bajas PE- aplicadas + faltantes de traslados, al costo. Cuentas al cierre: saldo al último día del rango.", W) as string[], M, y);

    pieDePagina(doc, "Estado de cuenta · Documento no fiscal");
    return respuestaPdf(doc, `${nombreArchivo("estado-de-cuenta", d.desde, d.hasta)}.pdf`);
  },
  { permiso: ["ver_reportes_financieros", "exportar"] },
);
