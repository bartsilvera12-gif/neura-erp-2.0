"use client";

/**
 * /reportes/proveedores/<id> — Ficha de un proveedor: cuánto se le compra y cada cuánto,
 * evolución mensual, los productos que más se le compran, todos los productos asociados
 * (proveedor principal + los que se le compraron alguna vez), historial de compras, cuentas
 * por pagar y pagos. Todo con el rango de fechas y la sucursal de la URL.
 */
import Link from "next/link";
import { Suspense, useState } from "react";
import { useParams } from "next/navigation";
import { BarrasH, Columnas, Leyenda, C_MERCADERIA, C_OPERATIVOS, SERIES } from "@/components/graficos/Graficos";
import { fechaCorta, fechaHoraPY, gs, mesCorto, nombreMes, num, pct } from "@/components/graficos/formato";
import { Descargas, EncabezadoReporte, EstadoCarga, FilaKpis, FiltrosReporte, Kpi, Segmentos, Tabla, Tarjeta, useFiltrosReporte, useReporte, type Atajo } from "@/modules/reportes/ui";
import type { ProveedorDetalle } from "@/modules/reportes/tipos";

const ATAJOS: Atajo[] = ["mes", "mes_anterior", "3m", "6m", "anio"];
const diasDesde = (ymd: string, hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" })) =>
  Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${ymd}T00:00:00Z`)) / 86400000);

export default function Page() {
  return <Suspense fallback={null}><FichaProveedor /></Suspense>;
}

function FichaProveedor() {
  const { id } = useParams<{ id: string }>();
  const filtros = useFiltrosReporte("3m");
  const { data: d, error, cargando } = useReporte<ProveedorDetalle>(`/api/reportes/proveedores/${id}?${filtros.query}`);
  const [vista, setVista] = useState<"productos" | "compras" | "cuentas" | "pagos">("productos");

  const k = d?.kpis;
  const p = d?.proveedor;
  const top = (d?.productos ?? []).filter((x) => Number(x.monto) > 0);
  const totalProd = top.reduce((a, x) => a + Number(x.monto), 0);

  return (
    <div className="space-y-6 pb-10">
      <EncabezadoReporte kicker="Reportes · Proveedores" volver={{ href: `/reportes/proveedores?${filtros.query}`, label: "Proveedores" }}
        titulo={p?.nombre ?? "Proveedor"}
        subtitulo={p ? [p.nombre_comercial, p.ruc ? `RUC ${p.ruc}` : null, p.telefono, p.contacto ? `Contacto: ${p.contacto}` : null,
          p.condicion_pago ? `Condición: ${p.condicion_pago.toLowerCase()}${p.plazo_pago_dias ? ` a ${p.plazo_pago_dias} días` : ""}` : null].filter(Boolean).join(" · ") : undefined}>
        <Descargas excel={`/api/reportes/proveedores/${id}/export?${filtros.query}`} deshabilitado={!d} />
      </EncabezadoReporte>

      <FiltrosReporte filtros={filtros} atajos={ATAJOS} sucursales={d?.sucursales} cargando={cargando && !!d} />

      {!d || !k ? <EstadoCarga error={error} /> : (
        <>
          <FilaKpis n={5}>
            <Kpi acento label="Comprado en el período" valor={gs(k.compras)} hint={`${num(k.compras_cant)} compra${Number(k.compras_cant) === 1 ? "" : "s"}`} />
            <Kpi label="Compra promedio" valor={gs(Number(k.compras_cant) ? Number(k.compras) / Number(k.compras_cant) : 0)} hint={`Histórico ${gs(k.compras_historicas)}`} />
            <Kpi label="Última compra" valor={k.ultima_compra ? fechaCorta(k.ultima_compra) : "Nunca"}
              hint={k.ultima_compra ? `hace ${diasDesde(k.ultima_compra)} días · le comprás desde ${fechaCorta(k.primera_compra)}` : undefined} />
            <Kpi label="Le debés" valor={gs(k.deuda_gs)} tono={Number(k.vencido_gs) > 0 ? "malo" : undefined}
              hint={`Vencido ${gs(k.vencido_gs)}${Number(k.deuda_usd) ? ` · USD ${num(k.deuda_usd, 2)}` : ""}`} onClick={() => setVista("cuentas")} />
            <Kpi label="Pagado en el período" valor={gs(k.pagado)} hint={Number(k.gastos) ? `Gastos operativos ${gs(k.gastos)}` : "pagos registrados"} onClick={() => setVista("pagos")} />
          </FilaKpis>

          <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
            <Tarjeta titulo="Compras por mes" sub="últimos 12 meses hasta el fin del rango"
              extra={<Leyenda items={[{ color: C_MERCADERIA, label: "Mercadería" }, { color: C_OPERATIVOS, label: "Gastos operativos" }]} />}>
              <Columnas ariaLabel="Compras al proveedor por mes" etiquetaX={mesCorto} tituloTooltip={nombreMes}
                series={[{ label: "Mercadería", color: C_MERCADERIA }, { label: "Gastos operativos", color: C_OPERATIVOS }]}
                datos={d.por_mes.map((m) => ({ x: m.mes, valores: [Number(m.compras), Number(m.operativos)] }))} vacio="Sin compras en estos meses" />
            </Tarjeta>
            <Tarjeta titulo="Lo que más le comprás" sub="por monto, en el período">
              <BarrasH max={8} vacio="No le compraste en el período"
                filas={top.map((x) => ({
                  key: x.id, label: x.nombre, extra: pct(Number(x.monto), totalProd, 0),
                  partes: [{ valor: Number(x.monto), color: SERIES[0], label: "Comprado" }],
                  detalle: `${num(x.cantidad, 2)} unidades en ${num(x.compras)} compra${Number(x.compras) === 1 ? "" : "s"}${x.ultimo_costo ? ` · último costo ${gs(x.ultimo_costo)}` : ""}`,
                }))} />
            </Tarjeta>
          </div>

          <Tarjeta titulo={{ productos: "Productos asociados", compras: "Historial de compras", cuentas: "Cuentas por pagar", pagos: "Pagos" }[vista]}
            extra={<Segmentos valor={vista} onChange={setVista} opciones={[
              ["productos", `Productos (${d.productos.length})`], ["compras", `Compras (${d.compras.length})`],
              ["cuentas", `Por pagar (${d.cuentas.length})`], ["pagos", `Pagos (${d.pagos.length})`],
            ]} />}>
            {vista === "productos" ? (
              <Tabla minW={980} vacio="Este proveedor no tiene productos asociados."
                cols={["Producto", "Comprado (rango)", "Unidades", "Última compra", "Último costo", "Costo prom.", "Precio venta", "Margen", "Stock"]}
                der={[1, 2, 4, 5, 6, 7, 8]}
                filas={d.productos.map((x) => {
                  const margen = Number(x.precio_venta) - Number(x.costo_promedio);
                  return {
                    key: x.id, tenue: !x.activo,
                    celdas: [
                      <span key="n" className="block max-w-[280px] truncate">
                        <span className="font-medium">{x.nombre}</span>
                        {x.principal ? <span className="ml-1.5 rounded-full bg-[var(--brand-50)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--brand)]">Principal</span> : null}
                        {x.sku ? <span className="block font-mono text-[11px] text-slate-400">{x.sku}</span> : null}
                      </span>,
                      Number(x.monto) ? <b key="m">{gs(x.monto)}</b> : <span key="m" className="text-slate-300">—</span>,
                      Number(x.cantidad) ? num(x.cantidad, 2) : "—",
                      x.ultima_compra ? fechaCorta(x.ultima_compra) : <span key="u" className="text-slate-300">nunca</span>,
                      x.ultimo_costo != null ? gs(x.ultimo_costo) : "—",
                      gs(x.costo_promedio),
                      gs(x.precio_venta),
                      <span key="mg" className={margen <= 0 ? "text-rose-600" : "text-slate-600"}>{pct(margen, Number(x.precio_venta))}</span>,
                      <span key="s" className={Number(x.stock_actual) <= 0 ? "font-semibold text-rose-600" : ""}>{num(x.stock_actual, 2)}</span>,
                    ],
                  };
                })} />
            ) : vista === "compras" ? (
              <Tabla minW={900} vacio="No hay compras en el período."
                cols={["Número", "Fecha", "Factura", "Condición", "Sucursal", "Ítems", "Total", "Saldo"]} der={[5, 6, 7]}
                filas={d.compras.map((c) => ({
                  key: c.id, tenue: c.estado === "anulada",
                  celdas: [
                    <Link key="n" href={`/gastos-empresariales/compras-gastos?ver=${c.id}&desde=&hasta=`} className="font-mono text-xs text-[var(--brand)] hover:underline max-sm:-my-2 max-sm:inline-flex max-sm:min-h-11 max-sm:items-center">{c.numero_control}</Link>,
                    fechaCorta(c.fecha), c.numero_factura ?? "—",
                    c.tipo_pago === "credito" ? "Crédito" : "Contado",
                    c.sucursal_nombre ?? "—", num(c.items),
                    <span key="t" className={c.estado === "anulada" ? "line-through" : "font-semibold text-slate-900"}>{c.moneda === "USD" ? `USD ${num(c.total, 2)}` : gs(c.total)}</span>,
                    c.saldo != null ? <span key="s" className="text-amber-600">{gs(c.saldo)}</span> : c.estado === "anulada" ? "Anulada" : "—",
                  ],
                }))}
                pie={["Total", "", "", "", "", num(d.compras.filter((c) => c.estado !== "anulada").length), gs(d.compras.filter((c) => c.estado !== "anulada").reduce((a, c) => a + Number(c.total_gs), 0)), ""]} />
            ) : vista === "cuentas" ? (
              <Tabla vacio="No le debés nada a este proveedor."
                cols={["Documento", "Origen", "Emisión", "Vencimiento", "Atraso", "Monto", "Pagado", "Saldo"]} der={[4, 5, 6, 7]}
                filas={d.cuentas.map((c) => ({
                  key: c.id,
                  celdas: [c.documento, c.origen === "compra" ? "Compra" : "Gasto", fechaCorta(c.fecha_emision), fechaCorta(c.vencimiento),
                    c.dias_atraso ? <span key="a" className="font-semibold text-rose-600">{c.dias_atraso} días</span> : <span key="a" className="text-emerald-600">al día</span>,
                    c.moneda === "USD" ? `USD ${num(c.monto, 2)}` : gs(c.monto), c.moneda === "USD" ? `USD ${num(c.pagado, 2)}` : gs(c.pagado),
                    <b key="s">{c.moneda === "USD" ? `USD ${num(c.saldo, 2)}` : gs(c.saldo)}</b>],
                }))}
                pie={["Total en Gs.", "", "", "", "", "", "", gs(d.cuentas.reduce((a, c) => a + Number(c.saldo_gs), 0))]} />
            ) : (
              <Tabla vacio="No hubo pagos en el período."
                cols={["Número", "Fecha", "Medios", "Total"]} der={[3]}
                filas={d.pagos.map((x) => ({
                  key: x.id, tenue: x.anulado,
                  celdas: [<Link key="n" href="/compras/pagos" className="font-mono text-xs text-[var(--brand)] hover:underline max-sm:-my-2 max-sm:inline-flex max-sm:min-h-11 max-sm:items-center">{x.numero}</Link>, fechaHoraPY(x.fecha),
                    x.medios.map((m) => m.metodo).join(" + "), <span key="t" className={x.anulado ? "line-through" : "font-semibold"}>{x.moneda === "USD" ? `USD ${num(x.total, 2)}` : gs(x.total)}</span>],
                }))} />
            )}
          </Tarjeta>
        </>
      )}
    </div>
  );
}
