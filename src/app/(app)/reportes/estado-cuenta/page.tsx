"use client";

/**
 * /reportes/estado-cuenta — Estado de cuenta de la empresa: cuánto se vendió, cuánto costó lo
 * vendido, el margen, los gastos operativos por categoría, las pérdidas y el resultado. Además
 * IVA (débito vs crédito), cuentas a cobrar y a pagar al cierre, flujo de caja y evolución
 * mensual. Todo sale de reporte_estado_cuenta (los gastos y compras son los mismos números de
 * Gastos empresariales). ADMIN.
 */
import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { Dona, Leyenda, Lineas, SERIES, C_OTROS } from "@/components/graficos/Graficos";
import { corto, gs, mesCorto, nombreMes, pct } from "@/components/graficos/formato";
import { derivados } from "@/modules/reportes/estado-cuenta";
import { Descargas, EncabezadoReporte, EstadoCarga, FilaKpis, FiltrosReporte, Kpi, Nota, Tarjeta, useFiltrosReporte, useReporte, type Atajo } from "@/modules/reportes/ui";
import type { EstadoCuenta } from "@/modules/reportes/tipos";

const ATAJOS: Atajo[] = ["mes", "mes_anterior", "3m", "6m", "anio"];
const C = { ventas: SERIES[0], cmv: SERIES[1], gastos: SERIES[2], resultado: "#0f172a", perdidas: SERIES[7] };

export default function Page() {
  return <Suspense fallback={null}><EstadoDeCuenta /></Suspense>;
}

function EstadoDeCuenta() {
  const filtros = useFiltrosReporte("mes");
  const { data: d, error, cargando } = useReporte<EstadoCuenta>(`/api/reportes/estado-cuenta?${filtros.query}`);
  const [verRubros, setVerRubros] = useState(false);
  const x = useMemo(() => (d ? derivados(d) : null), [d]);
  const q = filtros.query;

  const composicion = useMemo(() => {
    if (!d || !x) return [];
    const rubros = d.gastos.por_rubro.map((r) => ({ label: r.nombre, valor: Number(r.total) }));
    const top = rubros.slice(0, 4);
    const resto = rubros.slice(4).reduce((a, r) => a + r.valor, 0);
    return [
      { label: "Costo de lo vendido", valor: x.cmv, color: C.cmv },
      ...top.map((r, i) => ({ ...r, color: [SERIES[2], SERIES[6], SERIES[3], SERIES[5]][i] })),
      ...(resto > 0 ? [{ label: "Otros gastos", valor: resto, color: C_OTROS }] : []),
      ...(x.perdidas > 0 ? [{ label: "Pérdidas de producto", valor: x.perdidas, color: C.perdidas }] : []),
    ].filter((p) => p.valor > 0);
  }, [d, x]);

  return (
    <div className="space-y-6 pb-10">
      <EncabezadoReporte kicker="Reportes · Finanzas" titulo="Estado de cuenta"
        subtitulo="Cuánto entró, cuánto costó y cuánto quedó: ventas, costo de lo vendido, gastos, pérdidas y resultado del período.">
        <Descargas excel={`/api/reportes/estado-cuenta/export?${q}`} pdf={`/api/reportes/estado-cuenta/pdf?${q}`} deshabilitado={!d} />
      </EncabezadoReporte>

      <FiltrosReporte filtros={filtros} atajos={ATAJOS} sucursales={d?.sucursales} cargando={cargando && !!d} />

      {!d || !x ? <EstadoCarga error={error} /> : (
        <>
          <FilaKpis n={5}>
            <Kpi acento label="Ventas netas" valor={gs(x.ventas)} hint={`${d.ventas.cantidad} ventas · IVA incluido`}
              href={`/reportes/ventas?desde=${d.desde}&hasta=${d.hasta}`} />
            <Kpi label="Margen bruto" valor={gs(x.margen)} hint={`${pct(x.margen, x.ventas)} de las ventas`} tono={x.margen < 0 ? "malo" : undefined} />
            <Kpi label="Gastos operativos" valor={gs(x.operativos)} hint={`${d.gastos.docs_gastos} gastos · ${pct(x.operativos, x.ventas)} de ventas`}
              href={`/gastos-empresariales?desde=${d.desde}&hasta=${d.hasta}`} />
            <Kpi label="Pérdidas de producto" valor={gs(x.perdidas)} hint={`${pct(x.perdidas, x.ventas)} de las ventas`} tono={x.perdidas ? "alerta" : undefined}
              href={`/reportes/perdidas?desde=${d.desde}&hasta=${d.hasta}${d.sucursal_id ? `&sucursal=${d.sucursal_id}` : ""}`} />
            <Kpi label="Resultado" valor={gs(x.resultado)} hint={`${pct(x.resultado, x.ventas)} sobre ventas`} tono={x.resultado < 0 ? "malo" : "bueno"} />
          </FilaKpis>

          {d.ventas.productos_sin_costo ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 sm:px-4">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 max-sm:basis-[calc(100%-1.5rem)]">{d.ventas.productos_sin_costo} producto(s) se vendieron sin costo cargado: el margen está sobreestimado.</span>
              <Link href={`/reportes/ventas?desde=${d.desde}&hasta=${d.hasta}`} className="ml-auto inline-flex items-center font-semibold underline max-sm:-mb-2 max-sm:ml-6 max-sm:min-h-11">Corregir costos</Link>
            </p>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-[1.15fr_1fr]">
            <Tarjeta titulo="Resultado del período" sub="IVA incluido, sin ventas anuladas">
              <dl className="text-sm">
                <Linea l="Ventas netas" v={x.ventas} nota={`${d.ventas.cantidad} ventas`} />
                <Linea l="Costo de lo vendido" v={-x.cmv} nota={pct(x.cmv, x.ventas)} gris />
                <Linea l="Margen bruto" v={x.margen} nota={pct(x.margen, x.ventas)} total />
                <button type="button" onClick={() => setVerRubros((v) => !v)} className="w-full text-left max-sm:[&>div]:min-h-11 max-sm:[&>div]:items-center">
                  <Linea l={<span className="inline-flex items-center gap-1">{verRubros ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}Gastos operativos</span>}
                    v={-x.operativos} nota={pct(x.operativos, x.ventas)} gris />
                </button>
                {verRubros ? d.gastos.por_rubro.map((r) => <Linea key={r.nombre} l={r.nombre} v={-Number(r.total)} nota={pct(Number(r.total), x.ventas)} sub />) : null}
                <Link href={`/reportes/perdidas?desde=${d.desde}&hasta=${d.hasta}${d.sucursal_id ? `&sucursal=${d.sucursal_id}` : ""}`} className="block max-sm:[&>div]:min-h-11 max-sm:[&>div]:items-center">
                  <Linea l={<span className="underline decoration-dotted underline-offset-2">Pérdidas de producto</span>} v={-x.perdidas} nota={pct(x.perdidas, x.ventas)} gris />
                </Link>
                <Linea l="Resultado" v={x.resultado} nota={pct(x.resultado, x.ventas)} total fuerte />
              </dl>
              <div className="mt-4 space-y-1">
                <Nota>Costo de lo vendido = costo guardado en cada venta al momento de vender. Las compras de mercadería ({gs(d.gastos.compras)} en el período) entran al stock: se vuelven costo recién cuando se venden.</Nota>
                <Nota>Ventas anuladas fuera del total: {d.anuladas.cantidad} por {gs(d.anuladas.total)}.</Nota>
              </div>
            </Tarjeta>
            <Tarjeta titulo="¿A dónde va la plata?" sub="costo de lo vendido, gastos por categoría y pérdidas">
              <Dona centro={corto(composicion.reduce((a, p) => a + p.valor, 0))} sub="costos + gastos" partes={composicion} />
            </Tarjeta>
          </div>

          <Tarjeta titulo="Evolución mensual" sub="ventas, costo de lo vendido, gastos operativos y resultado de cada mes"
            extra={<Leyenda items={[{ color: C.ventas, label: "Ventas" }, { color: C.cmv, label: "Costo de lo vendido" }, { color: C.gastos, label: "Gastos operativos" }, { color: C.resultado, label: "Resultado", dashed: true }]} />}>
            <Lineas ariaLabel="Evolución mensual de ventas, costos, gastos y resultado" x={x.meses.map((m) => m.mes)} etiquetaX={mesCorto} tituloTooltip={nombreMes}
              series={[
                { label: "Ventas", color: C.ventas, valores: x.meses.map((m) => Number(m.ventas)), area: true },
                { label: "Costo de lo vendido", color: C.cmv, valores: x.meses.map((m) => Number(m.cmv)) },
                { label: "Gastos operativos", color: C.gastos, valores: x.meses.map((m) => Number(m.operativos)) },
                { label: "Resultado", color: C.resultado, valores: x.meses.map((m) => m.resultado), punteada: true },
              ]} />
          </Tarjeta>

          <div className="grid gap-6 lg:grid-cols-3">
            <Tarjeta titulo="IVA del período" sub="estimado, IVA incluido en precios">
              <dl className="text-sm">
                <Linea l="Débito (ventas)" v={Number(d.ventas.iva)} />
                <Linea l="Crédito (compras y gastos)" v={-Number(d.gastos.iva_credito)} gris />
                <Linea l={x.ivaSaldo >= 0 ? "A pagar" : "A favor"} v={Math.abs(x.ivaSaldo)} total fuerte />
              </dl>
            </Tarjeta>
            <Tarjeta titulo="Cuentas al cierre" sub={`saldos al ${d.hasta.split("-").reverse().join("/")}`}>
              <dl className="text-sm">
                <Link href="/reportes/cuentas-cobrar" className="block hover:bg-slate-50 max-sm:[&>div]:min-h-11 max-sm:[&>div]:items-center"><Linea l="Por cobrar" v={Number(d.cxc.saldo)} nota={`vencido ${corto(d.cxc.vencido)}`} /></Link>
                <Link href="/reportes/cuentas-pagar" className="block hover:bg-slate-50 max-sm:[&>div]:min-h-11 max-sm:[&>div]:items-center"><Linea l="Por pagar" v={-Number(d.cxp.saldo)} nota={`vencido ${corto(d.cxp.vencido)}`} /></Link>
                <Linea l="Neto" v={Number(d.cxc.saldo) - Number(d.cxp.saldo)} total />
              </dl>
            </Tarjeta>
            <Tarjeta titulo="Flujo de caja" sub="lo que efectivamente entró y salió">
              <dl className="text-sm">
                <Linea l="Ventas de contado" v={Number(d.flujo.ventas_contado)} />
                <Linea l="Cobros de cuentas" v={Number(d.flujo.cobros)} />
                <Linea l="Compras de contado" v={-Number(d.flujo.compras_contado)} gris />
                <Linea l="Gastos de contado" v={-Number(d.flujo.gastos_contado)} gris />
                <Linea l="Pagos a proveedores" v={-Number(d.flujo.pagos_proveedores)} gris />
                <Linea l="Neto" v={x.neto} total fuerte />
              </dl>
            </Tarjeta>
          </div>
        </>
      )}
    </div>
  );
}

function Linea({ l, v, nota, gris, total, fuerte, sub }: { l: React.ReactNode; v: number; nota?: string; gris?: boolean; total?: boolean; fuerte?: boolean; sub?: boolean }) {
  const color = total ? (v < 0 ? "text-rose-600" : fuerte ? "text-emerald-700" : "text-slate-900") : gris ? "text-slate-600" : "text-slate-800";
  return (
    // Celular: el concepto puede ir en 2 renglones; el monto nunca se parte.
    <div className={`flex items-baseline justify-between gap-3 px-1 ${total ? "mt-1 border-t-2 border-slate-200 pt-2 font-semibold" : "py-1.5"} ${sub ? "pl-6 text-[13px] text-slate-500" : ""}`}>
      <dt className={`min-w-0 ${sub ? "text-slate-500" : total ? "text-slate-900" : "text-slate-600"}`}>{l}</dt>
      <dd className={`flex shrink-0 items-baseline gap-2 whitespace-nowrap tabular-nums ${color} ${fuerte ? "text-base" : ""}`}>
        {nota ? <span className="text-[11px] font-normal text-slate-400">{nota}</span> : null}
        {v < 0 ? "−" : ""}{gs(Math.abs(v))}
      </dd>
    </div>
  );
}
