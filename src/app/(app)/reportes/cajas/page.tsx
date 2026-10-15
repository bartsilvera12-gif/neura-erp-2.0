"use client";

/**
 * /reportes/cajas — Cierre de caja por día: un renglón por día con lo vendido por forma de
 * pago, crédito, cobros, egresos y las diferencias de arqueo de todas las cajas. Tocá un día
 * para ver cada turno con todos sus datos (y bajar el PDF del día o de cada turno).
 * Un turno cuenta para el día en que se ABRIÓ. ADMIN: todas las sucursales; SUPERVISOR: la suya.
 */
import { Suspense, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Columnas, Leyenda, colorMetodo } from "@/components/graficos/Graficos";
import { diaSemana, gs, num } from "@/components/graficos/formato";
import { Descargas, EncabezadoReporte, EstadoCarga, FiltrosReporte, Kpi, Nota, Tabla, Tarjeta, useFiltrosReporte, useReporte } from "@/modules/reportes/ui";
import type { CierresDias } from "@/modules/reportes/tipos";

const conSigno = (n: number) => (n === 0 ? "Cuadró" : `${n > 0 ? "+" : "−"} ${gs(Math.abs(n))}`);

export default function Page() {
  return <Suspense fallback={null}><CierresPorDia /></Suspense>;
}

function CierresPorDia() {
  const router = useRouter();
  const filtros = useFiltrosReporte("mes");
  const { data: d, error, cargando } = useReporte<CierresDias>(`/api/reportes/cajas?${filtros.query}`);

  const series = useMemo(() => [
    ...(d?.metodos ?? []).map((m) => ({ key: m.metodo, label: m.label, color: colorMetodo(m.metodo) })),
    { key: "credito", label: "Crédito", color: colorMetodo("credito") },
  ], [d]);
  const datos = useMemo(() => [...(d?.dias ?? [])].reverse().map((x) => ({
    x: x.dia,
    valores: series.map((s) => (s.key === "credito" ? Number(x.credito) : Number(x.por_metodo[s.key] ?? 0))),
    nota: `${x.turnos} turno${x.turnos === 1 ? "" : "s"} · ${num(x.cantidad)} ventas${x.con_diferencia ? ` · ${x.con_diferencia} con diferencia` : ""}`,
  })), [d, series]);
  const t = d?.totales;
  const irDia = (dia: string) => router.push(`/reportes/cajas/${dia}${filtros.f.sucursal ? `?sucursal=${filtros.f.sucursal}` : ""}`);

  return (
    <div className="space-y-6 pb-10">
      <EncabezadoReporte kicker="Reportes · Caja" titulo="Cierre de caja por día"
        subtitulo="Lo que vendió cada día por forma de pago y cómo cerraron las cajas. Tocá un día para ver todos sus turnos.">
        <Descargas excel={`/api/reportes/cajas/export?${filtros.query}`} deshabilitado={!d?.dias.length} />
      </EncabezadoReporte>

      <FiltrosReporte filtros={filtros} sucursales={d?.sucursales} cargando={cargando && !!d} />

      {!d || !t ? <EstadoCarga error={error} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi acento label="Total vendido" valor={gs(t.total)} hint={`${num(t.cantidad)} ventas · ${t.dias} día${t.dias === 1 ? "" : "s"}`} />
            <Kpi label="Contado" valor={gs(t.contado)} hint={`${num(t.turnos)} turnos${t.abiertos ? ` · ${t.abiertos} abierto${t.abiertos === 1 ? "" : "s"}` : ""}`} />
            <Kpi label="Crédito" valor={gs(t.credito)} hint="ventas a cuenta" />
            <Kpi label="Diferencias de arqueo" valor={conSigno(Number(t.diferencia) + Number(t.diferencia_otros))}
              tono={t.con_diferencia ? (Number(t.diferencia) + Number(t.diferencia_otros) < 0 ? "malo" : "alerta") : "bueno"}
              hint={t.con_diferencia ? `${t.con_diferencia} turno${t.con_diferencia === 1 ? "" : "s"} con diferencia` : "Todos los turnos cuadraron"} />
            <Kpi label="Anuladas" valor={num(t.anuladas)} tono={t.anuladas ? "alerta" : undefined} hint={gs(t.anuladas_total)} />
          </div>

          <Tarjeta titulo="Vendido por día" sub="por forma de pago · tocá una columna para ver el cierre del día"
            extra={<Leyenda items={series.map((s) => ({ color: s.color, label: s.label }))} />}>
            <Columnas datos={datos} series={series.map((s) => ({ label: s.label, color: s.color }))} ariaLabel="Total vendido por día y forma de pago"
              etiquetaX={(x) => (datos.length > 14 ? String(Number(x.slice(8, 10))) : diaSemana(x))} tituloTooltip={diaSemana}
              onClick={irDia} vacio="No hubo turnos de caja en el período" />
          </Tarjeta>

          <Tarjeta titulo="Días" sub="Cada turno cuenta para el día en que se abrió (un turno que cerró después de la medianoche figura entero en el día de apertura).">
            <Tabla minW={900}
              cols={["Día", "Sucursales", "Turnos", ...d.metodos.map((m) => m.label), "Crédito", "Total vendido", "Diferencia", "Anuladas", ""]}
              der={[2, ...d.metodos.map((_, i) => 3 + i), 3 + d.metodos.length, 4 + d.metodos.length, 5 + d.metodos.length, 6 + d.metodos.length]}
              onFila={irDia}
              vacio="No hubo turnos de caja en el período."
              filas={d.dias.map((x) => {
                const dif = Number(x.diferencia) + Number(x.diferencia_otros);
                return {
                  key: x.dia,
                  titulo: "Ver el cierre del día",
                  celdas: [
                    <span key="d" className="font-medium capitalize">{diaSemana(x.dia)}</span>,
                    <span key="s" className="text-xs text-slate-500">{x.sucursales.join(", ")}</span>,
                    <span key="t">{x.turnos}{x.abiertos ? <span className="ml-1 rounded-full bg-amber-50 px-1.5 text-[10px] font-semibold text-amber-700">{x.abiertos} abierta{x.abiertos === 1 ? "" : "s"}</span> : null}</span>,
                    ...d.metodos.map((m) => (x.por_metodo[m.metodo] ? gs(x.por_metodo[m.metodo]) : <span key={m.metodo} className="text-slate-300">—</span>)),
                    x.credito ? gs(x.credito) : <span key="c" className="text-slate-300">—</span>,
                    <b key="tot" className="text-slate-900">{gs(x.total)}</b>,
                    <span key="dif" className={dif === 0 ? "text-emerald-600" : dif < 0 ? "font-semibold text-rose-600" : "font-semibold text-amber-600"}>{conSigno(dif)}</span>,
                    x.anuladas ? <span key="an" className="text-rose-600">{x.anuladas}</span> : "0",
                    <ChevronRight key="ir" className="ml-auto h-4 w-4 text-slate-300" />,
                  ],
                };
              })}
              pie={["Total", "", num(t.turnos), ...d.metodos.map((m) => gs(t.por_metodo[m.metodo] ?? 0)), gs(t.credito), gs(t.total),
                conSigno(Number(t.diferencia) + Number(t.diferencia_otros)), num(t.anuladas), ""]} />
            <div className="mt-3"><Nota>Diferencia = efectivo contado − esperado, más lo declarado en otras formas de pago − lo esperado. Las ventas anuladas después del cierre no cambian el arqueo del turno: su devolución sale de la caja abierta en ese momento.</Nota></div>
          </Tarjeta>
        </>
      )}
    </div>
  );
}
