"use client";

/**
 * Inicio (dashboard): cómo vienen las ventas y el inventario, de un vistazo y todo
 * clickeable hacia su reporte. Una sola consulta (dashboard_inicio, receta 54).
 *   · Ventas de hoy / semana / mes y ticket, contra el período anterior "a la misma altura"
 *     (hoy hasta esta hora vs el mismo día de la semana pasada hasta la misma hora, etc.).
 *   · Ventas por día de los últimos 30 días (por sucursal) con la marca de los 30 anteriores.
 *   · Productos más vendidos y medios de pago del mes, ventas por sucursal.
 *   · Inventario: valor del stock al costo, bajo mínimo, lotes vencidos / por vencer,
 *     traslados en tránsito, pérdidas del mes.
 * ADMIN ve todo y puede filtrar por sucursal; el resto ve su sucursal, sin costos ni márgenes.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Boxes, CalendarClock, PackageMinus, PackageX, Truck, Wallet } from "lucide-react";
import { clienteConfig } from "@/cliente.config";
import { tienePermiso, useUsuario } from "@/lib/sesion/ContextoUsuario";
import { Select } from "@/components/Select";
import { BarrasH, Columnas, Dona, Leyenda, SERIES, C_ANTERIOR, colorMetodo } from "@/components/graficos/Graficos";
import { corto, diaLargo, mayuscula, diaSemana, gs, num, pct, variacion } from "@/components/graficos/formato";
import { Kpi, Tarjeta, useReporte } from "@/modules/reportes/ui";
import type { Dashboard } from "@/modules/reportes/tipos";

export default function Inicio() {
  const router = useRouter();
  const me = useUsuario();
  const [sucursal, setSucursal] = useState("");
  const { data: d, error, cargando } = useReporte<Dashboard>(`/api/dashboard${sucursal ? `?sucursal=${sucursal}` : ""}`);

  const esAdmin = !!d?.es_admin;
  const veCierres = tienePermiso(me, "ver_cierres_caja") || tienePermiso(me, "ver_reportes_financieros");
  const veReportes = tienePermiso(me, "ver_reportes_financieros");
  const hora = new Date().getHours();
  const saludo = hora < 12 ? "Buen día" : hora < 19 ? "Buenas tardes" : "Buenas noches";

  // Series del gráfico: por sucursal cuando se ven todas (y hay más de una); si no, una sola.
  const porSucursal = esAdmin && !d?.sucursal_id && (d?.sucursales.length ?? 0) > 1;
  const series = useMemo(() => (porSucursal && d
    ? d.sucursales.map((s, i) => ({ id: s.id, label: s.nombre, color: SERIES[i % SERIES.length] }))
    : [{ id: "", label: "Ventas", color: SERIES[0] }]), [porSucursal, d]);
  const datos = useMemo(() => (d?.por_dia ?? []).map((x) => ({
    x: x.dia,
    valores: porSucursal ? series.map((s) => Number(x.por_sucursal[s.id] ?? 0)) : [Number(x.total)],
    anterior: Number(x.anterior),
    nota: `${num(x.cantidad)} venta${x.cantidad === 1 ? "" : "s"}${x.dia === d?.hoy ? " · hoy, todavía en curso" : ""}`,
  })), [d, porSucursal, series]);

  const k = d?.kpis;
  const ticket = k && k.mes.cantidad ? k.mes.total / k.mes.cantidad : 0;
  const ticketAnt = k && k.mes.anterior_cantidad ? k.mes.anterior / k.mes.anterior_cantidad : 0;
  const totalMedios = (d?.medios ?? []).reduce((a, m) => a + Number(m.total), 0);
  const inv = d?.inventario;
  const linkVentas = (desde: string, hasta: string) => (veReportes ? `/reportes/ventas?desde=${desde}&hasta=${hasta}` : undefined);
  const mesIni = d ? `${d.hoy.slice(0, 7)}-01` : "";

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{saludo}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Cómo viene <span className="font-medium text-slate-600">{clienteConfig.nombre}</span>
            {d ? <> · {mayuscula(diaLargo(d.hoy))}</> : null}
            {d && !esAdmin && d.sucursales[0] ? <> · {d.sucursales[0].nombre}</> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {cargando && d ? <span className="text-xs text-slate-400">Actualizando…</span> : null}
          {esAdmin && (d?.sucursales.length ?? 0) > 1 ? (
            <Select value={sucursal} onChange={setSucursal} minWidth={200}
              options={[["", "Todas las sucursales"], ...d!.sucursales.map((s): [string, string] => [s.id, s.nombre])]} />
          ) : null}
        </div>
      </header>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">No se pudo cargar el resumen: {error}</div> : null}

      {!d ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-[104px] animate-pulse rounded-2xl border border-slate-200 bg-white" />)}</div>
          <div className="h-80 animate-pulse rounded-2xl border border-slate-200 bg-white" />
        </div>
      ) : (
        <>
          {/* Números del momento */}
          <div className={`grid grid-cols-2 gap-3 ${esAdmin ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
            <Kpi acento label="Ventas de hoy" valor={gs(k!.hoy.total)} href={linkVentas(d.hoy, d.hoy)}
              delta={{ actual: k!.hoy.total, anterior: k!.hoy.anterior, texto: "vs. mismo día sem. pasada" }}
              hint={`${num(k!.hoy.cantidad)} venta${k!.hoy.cantidad === 1 ? "" : "s"}`} />
            <Kpi label="Esta semana" valor={gs(k!.semana.total)}
              delta={{ actual: k!.semana.total, anterior: k!.semana.anterior, texto: "vs. semana pasada" }}
              hint={`${num(k!.semana.cantidad)} ventas`} />
            <Kpi label="Este mes" valor={gs(k!.mes.total)} href={linkVentas(mesIni, d.hoy)}
              delta={{ actual: k!.mes.total, anterior: k!.mes.anterior, texto: "vs. mes pasado" }}
              hint={`${num(k!.mes.cantidad)} ventas`} />
            <Kpi label="Ticket promedio" valor={gs(ticket)}
              delta={ticketAnt ? { actual: ticket, anterior: ticketAnt, texto: "vs. mes pasado" } : null}
              hint="por venta, este mes" />
            {esAdmin && d.margen_mes ? (
              <Kpi label="Ganancia bruta del mes" valor={gs(d.margen_mes.ganancia)} href="/reportes/estado-cuenta"
                tono={d.margen_mes.ganancia < 0 ? "malo" : undefined}
                hint={`Margen ${pct(d.margen_mes.ganancia, d.margen_mes.ventas)} sobre ventas`} />
            ) : null}
          </div>

          {/* Ventas por día */}
          <Tarjeta titulo="Ventas por día · últimos 30 días"
            sub={<>Total {gs(k!.treinta.total)} · {variacion(k!.treinta.total, k!.treinta.anterior) != null
              ? <>{(variacion(k!.treinta.total, k!.treinta.anterior)! >= 0 ? "▲ " : "▼ ")}{Math.abs(variacion(k!.treinta.total, k!.treinta.anterior)!).toLocaleString("es-PY", { maximumFractionDigits: 1 })} % vs. los 30 días anteriores</>
              : "sin datos de los 30 días anteriores"}{veCierres ? " · tocá un día para ver su cierre de caja" : ""}</>}
            extra={<Leyenda items={[...(series.length > 1 ? series.map((s) => ({ color: s.color, label: s.label })) : [{ color: series[0].color, label: "Ventas del día" }]),
              { color: C_ANTERIOR, label: "Mismo día, 30 días antes", dashed: true }]} />}>
            <Columnas datos={datos} series={series} ariaLabel="Ventas por día de los últimos 30 días"
              etiquetaX={(x) => String(Number(x.slice(8, 10)))} tituloTooltip={(x) => diaSemana(x)}
              anteriorLabel="30 días antes" resaltar={d.hoy} alto={250}
              onClick={veCierres ? (x) => router.push(`/reportes/cajas/${x}`) : undefined} />
          </Tarjeta>

          <div className={`grid gap-6 ${porSucursal ? "xl:grid-cols-3" : "lg:grid-cols-2"}`}>
            <Tarjeta titulo="Lo más vendido del mes" sub="por monto vendido"
              extra={veReportes ? <Link href={`/reportes/productos-vendidos?desde=${mesIni}&hasta=${d.hoy}`} className="text-xs font-semibold text-[var(--brand)] hover:underline">Ver todo</Link> : null}>
              <BarrasH vacio="Todavía no hubo ventas este mes" max={8}
                filas={d.top_productos.map((p) => ({
                  key: p.producto_id ?? p.nombre,
                  label: p.nombre,
                  partes: [{ valor: Number(p.monto), color: SERIES[0], label: "Vendido" }],
                  detalle: `${num(p.unidades, 2)} unidades${p.ganancia != null ? ` · margen ${pct(p.ganancia, p.monto)}` : ""}`,
                  extra: `${num(p.unidades, 1)} u.`,
                }))} />
            </Tarjeta>
            <Tarjeta titulo="Cómo te pagan" sub="medios de pago del mes">
              <Dona centro={corto(totalMedios)} sub="este mes"
                partes={d.medios.map((m) => ({ label: m.label, valor: Number(m.total), color: colorMetodo(m.metodo) }))} />
            </Tarjeta>
            {porSucursal ? (
              <Tarjeta titulo="Ventas por sucursal" sub="este mes">
                <BarrasH vacio="Sin ventas este mes"
                  filas={d.por_sucursal.map((s) => ({
                    key: s.id, label: s.nombre, extra: pct(s.total, k!.mes.total, 0),
                    partes: [{ valor: Number(s.total), color: series.find((x) => x.id === s.id)?.color ?? SERIES[0], label: "Ventas" }],
                    detalle: `${num(s.cantidad)} ventas · ticket ${gs(s.cantidad ? s.total / s.cantidad : 0)}`,
                    onClick: () => setSucursal(s.id),
                  }))} />
              </Tarjeta>
            ) : null}
          </div>

          {/* Inventario */}
          {inv ? (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Inventario</h2>
                <Link href="/inventario" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)] hover:underline">Ir a Inventario <ArrowRight className="h-3.5 w-3.5" /></Link>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {esAdmin && inv.valor_stock != null ? (
                  <Mosaico Icon={Boxes} titulo="Stock valorizado al costo" valor={gs(inv.valor_stock)} href="/inventario"
                    detalle={(inv.por_sucursal ?? []).length > 1 ? (
                      <ul className="mt-2 space-y-1">
                        {inv.por_sucursal!.map((s) => (
                          <li key={s.id} className="flex justify-between gap-2 text-[11px] text-slate-500"><span className="truncate">{s.nombre}</span><b className="tabular-nums text-slate-700">{corto(s.valor)}</b></li>
                        ))}
                      </ul>
                    ) : null} />
                ) : null}
                <Mosaico Icon={PackageMinus} titulo="Bajo el stock mínimo" valor={num(inv.bajo_minimo)} tono={inv.bajo_minimo ? "alerta" : "ok"}
                  href={esAdmin ? "/reportes/stock-minimo" : "/inventario"}
                  detalle={<span className="text-[11px] text-slate-500">{inv.sin_stock ? `${num(inv.sin_stock)} sin stock` : "Ninguno agotado"}</span>} />
                <Mosaico Icon={CalendarClock} titulo="Lotes vencidos / por vencer" tono={inv.vencidos.lotes ? "malo" : inv.por_vencer.lotes ? "alerta" : "ok"}
                  valor={<>{num(inv.vencidos.lotes)} <span className="text-base font-medium text-slate-400">/</span> {num(inv.por_vencer.lotes)}</>}
                  href="/inventario/vencimientos"
                  detalle={<span className="text-[11px] text-slate-500">
                    {num(inv.vencidos.unidades)} u. vencidas{inv.vencidos.valor != null ? ` (${corto(inv.vencidos.valor)})` : ""} · {num(inv.por_vencer.unidades)} u. vencen en 30 días
                  </span>} />
                <Mosaico Icon={Truck} titulo="Traslados en tránsito" valor={num(inv.en_transito.cantidad)} tono={inv.en_transito.cantidad ? "alerta" : "ok"}
                  href="/inventario/traslados?estado=en_transito"
                  detalle={<span className="text-[11px] text-slate-500">{num(inv.en_transito.unidades)} unidades{inv.en_transito.valor != null ? ` · ${corto(inv.en_transito.valor)} al costo` : ""}</span>} />
                <Mosaico Icon={PackageX} titulo="Pérdidas del mes" tono={inv.perdidas_mes.documentos ? "malo" : "ok"}
                  valor={inv.perdidas_mes.valor != null ? gs(inv.perdidas_mes.valor) : `${num(inv.perdidas_mes.unidades)} u.`}
                  href={esAdmin ? "/reportes/perdidas" : "/inventario/ajustes"}
                  detalle={<span className="text-[11px] text-slate-500">
                    {num(inv.perdidas_mes.documentos)} baja{inv.perdidas_mes.documentos === 1 ? "" : "s"}
                    {inv.perdidas_pendientes ? <span className="ml-1 font-semibold text-amber-600">· {inv.perdidas_pendientes} por aprobar</span> : null}
                  </span>} />
              </div>
            </section>
          ) : null}

          <Link href="/caja/turnos" className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-sm shadow-sm transition hover:shadow-md">
            <span className="flex items-center gap-3 text-slate-600">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand-50)] text-[var(--brand)]"><Wallet className="h-4 w-4" /></span>
              {d.cajas_abiertas ? <><b className="text-slate-800">{d.cajas_abiertas}</b> caja{d.cajas_abiertas === 1 ? "" : "s"} abierta{d.cajas_abiertas === 1 ? "" : "s"} ahora</> : "No hay cajas abiertas"}
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]">Apertura y cierre <ArrowRight className="h-3.5 w-3.5" /></span>
          </Link>
        </>
      )}
    </div>
  );
}

function Mosaico({ Icon, titulo, valor, detalle, href, tono = "brand" }: {
  Icon: React.ComponentType<{ className?: string }>;
  titulo: string;
  valor: React.ReactNode;
  detalle?: React.ReactNode;
  href: string;
  tono?: "brand" | "ok" | "alerta" | "malo";
}) {
  const c = {
    brand: { bg: "var(--brand-50)", fg: "var(--brand)" },
    ok: { bg: "#ecfdf5", fg: "#059669" },
    alerta: { bg: "#fffbeb", fg: "#d97706" },
    malo: { bg: "#fff1f2", fg: "#e11d48" },
  }[tono];
  return (
    <Link href={href} className="group block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">{titulo}</span>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: c.bg, color: c.fg }}>
          {tono === "malo" ? <AlertTriangle className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
        </span>
      </div>
      <div className="mt-2 text-xl font-semibold tabular-nums text-slate-900">{valor}</div>
      {detalle}
    </Link>
  );
}
