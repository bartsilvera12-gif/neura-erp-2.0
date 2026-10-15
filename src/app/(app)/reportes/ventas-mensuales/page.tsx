"use client";

/**
 * /reportes/ventas-mensuales — Ventas totales por mes (12 o 24 meses): por sucursal, contado vs
 * crédito, forma de pago y categoría, con la marca del mismo mes del año anterior (interanual).
 * Tocá un mes para abrir "Ventas del período" de ese mes.
 */
import { Suspense, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BarrasH, Columnas, Dona, Leyenda, SERIES, C_OTROS, colorMetodo } from "@/components/graficos/Graficos";
import { corto, gs, mesCorto, nombreMes, num, pct, variacion } from "@/components/graficos/formato";
import { Descargas, EncabezadoReporte, EstadoCarga, FiltrosReporte, Kpi, Segmentos, Tabla, Tarjeta, useFiltrosReporte, useReporte, type Atajo } from "@/modules/reportes/ui";
import type { VentasMes } from "@/modules/reportes/tipos";

const ATAJOS: Atajo[] = ["12m", "24m", "anio"];
type Vista = "sucursal" | "condicion" | "metodo" | "categoria";
const finMes = (mes: string) => {
  const d = new Date(`${mes}T12:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
};

export default function Page() {
  return <Suspense fallback={null}><VentasPorMes /></Suspense>;
}

function VentasPorMes() {
  const router = useRouter();
  const filtros = useFiltrosReporte("12m");
  const { data: d, error, cargando } = useReporte<VentasMes>(`/api/reportes/ventas-mensuales?${filtros.query}`);
  const [vista, setVista] = useState<Vista>("sucursal");

  const variasSuc = !!d && !d.sucursal_id && d.por_sucursal.length > 1;
  const v: Vista = vista === "sucursal" && !variasSuc ? "condicion" : vista;
  const series = useMemo(() => {
    if (!d) return [];
    if (v === "sucursal") return d.sucursales.map((s, i) => ({ key: s.id, label: s.nombre, color: SERIES[i % SERIES.length] }));
    if (v === "condicion") return [{ key: "contado", label: "Contado", color: SERIES[0] }, { key: "credito", label: "Crédito", color: colorMetodo("credito") }];
    if (v === "metodo") return d.metodos.map((m) => ({ key: m.metodo, label: m.label, color: colorMetodo(m.metodo) }));
    return d.categorias.map((c, i) => ({ key: c.id, label: c.nombre, color: c.id === "otras" || c.id === "sin" ? C_OTROS : SERIES[i % SERIES.length] }));
  }, [d, v]);
  const datos = useMemo(() => (d?.meses ?? []).map((m) => ({
    x: m.mes,
    valores: series.map((s) => Number(
      v === "sucursal" ? m.por_sucursal[s.key] ?? 0 : v === "condicion" ? (s.key === "contado" ? m.contado : m.credito)
        : v === "metodo" ? m.por_metodo[s.key] ?? 0 : m.por_categoria[s.key] ?? 0)),
    anterior: Number(m.anterior),
    nota: `${num(m.cantidad)} ventas · ticket ${gs(m.cantidad ? m.total / m.cantidad : 0)}`,
  })), [d, series, v]);

  const t = d?.totales;
  const mejor = d ? [...d.meses].sort((a, b) => Number(b.total) - Number(a.total))[0] : null;
  const mesesConVentas = d?.meses.filter((m) => Number(m.total) > 0).length ?? 0;
  const irMes = (mes: string) => router.push(`/reportes/ventas?desde=${mes}&hasta=${finMes(mes)}`);

  return (
    <div className="space-y-6 pb-10">
      <EncabezadoReporte kicker="Reportes · Ventas" titulo="Ventas por mes"
        subtitulo="Cómo vienen las ventas mes a mes y contra el mismo mes del año anterior. Tocá un mes para ver su detalle.">
        <Descargas excel={`/api/reportes/ventas-mensuales/export?${filtros.query}`} deshabilitado={!d} />
      </EncabezadoReporte>

      <FiltrosReporte filtros={filtros} atajos={ATAJOS} sucursales={d?.sucursales} cargando={cargando && !!d} />

      {!d || !t ? <EstadoCarga error={error} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi acento label="Ventas del período" valor={gs(t.total)} delta={{ actual: Number(t.total), anterior: Number(t.anterior), texto: "vs. año anterior" }}
              hint={`${d.meses.length} meses`} />
            <Kpi label="Cantidad de ventas" valor={num(t.cantidad)} delta={{ actual: Number(t.cantidad), anterior: Number(t.anterior_cantidad), texto: "vs. año anterior" }} />
            <Kpi label="Promedio por mes" valor={gs(mesesConVentas ? Number(t.total) / mesesConVentas : 0)} hint={`ticket ${gs(t.cantidad ? Number(t.total) / Number(t.cantidad) : 0)}`} />
            <Kpi label="Mejor mes" valor={mejor && Number(mejor.total) ? <span className="capitalize">{nombreMes(mejor.mes)}</span> : "—"} hint={mejor ? gs(mejor.total) : undefined}
              onClick={mejor ? () => irMes(mejor.mes) : undefined} />
            <Kpi label="Vendido a crédito" valor={pct(Number(t.credito), Number(t.total), 0)} hint={gs(t.credito)} />
          </div>

          <Tarjeta titulo="Ventas por mes" sub="la raya punteada es el mismo mes del año anterior · tocá un mes para ver su detalle"
            extra={<Segmentos<Vista> valor={v} onChange={setVista} opciones={[
              ...(variasSuc ? [["sucursal", "Sucursal"] as [Vista, string]] : []),
              ["condicion", "Contado / crédito"], ["metodo", "Forma de pago"], ["categoria", "Categoría"],
            ]} />}>
            <div className="mb-3"><Leyenda items={[...series.map((s) => ({ color: s.color, label: s.label })), { color: "#475569", label: "Año anterior", dashed: true }]} /></div>
            <Columnas ariaLabel="Ventas por mes" datos={datos} series={series} etiquetaX={mesCorto} tituloTooltip={nombreMes}
              anteriorLabel="Mismo mes, año anterior" onClick={irMes} alto={260} vacio="No hubo ventas en estos meses" />
          </Tarjeta>

          <div className="grid gap-6 xl:grid-cols-2">
            <Tarjeta titulo="Por forma de pago" sub="todo el período">
              <Dona centro={corto(Number(t.total))} sub="vendido"
                partes={d.metodos.map((m) => ({ label: m.label, valor: Number(m.total), color: colorMetodo(m.metodo) }))} />
            </Tarjeta>
            <Tarjeta titulo="Por categoría" sub="todo el período (categoría principal)">
              <BarrasH filas={d.categorias.map((c, i) => ({
                key: c.id, label: c.nombre, extra: pct(Number(c.total), Number(t.total), 0),
                partes: [{ valor: Number(c.total), color: c.id === "otras" || c.id === "sin" ? C_OTROS : SERIES[i % SERIES.length], label: c.nombre }],
              }))} />
            </Tarjeta>
          </div>

          <Tarjeta titulo="Mes a mes">
            <Tabla minW={880} onFila={irMes}
              cols={["Mes", "Ventas", "Cant.", "Ticket", "Contado", "Crédito", ...(variasSuc ? d.sucursales.map((s) => s.nombre) : []), "Año anterior", "Variación"]}
              der={[1, 2, 3, 4, 5, ...(variasSuc ? d.sucursales.map((_, i) => 6 + i) : []), 6 + (variasSuc ? d.sucursales.length : 0), 7 + (variasSuc ? d.sucursales.length : 0)]}
              filas={[...d.meses].reverse().map((m) => {
                const va = variacion(Number(m.total), Number(m.anterior));
                return {
                  key: m.mes, titulo: "Ver las ventas de ese mes",
                  celdas: [<span key="m" className="font-medium capitalize">{nombreMes(m.mes)}</span>, <b key="t">{gs(m.total)}</b>, num(m.cantidad),
                    gs(m.cantidad ? m.total / m.cantidad : 0), gs(m.contado), gs(m.credito),
                    ...(variasSuc ? d.sucursales.map((s) => gs(m.por_sucursal[s.id] ?? 0)) : []),
                    Number(m.anterior) ? gs(m.anterior) : "—",
                    va == null ? "—" : <span key="v" className={va >= 0 ? "text-emerald-600" : "text-rose-600"}>{va >= 0 ? "▲" : "▼"} {Math.abs(va).toFixed(1)} %</span>],
                };
              })}
              pie={["Total", gs(t.total), num(t.cantidad), gs(t.cantidad ? Number(t.total) / Number(t.cantidad) : 0), gs(t.contado), gs(t.credito),
                ...(variasSuc ? d.sucursales.map((s) => gs(d.por_sucursal.find((x) => x.id === s.id)?.total ?? 0)) : []), gs(t.anterior),
                variacion(Number(t.total), Number(t.anterior)) == null ? "—" : `${variacion(Number(t.total), Number(t.anterior))!.toFixed(1)} %`]} />
          </Tarjeta>
        </>
      )}
    </div>
  );
}
