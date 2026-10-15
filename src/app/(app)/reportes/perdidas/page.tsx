"use client";

/**
 * /reportes/perdidas — Pérdidas de producto: bajas PE- (vencimiento, rotura, devoluciones,
 * faltantes…) y faltantes de traslados, valorizadas al costo, por motivo, producto, categoría,
 * depósito y mes. Impacto: % sobre las ventas, sobre el valor del inventario y cómo restan en
 * el estado de cuenta (enlazado con el mismo rango).
 */
import Link from "next/link";
import { Suspense, useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { BarrasH, Columnas, Dona, Leyenda, SERIES } from "@/components/graficos/Graficos";
import { corto, fechaCorta, gs, mesCorto, nombreMes, num, pct } from "@/components/graficos/formato";
import { Descargas, EncabezadoReporte, EstadoCarga, FiltrosReporte, Kpi, Nota, Tabla, Tarjeta, useFiltrosReporte, useReporte, type Atajo } from "@/modules/reportes/ui";
import type { Perdidas } from "@/modules/reportes/tipos";

const ATAJOS: Atajo[] = ["mes", "mes_anterior", "3m", "6m", "anio"];
/** Color fijo por motivo (no cambia con el filtro). */
const C_MOTIVO: Record<string, string> = {
  vencimiento: SERIES[1], rotura: SERIES[2], devolucion_cliente: SERIES[3], devolucion_proveedor: SERIES[4],
  faltante: SERIES[7], consumo_interno: SERIES[5], diferencia_traslado: SERIES[6], otro: "#94a3b8",
};
const MOTIVOS_LABEL: Record<string, string> = {
  vencimiento: "Vencimiento", rotura: "Rotura / daño", devolucion_cliente: "Devolución de cliente", devolucion_proveedor: "Devolución a proveedor",
  faltante: "Faltante", consumo_interno: "Consumo interno", diferencia_traslado: "Diferencia de traslado", otro: "Otro",
};

export default function Page() {
  return <Suspense fallback={null}><ReportePerdidas /></Suspense>;
}

function ReportePerdidas() {
  const filtros = useFiltrosReporte("3m");
  const { data: d, error, cargando } = useReporte<Perdidas>(`/api/reportes/perdidas?${filtros.query}`);
  const t = d?.totales;
  const motivosMes = useMemo(() => {
    const s = new Set<string>();
    for (const m of d?.por_mes ?? []) for (const k of Object.keys(m.por_motivo)) s.add(k);
    return Object.keys(C_MOTIVO).filter((k) => s.has(k));
  }, [d]);
  const margen = d ? Number(d.impacto.ventas_netas) - Number(d.impacto.cmv) : 0;

  return (
    <div className="space-y-6 pb-10">
      <EncabezadoReporte kicker="Reportes · Inventario" titulo="Pérdidas de producto"
        subtitulo="Lo que se perdió por vencimiento, rotura, devoluciones o faltantes, valorizado al costo, y cuánto pesa sobre las ventas y el inventario.">
        <Descargas excel={`/api/reportes/perdidas/export?${filtros.query}`} pdf={`/api/reportes/perdidas/pdf?${filtros.query}`} deshabilitado={!d} />
      </EncabezadoReporte>

      <FiltrosReporte filtros={filtros} atajos={ATAJOS} sucursales={d?.sucursales} cargando={cargando && !!d} />

      {!d || !t ? <EstadoCarga error={error} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi acento label="Pérdidas al costo" valor={gs(t.valor)} hint={`${num(t.unidades, 2)} unidades · ${num(t.documentos)} documentos`} tono={Number(t.valor) ? "malo" : "bueno"} />
            <Kpi label="Sobre las ventas" valor={pct(Number(t.valor), Number(d.impacto.ventas_netas), 2)} hint={`de ${gs(d.impacto.ventas_netas)} vendidos`} />
            <Kpi label="Sobre el margen bruto" valor={pct(Number(t.valor), margen, 1)} hint={`margen ${gs(margen)}`} />
            <Kpi label="Sobre el inventario" valor={pct(Number(t.valor), Number(d.impacto.valor_inventario), 2)} hint={`stock al costo ${corto(Number(d.impacto.valor_inventario))}`} />
            <Kpi label="Por aprobar" valor={num(d.pendientes.cantidad)} tono={d.pendientes.cantidad ? "alerta" : undefined}
              hint={d.pendientes.cantidad ? `aprox. ${gs(d.pendientes.valor)} (todavía no restan)` : "nada pendiente"} href="/inventario/ajustes" />
          </div>

          <Link href={`/reportes/estado-cuenta?desde=${d.desde}&hasta=${d.hasta}${d.sucursal_id ? `&sucursal=${d.sucursal_id}` : ""}`}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-sm shadow-sm transition hover:shadow-md">
            <span className="text-slate-600">
              En el <b className="text-slate-800">estado de cuenta</b> estas pérdidas restan <b className="text-rose-600">{gs(t.valor)}</b> del resultado del período
              {Number(t.traslados) ? <> ({gs(t.pe)} en bajas PE- y {gs(t.traslados)} en faltantes de traslados)</> : null}; el inventario ya las descontó.
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]">Ver estado de cuenta <ArrowRight className="h-3.5 w-3.5" /></span>
          </Link>

          <div className="grid gap-6 xl:grid-cols-[1fr_1.4fr]">
            <Tarjeta titulo="Por motivo" sub="valor al costo">
              <Dona centro={corto(Number(t.valor))} sub="perdido"
                partes={d.por_motivo.map((m) => ({ label: m.label, valor: Number(m.valor), color: C_MOTIVO[m.motivo] ?? "#94a3b8" }))} />
            </Tarjeta>
            <Tarjeta titulo="Por mes" sub="últimos 12 meses hasta el fin del rango, por motivo"
              extra={<Leyenda items={motivosMes.map((k) => ({ color: C_MOTIVO[k], label: MOTIVOS_LABEL[k] }))} />}>
              <Columnas ariaLabel="Pérdidas por mes y motivo" etiquetaX={mesCorto} tituloTooltip={nombreMes} vacio="Sin pérdidas en estos meses"
                series={motivosMes.map((k) => ({ label: MOTIVOS_LABEL[k], color: C_MOTIVO[k] }))}
                datos={d.por_mes.map((m) => ({ x: m.mes, valores: motivosMes.map((k) => Number(m.por_motivo[k] ?? 0)) }))} />
            </Tarjeta>
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Tarjeta titulo="Productos con más pérdida" className="xl:col-span-2">
              <BarrasH max={10} vacio="Sin pérdidas en el período"
                filas={d.por_producto.map((p) => ({
                  key: p.id, label: p.nombre, extra: `${num(p.unidades, 2)} u.`,
                  partes: [{ valor: Number(p.valor), color: SERIES[7], label: "Pérdida" }],
                  detalle: p.motivos.join(", "),
                }))} />
            </Tarjeta>
            <Tarjeta titulo="Por categoría y depósito">
              <BarrasH max={6} vacio="—" filas={d.por_categoria.map((c) => ({ key: c.id ?? "sin", label: c.nombre, partes: [{ valor: Number(c.valor), color: SERIES[2], label: c.nombre }], extra: pct(Number(c.valor), Number(t.valor), 0) }))} />
              <div className="mt-5 border-t border-slate-100 pt-4">
                <BarrasH max={6} vacio="—" filas={d.por_deposito.map((x) => ({ key: x.id, label: `${x.nombre} · ${x.sucursal}`, partes: [{ valor: Number(x.valor), color: SERIES[6], label: x.nombre }], extra: pct(Number(x.valor), Number(t.valor), 0) }))} />
              </div>
            </Tarjeta>
          </div>

          <Tarjeta titulo="Detalle" sub={`${num(d.rows.length)} renglones · tocá el documento para abrirlo`}>
            <Tabla minW={960} vacio="No hubo pérdidas en el período."
              cols={["Fecha", "Documento", "Motivo", "Producto", "Depósito", "Unidades", "Valor al costo"]} der={[5, 6]}
              filas={d.rows.map((x, i) => ({
                key: `${x.documento_id}-${x.producto_id}-${i}`,
                celdas: [fechaCorta(x.dia),
                  <Link key="d" href={x.origen === "perdida" ? `/inventario/ajustes?ver=${x.documento_id}` : `/inventario/traslados?ver=${x.documento_id}`} className="font-mono text-xs text-[var(--brand)] hover:underline">{x.documento}</Link>,
                  <span key="m" className="inline-flex items-center gap-1.5" title={x.detalle ?? undefined}>
                    <span aria-hidden className="inline-block h-2 w-2 rounded-[2px]" style={{ backgroundColor: C_MOTIVO[x.motivo] ?? "#94a3b8" }} />{x.motivo_label}
                  </span>,
                  <span key="p" className="block max-w-[240px] truncate">{x.producto}</span>,
                  <span key="dep" className="text-xs">{x.deposito} · {x.sucursal}</span>,
                  num(x.unidades, 2), <b key="v">{gs(x.valor)}</b>],
              }))}
              pie={["Total", "", "", "", "", num(t.unidades, 2), gs(t.valor)]} />
            <div className="mt-3"><Nota>Bajas PE- aplicadas (valor al costo de lo que salió, por lote si corresponde) y faltantes de traslados recibidos con diferencias (cantidad no recibida × costo del traslado, en la sucursal que recibe). Las pérdidas pendientes de aprobación todavía no descontaron stock.</Nota></div>
          </Tarjeta>
        </>
      )}
    </div>
  );
}
