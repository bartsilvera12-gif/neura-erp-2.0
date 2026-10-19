"use client";

/**
 * /reportes/formas-pago — Formas de pago: cuánto se vendió y se ganó con cada medio (efectivo,
 * tarjetas, transferencia, QR…), con la venta a crédito aparte, los cobros de créditos por
 * medio (la plata que entró) y la evolución por día o mes. Los pagos mixtos van a cada medio
 * por lo que se pagó con él y su costo se reparte en la misma proporción. Sin comisiones de
 * procesadoras: ingreso completo. Todo sale de reporte_formas_pago (receta 60). ADMIN.
 */
import Link from "next/link";
import { Suspense, useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { TablaTarjetas, type ColumnaTabla } from "@/components/TablaResponsive";
import { BarrasH, Columnas, Dona, Leyenda, SERIES, colorMetodo } from "@/components/graficos/Graficos";
import { corto, diaLargo, diaSemana, gs, mesCorto, nombreMes, num, pct } from "@/components/graficos/formato";
import { Descargas, EncabezadoReporte, EstadoCarga, FilaKpis, FiltrosReporte, Kpi, Nota, SANGRIA_TARJETAS, Tabla, Tarjeta, useFiltrosReporte, useReporte, type Atajo } from "@/modules/reportes/ui";
import type { FormasPago } from "@/modules/reportes/tipos";

const ATAJOS: Atajo[] = ["hoy", "semana", "mes", "mes_anterior", "3m", "6m", "anio"];
const C_VENTAS = SERIES[0];
const C_COBROS = SERIES[3];

type Fila = { key: string; label: string; color: string; ventas: number; cantidad: number; costo: number; ganancia: number; tipo: "medio" | "credito" | "total" };

export default function Page() {
  return <Suspense fallback={null}><FormasDePago /></Suspense>;
}

function FormasDePago() {
  const filtros = useFiltrosReporte("mes");
  const { data: d, error, cargando } = useReporte<FormasPago>(`/api/reportes/formas-pago?${filtros.query}`);
  const q = filtros.query;

  const x = useMemo(() => {
    if (!d) return null;
    const total = Number(d.totales.ventas);
    const medios: Fila[] = d.medios.map((m) => ({
      key: m.metodo, label: m.label, color: colorMetodo(m.metodo), ventas: Number(m.ventas), cantidad: Number(m.cantidad),
      costo: Number(m.costo), ganancia: Number(m.ganancia), tipo: "medio",
    }));
    const credito: Fila | null = Number(d.credito.ventas) ? {
      key: "credito", label: "Venta a crédito", color: colorMetodo("credito"), ventas: Number(d.credito.ventas), cantidad: Number(d.credito.cantidad),
      costo: Number(d.credito.costo), ganancia: Number(d.credito.ganancia), tipo: "credito",
    } : null;
    const filaTotal: Fila = {
      key: "__total", label: "Total", color: "#0f172a", ventas: total, cantidad: Number(d.totales.cantidad),
      costo: Number(d.totales.costo), ganancia: Number(d.totales.ganancia), tipo: "total",
    };
    const series = [...medios, ...(credito ? [credito] : [])];
    const principal = [...medios].sort((a, b) => b.ventas - a.ventas)[0] ?? null;
    const ingresoTotal = Number(d.totales.contado) + Number(d.cobros.total);
    return { total, medios, credito, filaTotal, series, principal, ingresoTotal };
  }, [d]);

  const columnas = useMemo<ColumnaTabla<Fila>[]>(() => {
    const total = x?.total ?? 0;
    const fuerte = (f: Fila) => (f.tipo === "total" ? "font-semibold text-slate-900" : "");
    return [
      {
        key: "medio", titulo: "Forma de pago", movil: "titulo",
        celda: (f) => (
          <span className={`inline-flex items-center gap-2 whitespace-nowrap ${f.tipo === "total" ? "font-semibold text-slate-900" : "font-medium text-slate-800"}`}>
            {f.tipo !== "total" ? <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: f.color }} /> : null}
            {f.label}
          </span>
        ),
      },
      { key: "ventas", titulo: "Ventas", movil: "valor", claseTh: "text-right", claseTd: "whitespace-nowrap text-right tabular-nums font-semibold text-slate-900", celda: (f) => gs(f.ventas) },
      {
        key: "cant", titulo: "Cant.", movil: "subtitulo", claseTh: "text-right", claseTd: "whitespace-nowrap text-right tabular-nums text-slate-600",
        celda: (f) => <span className={fuerte(f)}>{num(f.cantidad)}</span>,
        celdaMovil: (f) => `${num(f.cantidad)} ${f.cantidad === 1 ? "venta" : "ventas"} · ${pct(f.ventas, total)} del total`,
      },
      { key: "ticket", titulo: "Ticket promedio", movil: "dato", etiquetaMovil: "Ticket", claseTh: "text-right", claseTd: "whitespace-nowrap text-right tabular-nums text-slate-600", celda: (f) => <span className={fuerte(f)}>{gs(f.cantidad ? f.ventas / f.cantidad : 0)}</span> },
      { key: "costo", titulo: "Costo", movil: "dato", claseTh: "text-right", claseTd: "whitespace-nowrap text-right tabular-nums text-slate-600", celda: (f) => <span className={fuerte(f)}>{gs(f.costo)}</span> },
      {
        key: "ganancia", titulo: "Ganancia bruta", movil: "dato", etiquetaMovil: "Ganancia", claseTh: "text-right", claseTd: "whitespace-nowrap text-right tabular-nums",
        celda: (f) => <span className={`${f.ganancia < 0 ? "text-rose-600" : "text-emerald-700"} ${f.tipo === "total" ? "font-semibold" : ""}`}>{gs(f.ganancia)}</span>,
      },
      { key: "margen", titulo: "Margen", movil: "dato", claseTh: "text-right", claseTd: "whitespace-nowrap text-right tabular-nums text-slate-600", celda: (f) => <span className={fuerte(f)}>{pct(f.ganancia, f.ventas)}</span> },
      {
        key: "part", titulo: "% del total", movil: "oculto", claseTh: "text-right", claseTd: "whitespace-nowrap text-right tabular-nums text-slate-600",
        celda: (f) => (
          <span className={`inline-flex items-center justify-end gap-2 ${fuerte(f)}`}>
            {f.tipo !== "total" ? (
              <span aria-hidden className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-slate-100 lg:inline-block">
                <span className="block h-full rounded-full" style={{ width: `${total ? Math.max(2, (f.ventas / total) * 100) : 0}%`, backgroundColor: f.color }} />
              </span>
            ) : null}
            {pct(f.ventas, total)}
          </span>
        ),
      },
    ];
  }, [x]);

  const evolucion = useMemo(() => {
    if (!d || !x) return { datos: [], series: [] as { key: string; label: string; color: string }[] };
    const series = x.series.map((s) => ({ key: s.key, label: s.label, color: s.color }));
    const datos = d.evolucion.map((e) => {
      const valores = series.map((s) => Number(e.por_metodo[s.key] ?? 0));
      return { x: e.x, valores, nota: Number(e.cobros) ? `+ cobros de créditos ${gs(e.cobros)}` : undefined };
    });
    return { datos, series };
  }, [d, x]);

  const porDia = d?.agrupacion === "dia";
  const filas = x ? [...x.medios, ...(x.credito ? [x.credito] : []), x.filaTotal] : [];

  return (
    <div className="space-y-6 pb-10">
      <EncabezadoReporte kicker="Reportes · Ventas" titulo="Formas de pago"
        subtitulo="Cuánto se vende, cuánto entra y cuánto se gana con cada medio de pago. Ingreso completo, sin descontar comisiones de procesadoras.">
        <Descargas excel={`/api/reportes/formas-pago/export?${q}`} deshabilitado={!d} />
      </EncabezadoReporte>

      <FiltrosReporte filtros={filtros} atajos={ATAJOS} sucursales={d?.sucursales} cargando={cargando && !!d} />

      {!d || !x ? <EstadoCarga error={error} /> : (
        <>
          <FilaKpis n={5}>
            <Kpi acento label="Ventas del período" valor={gs(x.total)} hint={`${num(d.totales.cantidad)} ventas · ${pct(Number(d.totales.credito), x.total, 0)} a crédito`}
              href={`/reportes/ventas?desde=${d.desde}&hasta=${d.hasta}`} />
            <Kpi label="Ingreso total" valor={gs(x.ingresoTotal)} hint={`contado ${corto(Number(d.totales.contado))} + cobros ${corto(Number(d.cobros.total))}`} />
            <Kpi label="Ganancia bruta" valor={gs(d.totales.ganancia)} hint={`costo ${gs(d.totales.costo)}`} tono={Number(d.totales.ganancia) < 0 ? "malo" : undefined} />
            <Kpi label="Margen bruto" valor={pct(Number(d.totales.ganancia), x.total)} hint="ganancia sobre ventas" tono={Number(d.totales.ganancia) < 0 ? "malo" : undefined} />
            <Kpi label="Medio principal" valor={x.principal ? x.principal.label : "—"}
              hint={x.principal ? `${pct(x.principal.ventas, x.total, 0)} de las ventas · ${corto(x.principal.ventas)}` : undefined} />
          </FilaKpis>

          {d.totales.productos_sin_costo ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 sm:px-4">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 max-sm:basis-[calc(100%-1.5rem)]">{d.totales.productos_sin_costo} venta(s) tienen productos sin costo cargado: la ganancia está sobreestimada.</span>
              <Link href={`/reportes/ventas?desde=${d.desde}&hasta=${d.hasta}`} className="ml-auto inline-flex items-center font-semibold underline max-sm:-mb-2 max-sm:ml-6 max-sm:min-h-11">Corregir costos</Link>
            </p>
          ) : null}

          <Tarjeta titulo="Por forma de pago" sub="ventas con IVA incluido · cantidad = ventas en las que intervino el medio · costo de lo vendido prorrateado">
            {x.total === 0 ? <p className="py-8 text-center text-sm text-slate-400">No hubo ventas en el período.</p> : (
              <div className={SANGRIA_TARJETAS}>
                <TablaTarjetas<Fila> filas={filas} columnas={columnas} claveFila={(f) => f.key} minAncho={860}
                  claseFila={(f) => (f.tipo === "total" ? "bg-slate-50 [&>td]:border-t-2 [&>td]:border-slate-200" : f.tipo === "credito" ? "[&>td]:border-t [&>td]:border-dashed [&>td]:border-slate-200" : "")} />
              </div>
            )}
            <div className="mt-4 space-y-1">
              {d.totales.mixtas ? <Nota>{num(d.totales.mixtas)} venta(s) se pagaron con más de un medio: cada medio suma lo que se pagó con él y el costo de la venta se reparte en la misma proporción (por eso la cantidad de ventas de los medios suma más que el total).</Nota> : null}
              <Nota>La venta a crédito va aparte: lo que se cobre de esas cuentas aparece abajo, en “Plata que entró por medio”. Ventas anuladas fuera del total: {num(d.anuladas.cantidad)} por {gs(d.anuladas.total)}.</Nota>
            </div>
          </Tarjeta>

          <div className="grid gap-6 xl:grid-cols-2">
            <Tarjeta titulo="Participación en las ventas" sub="todo el período, crédito incluido">
              <Dona centro={corto(x.total)} sub="vendido" partes={x.series.map((s) => ({ key: s.key, label: s.label, valor: s.ventas, color: s.color }))} />
            </Tarjeta>
            <Tarjeta titulo="Ganancia bruta por medio" sub="a la derecha, el margen de cada medio">
              <BarrasH filas={[...x.series].sort((a, b) => b.ganancia - a.ganancia).map((s) => ({
                key: s.key, label: s.label, extra: pct(s.ganancia, s.ventas, 0),
                partes: [{ valor: Math.max(s.ganancia, 0), color: s.color, label: s.label }],
              }))} />
            </Tarjeta>
          </div>

          <Tarjeta titulo={porDia ? "Evolución por día" : "Evolución por mes"} sub="ventas apiladas por forma de pago"
            extra={<Leyenda items={evolucion.series.map((s) => ({ color: s.color, label: s.label }))} />}>
            <Columnas ariaLabel={`Ventas por forma de pago, por ${porDia ? "día" : "mes"}`} datos={evolucion.datos} series={evolucion.series}
              etiquetaX={porDia ? (v) => diaSemana(v).slice(4) : mesCorto} tituloTooltip={porDia ? diaLargo : nombreMes}
              alto={250} vacio="No hubo ventas en el período" />
          </Tarjeta>

          <Tarjeta titulo="Plata que entró por medio" sub="ventas de contado + cobros de créditos del período (cobros no anulados)"
            extra={<Leyenda items={[{ color: C_VENTAS, label: "Ventas de contado" }, { color: C_COBROS, label: "Cobros de créditos" }]} />}>
            <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
              <BarrasH vacio="No entró plata en el período" filas={[...d.ingresos].sort((a, b) => Number(b.total) - Number(a.total)).map((i) => ({
                key: i.metodo, label: i.label, extra: pct(Number(i.total), x.ingresoTotal, 0),
                partes: [
                  { valor: Number(i.ventas), color: C_VENTAS, label: "Ventas de contado" },
                  { valor: Number(i.cobros), color: C_COBROS, label: "Cobros de créditos" },
                ],
              }))} />
              <Tabla cols={["Medio", "Ventas contado", "Cobros", "Ingreso"]} der={[1, 2, 3]}
                filas={d.ingresos.map((i) => ({ key: i.metodo, celdas: [i.label, gs(i.ventas), gs(i.cobros), <b key="t" className="text-slate-900">{gs(i.total)}</b>] }))}
                pie={["Total", gs(d.totales.contado), gs(d.cobros.total), gs(x.ingresoTotal)]}
                vacio="No entró plata en el período." />
            </div>
            <div className="mt-4"><Nota>{num(d.cobros.cantidad)} cobro(s) de créditos en el período. {d.sucursal_id ? "Con sucursal elegida: lo cobrado de ventas de esa sucursal." : ""}</Nota></div>
          </Tarjeta>
        </>
      )}
    </div>
  );
}
