"use client";

/**
 * /reportes/cuentas-pagar — A quién le debés y cuándo vence: compras y gastos a crédito por
 * proveedor y vencimiento, antigüedad (al día, 1–30, 31–60, 61–90, +90), lo vencido y el
 * calendario de pagos de las próximas 8 semanas. GS y USD (los USD se suman en Gs. al tipo de
 * cambio de cada documento). Cuadra con Pagos a proveedores (listar_cuentas_pagar).
 */
import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { BarraTramos, BarrasH, Columnas, C_TRAMOS, SERIES } from "@/components/graficos/Graficos";
import { fechaCorta, gs, num } from "@/components/graficos/formato";
import { Descargas, EncabezadoReporte, EstadoCarga, FilaKpis, FiltrosReporte, Kpi, Nota, Segmentos, Tabla, Tarjeta, useFiltrosReporte, useReporte, type Atajo } from "@/modules/reportes/ui";
import { TRAMOS, type CuentasPagar, type Tramos } from "@/modules/reportes/tipos";

const ATAJOS: Atajo[] = ["todo", "mes", "3m", "anio"];
const usd = (n: number) => `USD ${Number(n).toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const semana = (i: number, desde: string) => (i === 0 ? "Esta semana" : i === 1 ? "Próxima" : fechaCorta(desde).slice(0, 5));

export default function Page() {
  return <Suspense fallback={null}><CuentasPorPagar /></Suspense>;
}

function CuentasPorPagar() {
  const filtros = useFiltrosReporte("todo", ["proveedor"]);
  const { data: d, error, cargando } = useReporte<CuentasPagar>(`/api/reportes/cuentas-pagar?${filtros.query}`);
  const [vista, setVista] = useState<"proveedor" | "documento">("proveedor");
  const [tramo, setTramo] = useState<keyof Tramos | null>(null);
  const [moneda, setMoneda] = useState<"" | "GS" | "USD">("");

  const t = d?.tramos_gs;
  const docs = useMemo(() => (d?.rows ?? []).filter((r) => (!tramo || r.tramo === tramo) && (!moneda || r.moneda === moneda)), [d, tramo, moneda]);
  const prov = filtros.extra.proveedor ? d?.por_proveedor.find((p) => p.id === filtros.extra.proveedor)?.nombre : null;

  return (
    <div className="space-y-6 pb-10">
      <EncabezadoReporte kicker="Reportes · Finanzas" titulo="Cuentas por pagar"
        subtitulo={<>Lo que le debés a cada proveedor por compras y gastos a crédito, cuándo vence y cuánto ya está atrasado. Para pagar, andá a <Link href="/compras/pagos" className="font-semibold text-[var(--brand)] hover:underline">Pagos a proveedores</Link>.</>}>
        <Descargas excel={`/api/reportes/cuentas-pagar/export?${filtros.query}`} pdf={`/api/reportes/cuentas-pagar/pdf?${filtros.query}`} deshabilitado={!d?.rows.length} />
      </EncabezadoReporte>

      <FiltrosReporte filtros={filtros} atajos={ATAJOS} etiquetaFechas="Emitidas:" sucursales={d?.sucursales} cargando={cargando && !!d}>
        {prov ? (
          <button type="button" onClick={() => filtros.cambiar({ proveedor: null })} className="rounded-xl bg-[var(--brand-50)] px-3 py-1.5 text-xs font-semibold text-[var(--brand)] max-sm:min-h-11 max-sm:text-[13px]">
            {prov} ✕
          </button>
        ) : null}
      </FiltrosReporte>

      {!d || !t ? <EstadoCarga error={error} /> : (
        <>
          <FilaKpis n={5}>
            <Kpi acento label="Total a pagar" valor={gs(t.total)} hint={`${num(t.proveedores)} proveedores · ${num(d.rows.length)} documentos`} />
            <Kpi label="Vencido" valor={gs(t.vencido)} tono={Number(t.vencido) ? "malo" : "bueno"} hint={Number(t.total) ? `${Math.round((Number(t.vencido) / Number(t.total)) * 100)} % del total` : "nada vencido"}
              onClick={() => { setVista("documento"); setTramo(null); }} />
            <Kpi label="Vence esta semana" valor={gs(d.calendario[0]?.saldo_gs ?? 0)} tono={Number(d.calendario[0]?.saldo_gs) ? "alerta" : undefined} hint="próximos 7 días" />
            <Kpi label="Compras / gastos" valor={gs(t.compras)} hint={`Gastos a crédito ${gs(t.gastos)}`} />
            <Kpi label="En dólares" valor={d.por_moneda.USD ? usd(d.por_moneda.USD.saldo) : "—"}
              hint={d.por_moneda.USD ? `≈ ${gs(d.por_moneda.USD.saldo_gs)} · vencido ${usd(d.por_moneda.USD.vencido)}` : "sin deudas en USD"} />
          </FilaKpis>

          <Tarjeta titulo="Antigüedad de la deuda" sub="en Gs. (USD al tipo de cambio de cada documento) · tocá un tramo para filtrar los documentos">
            <BarraTramos activo={tramo} onClick={(k) => { setTramo((x) => (x === k ? null : (k as keyof Tramos))); setVista("documento"); }}
              tramos={TRAMOS.map((x, i) => ({ key: x.key, label: x.label, valor: Number(t[x.key]), color: C_TRAMOS[i] }))} />
          </Tarjeta>

          <div className="grid gap-6 xl:grid-cols-2">
            <Tarjeta titulo="Calendario de pagos" sub="lo que vence en cada una de las próximas 8 semanas (sin lo ya vencido)">
              <Columnas ariaLabel="Vencimientos por semana" alto={210} vacio="No vence nada en las próximas semanas"
                series={[{ label: "Vence", color: SERIES[0] }]}
                datos={d.calendario.map((c) => ({ x: c.desde, valores: [Number(c.saldo_gs)] }))}
                etiquetaX={(x, i) => semana(i, x)}
                tituloTooltip={(x) => { const c = d.calendario.find((y) => y.desde === x)!; return `${fechaCorta(c.desde).slice(0, 5)} al ${fechaCorta(c.hasta).slice(0, 5)}`; }} />
            </Tarjeta>
            <Tarjeta titulo="A quién le debés más" sub="saldo por proveedor, por antigüedad">
              <BarrasH max={8} fmtTip={gs} vacio="No le debés a nadie"
                filas={d.por_proveedor.map((p) => ({
                  key: p.id, label: p.nombre,
                  partes: TRAMOS.map((x, i) => ({ valor: Number(p[x.key]), color: C_TRAMOS[i], label: x.label })),
                  detalle: `${p.cuentas} documento${p.cuentas === 1 ? "" : "s"}${p.proximo_vencimiento ? ` · próximo vence ${fechaCorta(p.proximo_vencimiento)}` : ""}`,
                  href: `/reportes/proveedores/${p.id}`,
                }))} />
            </Tarjeta>
          </div>

          <Tarjeta titulo={vista === "proveedor" ? "Por proveedor" : "Documentos"}
            extra={<div className="flex flex-wrap items-center gap-2">
              {vista === "documento" ? (
                <>
                  {tramo ? <button type="button" onClick={() => setTramo(null)} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 max-sm:min-h-11 max-sm:px-3 max-sm:text-[13px]">{TRAMOS.find((x) => x.key === tramo)?.label} ✕</button> : null}
                  {d.por_moneda.USD ? <Segmentos valor={moneda} onChange={setMoneda} opciones={[["", "Todas"], ["GS", "Gs."], ["USD", "USD"]]} /> : null}
                </>
              ) : null}
              <Segmentos valor={vista} onChange={setVista} opciones={[["proveedor", "Por proveedor"], ["documento", "Por documento"]]} />
            </div>}>
            {vista === "proveedor" ? (
              <Tabla minW={900} vacio="No hay cuentas por pagar."
                cols={["Proveedor", "Docs.", "Saldo", "Vencido", ...TRAMOS.slice(1).map((x) => x.label), "Próx. vencimiento"]}
                der={[1, 2, 3, 4, 5, 6, 7]}
                onFila={(id) => filtros.cambiar({ proveedor: id })}
                filas={d.por_proveedor.map((p) => ({
                  key: p.id, titulo: "Ver solo este proveedor",
                  celdas: [<span key="n" className="font-medium">{p.nombre}</span>, p.cuentas, <b key="s">{gs(p.saldo_gs)}</b>,
                    Number(p.vencido_gs) ? <span key="v" className="font-semibold text-rose-600">{gs(p.vencido_gs)}</span> : "—",
                    ...TRAMOS.slice(1).map((x) => (Number(p[x.key]) ? gs(p[x.key]) : "—")),
                    p.proximo_vencimiento ? fechaCorta(p.proximo_vencimiento) : "—"],
                }))}
                pie={["Total", num(d.rows.length), gs(t.total), gs(t.vencido), ...TRAMOS.slice(1).map((x) => gs(t[x.key])), ""]} />
            ) : (
              <Tabla minW={960} vacio="No hay documentos con este filtro."
                cols={["Proveedor", "Documento", "Origen", "Emisión", "Vencimiento", "Atraso", "Monto", "Pagado", "Saldo"]}
                der={[5, 6, 7, 8]}
                filas={docs.map((r) => ({
                  key: r.id,
                  celdas: [
                    <span key="p" className="block max-w-[220px] truncate">{r.proveedor_nombre}</span>,
                    <Link key="d" href={r.origen === "compra" ? `/compras?ver=${r.doc_id}` : `/gastos-empresariales/operativos?ver=${r.doc_id}`} className="font-mono text-xs text-[var(--brand)] hover:underline max-sm:-my-2 max-sm:inline-flex max-sm:min-h-11 max-sm:items-center">
                      {r.documento}{r.factura ? <span className="ml-1 font-sans text-slate-400">· {r.factura}</span> : null}
                    </Link>,
                    r.origen === "compra" ? "Compra" : <span key="o" title={r.descripcion}>Gasto</span>,
                    fechaCorta(r.fecha_emision), fechaCorta(r.vencimiento),
                    r.dias_atraso ? <span key="a" className="font-semibold text-rose-600">{r.dias_atraso} días</span> : <span key="a" className="text-emerald-600">vence en {r.dias_para_vencer} d</span>,
                    r.moneda === "USD" ? usd(r.monto) : gs(r.monto), r.moneda === "USD" ? usd(r.pagado) : gs(r.pagado),
                    <b key="s">{r.moneda === "USD" ? usd(r.saldo) : gs(r.saldo)}</b>,
                  ],
                }))}
                pie={["Total en Gs.", num(docs.length), "", "", "", "", "", "", gs(docs.reduce((a, r) => a + Number(r.saldo_gs), 0))]} />
            )}
            <div className="mt-3"><Nota>Incluye compras de mercadería y gastos operativos a crédito con saldo. Saldos al día de hoy; el filtro de fechas toma la fecha de emisión.</Nota></div>
          </Tarjeta>
        </>
      )}
    </div>
  );
}
