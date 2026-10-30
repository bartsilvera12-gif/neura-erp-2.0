"use client";

/**
 * /reportes/cuentas-cobrar — Quién te debe y desde cuándo: saldos abiertos por cliente y
 * vencimiento, antigüedad (al día, 1–30, 31–60, 61–90, +90), origen (venta a crédito, cuota de
 * suscripción, factura al contado), calendario de cobros y las transferencias informadas que
 * esperan aprobación en Conciliación. Cuadra con Cuentas a cobrar (listar_cuentas_cobrar).
 * (Reemplaza al viejo reporte "Deudores".)
 */
import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { BarraTramos, BarrasH, Columnas, Dona, C_TRAMOS, SERIES } from "@/components/graficos/Graficos";
import { corto, fechaCorta, gs, num } from "@/components/graficos/formato";
import { Descargas, EncabezadoReporte, EstadoCarga, FilaKpis, FiltrosReporte, Kpi, Nota, Segmentos, Tabla, Tarjeta, useFiltrosReporte, useReporte, type Atajo } from "@/modules/reportes/ui";
import { ORIGEN_CXC, TRAMOS, type CuentasCobrar, type Tramos } from "@/modules/reportes/tipos";

const ATAJOS: Atajo[] = ["todo", "mes", "3m", "anio"];
const C_ORIGEN: Record<string, string> = { credito: SERIES[0], suscripcion: SERIES[2], factura_contado: SERIES[3] };
const semana = (i: number, desde: string) => (i === 0 ? "Esta semana" : i === 1 ? "Próxima" : fechaCorta(desde).slice(0, 5));

export default function Page() {
  return <Suspense fallback={null}><CuentasPorCobrar /></Suspense>;
}

function CuentasPorCobrar() {
  const filtros = useFiltrosReporte("todo");
  const { data: d, error, cargando } = useReporte<CuentasCobrar>(`/api/reportes/cuentas-cobrar?${filtros.query}`);
  const [vista, setVista] = useState<"cliente" | "documento" | "aprobacion">("cliente");
  const [tramo, setTramo] = useState<keyof Tramos | null>(null);
  const [origen, setOrigen] = useState<string | null>(null);
  const t = d?.tramos;
  const docs = useMemo(() => (d?.rows ?? []).filter((r) => (!tramo || r.tramo === tramo) && (!origen || r.origen === origen)), [d, tramo, origen]);

  return (
    <div className="space-y-6 pb-10">
      <EncabezadoReporte kicker="Reportes · Finanzas" titulo="Cuentas por cobrar"
        subtitulo={<>Quién te debe, cuánto y desde cuándo. Para registrar un cobro, andá a <Link href="/clientes/cobrar?desde=reportes" className="font-semibold text-[var(--brand)] hover:underline">Cuentas a cobrar</Link>.</>}>
        <Descargas excel={`/api/reportes/cuentas-cobrar/export?${filtros.query}`} pdf={`/api/reportes/cuentas-cobrar/pdf?${filtros.query}`} deshabilitado={!d?.rows.length} />
      </EncabezadoReporte>

      <FiltrosReporte filtros={filtros} atajos={ATAJOS} etiquetaFechas="Emitidas:" sucursales={d?.sucursales} cargando={cargando && !!d} />

      {!d || !t ? <EstadoCarga error={error} /> : (
        <>
          <FilaKpis n={5}>
            <Kpi acento label="Total a cobrar" valor={gs(t.total)} hint={`${num(t.clientes)} clientes · ${num(t.cuentas)} cuentas`} />
            <Kpi label="Vencido" valor={gs(t.vencido)} tono={Number(t.vencido) ? "malo" : "bueno"}
              hint={Number(t.total) ? `${Math.round((Number(t.vencido) / Number(t.total)) * 100)} % del total` : "nada vencido"}
              onClick={() => { setVista("documento"); setTramo(null); }} />
            <Kpi label="Vence en 7 días" valor={gs(t.vence_7)} tono={Number(t.vence_7) ? "alerta" : undefined} hint="para avisar a tiempo" />
            <Kpi label="En aprobación" valor={gs(t.en_aprobacion)} tono={Number(t.en_aprobacion) ? "alerta" : undefined}
              hint={`${d.en_aprobacion.length} transferencia${d.en_aprobacion.length === 1 ? "" : "s"} en Conciliación`} onClick={() => setVista("aprobacion")} />
            <Kpi label="Atraso máximo" valor={`${num(Math.max(0, ...d.rows.map((r) => r.dias_atraso)))} días`} hint={d.por_cliente.find((c) => c.max_atraso === Math.max(...d.rows.map((r) => r.dias_atraso)))?.nombre ?? "—"} />
          </FilaKpis>

          <Tarjeta titulo="Antigüedad" sub="tocá un tramo para ver esos documentos">
            <BarraTramos activo={tramo} onClick={(k) => { setTramo((x) => (x === k ? null : (k as keyof Tramos))); setVista("documento"); }}
              tramos={TRAMOS.map((x, i) => ({ key: x.key, label: x.label, valor: Number(t[x.key]), color: C_TRAMOS[i] }))} />
          </Tarjeta>

          <div className="grid gap-6 xl:grid-cols-3">
            <Tarjeta titulo="Quién te debe más" sub="saldo por cliente, por antigüedad" className="xl:col-span-2">
              <BarrasH max={8} fmtTip={gs} vacio="Nadie te debe"
                filas={d.por_cliente.map((c) => ({
                  key: c.id, label: c.nombre,
                  partes: TRAMOS.map((x, i) => ({ valor: Number(c[x.key]), color: C_TRAMOS[i], label: x.label })),
                  detalle: `${c.cuentas} cuenta${c.cuentas === 1 ? "" : "s"}${c.max_atraso ? ` · ${c.max_atraso} días de atraso` : ""}${c.ultimo_cobro ? ` · último cobro ${fechaCorta(c.ultimo_cobro.slice(0, 10))}` : ""}`,
                  href: `/clientes/${c.id}`,
                }))} />
            </Tarjeta>
            <Tarjeta titulo="De dónde viene" sub="tocá para filtrar">
              <Dona centro={corto(Number(t.total))} sub="a cobrar" onClick={(k) => { setOrigen((x) => (x === k ? null : k)); setVista("documento"); }}
                partes={d.por_origen.map((o) => ({ key: o.origen, label: ORIGEN_CXC[o.origen] ?? o.origen, valor: Number(o.saldo), color: C_ORIGEN[o.origen] ?? SERIES[4] }))} />
            </Tarjeta>
          </div>

          <Tarjeta titulo="Calendario de cobros" sub="lo que vence en cada una de las próximas 8 semanas (sin lo ya vencido)">
            <Columnas ariaLabel="Vencimientos a cobrar por semana" alto={190} vacio="No vence nada en las próximas semanas"
              series={[{ label: "Vence", color: SERIES[0] }]}
              datos={d.calendario.map((c) => ({ x: c.desde, valores: [Number(c.saldo)] }))}
              etiquetaX={(x, i) => semana(i, x)}
              tituloTooltip={(x) => { const c = d.calendario.find((y) => y.desde === x)!; return `${fechaCorta(c.desde).slice(0, 5)} al ${fechaCorta(c.hasta).slice(0, 5)}`; }} />
          </Tarjeta>

          <Tarjeta titulo={{ cliente: "Por cliente", documento: "Documentos", aprobacion: "En aprobación (Conciliación)" }[vista]}
            extra={<div className="flex flex-wrap items-center gap-2">
              {vista === "documento" && tramo ? <button type="button" onClick={() => setTramo(null)} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 max-sm:min-h-11 max-sm:px-3 max-sm:text-[13px]">{TRAMOS.find((x) => x.key === tramo)?.label} ✕</button> : null}
              {vista === "documento" && origen ? <button type="button" onClick={() => setOrigen(null)} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 max-sm:min-h-11 max-sm:px-3 max-sm:text-[13px]">{ORIGEN_CXC[origen]} ✕</button> : null}
              <Segmentos valor={vista} onChange={setVista} opciones={[["cliente", "Por cliente"], ["documento", "Por documento"], ["aprobacion", `En aprobación (${d.en_aprobacion.length})`]]} />
            </div>}>
            {vista === "cliente" ? (
              <Tabla minW={900} vacio="Nadie te debe."
                cols={["Cliente", "Cuentas", "Saldo", "Vencido", ...TRAMOS.slice(1).map((x) => x.label), "En aprobación", "Último cobro"]}
                der={[1, 2, 3, 4, 5, 6, 7, 8]}
                filas={d.por_cliente.map((c) => ({
                  key: c.id,
                  celdas: [<Link key="n" href={`/clientes/${c.id}`} className="font-medium hover:text-[var(--brand)] hover:underline max-sm:-my-2 max-sm:flex max-sm:min-h-11 max-sm:items-center">{c.nombre}</Link>, c.cuentas, <b key="s">{gs(c.saldo)}</b>,
                    Number(c.vencido) ? <span key="v" className="font-semibold text-rose-600">{gs(c.vencido)}</span> : "—",
                    ...TRAMOS.slice(1).map((x) => (Number(c[x.key]) ? gs(c[x.key]) : "—")),
                    Number(c.en_aprobacion) ? <span key="a" className="text-amber-600">{gs(c.en_aprobacion)}</span> : "—",
                    c.ultimo_cobro ? fechaCorta(c.ultimo_cobro.slice(0, 10)) : "—"],
                }))}
                pie={["Total", num(t.cuentas), gs(t.total), gs(t.vencido), ...TRAMOS.slice(1).map((x) => gs(t[x.key])), gs(t.en_aprobacion), ""]} />
            ) : vista === "documento" ? (
              <Tabla minW={960} vacio="No hay documentos con este filtro."
                cols={["Cliente", "Documento", "Origen", "Sucursal", "Emisión", "Vencimiento", "Atraso", "Monto", "Cobrado", "Saldo"]}
                der={[6, 7, 8, 9]}
                filas={docs.map((r) => ({
                  key: r.id,
                  celdas: [<span key="c" className="block max-w-[200px] truncate">{r.cliente_nombre}</span>, <span key="d" className="font-mono text-xs">{r.documento}</span>,
                    ORIGEN_CXC[r.origen], r.sucursal_nombre ?? "—", fechaCorta(r.fecha_emision), fechaCorta(r.vencimiento),
                    r.dias_atraso ? <span key="a" className="font-semibold text-rose-600">{r.dias_atraso} días</span> : <span key="a" className="text-emerald-600">vence en {r.dias_para_vencer} d</span>,
                    gs(r.monto), gs(r.cobrado),
                    <b key="s">{gs(r.saldo)}{Number(r.en_aprobacion) ? <span className="block text-[10px] font-medium text-amber-600">{gs(r.en_aprobacion)} en aprobación</span> : null}</b>],
                }))}
                pie={["Total", num(docs.length), "", "", "", "", "", "", "", gs(docs.reduce((a, r) => a + Number(r.saldo), 0))]} />
            ) : (
              <Tabla vacio="No hay transferencias esperando aprobación."
                cols={["Fecha", "Cliente", "Documento", "Banco", "Operación", "Cargó", "Monto"]} der={[6]}
                filas={d.en_aprobacion.map((x) => ({ key: x.id, celdas: [fechaCorta(x.fecha), x.cliente_nombre, x.documento, x.banco ?? "—", x.operacion ?? "—", x.creado_por ?? "—", <b key="m">{gs(x.monto)}</b>] }))} />
            )}
            <div className="mt-3"><Nota>Incluye ventas a crédito, cuotas de suscripción y facturas al contado todavía no cobradas. Saldos al día de hoy; el filtro de fechas toma la fecha de emisión. Las transferencias en aprobación todavía no descuentan del saldo.</Nota></div>
          </Tarjeta>
        </>
      )}
    </div>
  );
}
