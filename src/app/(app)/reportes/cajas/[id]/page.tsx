"use client";

/**
 * /reportes/cajas/<YYYY-MM-DD> — Cierre de caja de un día: todos los turnos de todas las cajas
 * y sucursales que se abrieron ese día, con todos sus datos (apertura, ventas contado y
 * crédito, formas de pago, cobros, egresos, retiros e ingresos, arqueo esperado vs declarado,
 * diferencias y motivos, anulaciones). PDF del día y de cada turno.
 * /reportes/cajas/<id de turno> (enlaces viejos) → redirige al día de ese turno y lo abre.
 */
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Download, Info, ListChecks } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { hoyPY } from "@/lib/fecha/paraguay";
import { BarrasH, colorMetodo } from "@/components/graficos/Graficos";
import { diaLargo, mayuscula, gs, horaPY, num, pct } from "@/components/graficos/formato";
import { TurnoModal } from "@/modules/caja/TurnoModal";
import type { ResumenTurno } from "@/modules/caja/turno";
import { Descargas, EncabezadoReporte, EstadoCarga, FiltrosReporte, Kpi, Tabla, Tarjeta, useFiltrosReporte, useReporte } from "@/modules/reportes/ui";
import type { CierreDiaDetalle } from "@/modules/reportes/tipos";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const masDias = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const conSigno = (n: number | null | undefined) => {
  const v = Number(n) || 0;
  return v === 0 ? "0" : `${v > 0 ? "+" : "−"} ${gs(Math.abs(v))}`;
};

export default function Page() {
  return <Suspense fallback={null}><Contenido /></Suspense>;
}

function Contenido() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  // Enlace viejo con el id de un turno → al día de ese turno, con el turno abierto.
  useEffect(() => {
    if (!UUID.test(id)) return;
    apiFetch<ResumenTurno>(`/api/caja/turnos/${id}`)
      .then((r) => router.replace(`/reportes/cajas/${new Date(r.caja.fecha_apertura).toLocaleDateString("en-CA", { timeZone: "America/Asuncion" })}?turno=${id}`))
      .catch((e) => setError((e as Error).message));
  }, [id, router]);

  if (FECHA.test(id)) return <DiaCaja fecha={id} />;
  return <div className="pb-10"><EstadoCarga error={error ?? (UUID.test(id) ? null : "Fecha inválida")} /></div>;
}

function DiaCaja({ fecha }: { fecha: string }) {
  const filtros = useFiltrosReporte("hoy", ["turno"]);
  const { f, extra, cambiar } = filtros;
  const q = new URLSearchParams({ fecha });
  if (f.sucursal) q.set("sucursal", f.sucursal);
  const { data: d, error, cargando, recargar } = useReporte<CierreDiaDetalle>(`/api/reportes/cajas/dia?${q}`);
  const verTurno = extra.turno || null;
  const hoy = hoyPY();
  const sufijo = f.sucursal ? `?sucursal=${f.sucursal}` : "";

  const t = d?.totales;
  const sumaMetodos = (d?.ventas_por_metodo ?? []).reduce((a, m) => a + Number(m.total), 0);
  const cuadra = t ? Math.round(sumaMetodos) === Math.round(Number(t.total_vendido)) : true;

  return (
    <div className="space-y-6 pb-10">
      <EncabezadoReporte kicker="Reportes · Cierre de caja" volver={{ href: `/reportes/cajas${sufijo}`, label: "Cierre de caja por día" }}
        titulo={mayuscula(diaLargo(fecha))}
        subtitulo="Todos los turnos que se abrieron este día, en todas las cajas.">
        <div className="flex items-center gap-1">
          <Link href={`/reportes/cajas/${masDias(fecha, -1)}${sufijo}`} aria-label="Día anterior" className="flex h-[38px] w-[38px] items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"><ChevronLeft className="h-4 w-4" /></Link>
          {fecha < hoy ? (
            <Link href={`/reportes/cajas/${masDias(fecha, 1)}${sufijo}`} aria-label="Día siguiente" className="flex h-[38px] w-[38px] items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"><ChevronRight className="h-4 w-4" /></Link>
          ) : null}
        </div>
        <Descargas pdf={`/api/reportes/cajas/dia/pdf?${q}`} deshabilitado={!d?.detalle.length} />
      </EncabezadoReporte>

      <FiltrosReporte filtros={filtros} sinFechas sucursales={d?.sucursales} cargando={cargando && !!d} />

      <p className="flex items-start gap-2 rounded-xl border border-sky-100 bg-sky-50 px-4 py-2.5 text-xs text-sky-800">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Cada turno cuenta para el día en que se abrió: si una caja cerró pasada la medianoche, todo el turno figura en el día de apertura (así el arqueo nunca queda partido en dos días).
      </p>

      {!d || !t ? <EstadoCarga error={error} /> : d.detalle.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-400 shadow-sm">Ese día no se abrió ninguna caja{f.sucursal ? " en esta sucursal" : ""}.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi acento label="Total vendido" valor={gs(t.total_vendido)} hint={`${num(t.cantidad_ventas)} ventas · ${t.turnos} turno${t.turnos === 1 ? "" : "s"}${t.abiertos ? ` (${t.abiertos} abierto${t.abiertos === 1 ? "" : "s"})` : ""}`} />
            <Kpi label="Contado" valor={gs(t.ventas_contado)} hint={`Crédito ${gs(t.ventas_credito)}`} />
            <Kpi label="Cobros de cuentas" valor={gs(t.cobros)} hint="entraron a las cajas" />
            <Kpi label="Egresos y retiros" valor={gs(Number(t.egresos) + Number(t.retiros))} hint={`Retiros ${gs(t.retiros)} · ingresos ${gs(t.ingresos)}`} />
            <Kpi label="Diferencias" valor={Number(t.diferencia) + Number(t.diferencia_otros) === 0 ? "Cuadró" : conSigno(Number(t.diferencia) + Number(t.diferencia_otros))}
              tono={Number(t.diferencia) + Number(t.diferencia_otros) === 0 ? "bueno" : Number(t.diferencia) + Number(t.diferencia_otros) < 0 ? "malo" : "alerta"}
              hint={`Efectivo ${conSigno(t.diferencia)} · otros ${conSigno(t.diferencia_otros)}`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Tarjeta titulo="Ventas por forma de pago" sub="contado por cada forma de pago + ventas a crédito"
              extra={<span className={`inline-flex items-center gap-1 text-xs font-semibold ${cuadra ? "text-emerald-600" : "text-rose-600"}`}>
                {cuadra ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                {cuadra ? "Cuadra con el total vendido" : `No cuadra: ${gs(sumaMetodos)} vs ${gs(t.total_vendido)}`}
              </span>}>
              <BarrasH fmt={gs} filas={d.ventas_por_metodo.map((m) => ({
                key: m.metodo, label: m.label, extra: pct(m.total, sumaMetodos, 0),
                partes: [{ valor: Number(m.total), color: colorMetodo(m.metodo), label: m.label }],
                detalle: `${num(m.cantidad)} cobro${m.cantidad === 1 ? "" : "s"}`,
              }))} />
            </Tarjeta>
            <Tarjeta titulo={d.por_sucursal.length > 1 ? "Por sucursal" : "Arqueo del día"} sub="efectivo esperado y diferencias">
              {d.por_sucursal.length > 1 ? (
                <Tabla cols={["Sucursal", "Turnos", "Total", "Ef. esperado", "Diferencia"]} der={[1, 2, 3, 4]}
                  filas={d.por_sucursal.map((s) => ({ key: s.sucursal_id, celdas: [s.sucursal_nombre, s.turnos, gs(s.total_vendido), gs(s.efectivo_esperado),
                    <span key="d" className={Number(s.diferencia) === 0 ? "text-emerald-600" : "font-semibold text-rose-600"}>{conSigno(s.diferencia)}</span>] }))} />
              ) : (
                <Tabla cols={["Forma de pago", "Ingresos", "Egresos", "Esperado"]} der={[1, 2, 3]}
                  filas={d.metodos.map((m) => ({ key: m.metodo, celdas: [m.label, gs(m.ingresos), gs(m.egresos), <b key="e">{gs(m.esperado)}</b>] }))} />
              )}
            </Tarjeta>
          </div>

          <div className="space-y-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Turnos ({d.detalle.length})</h2>
            {d.detalle.map((r) => (
              <TurnoCard key={r.caja.id} r={r} fecha={fecha} onVer={() => cambiar({ turno: r.caja.id })} />
            ))}
          </div>
        </>
      )}

      {verTurno ? <TurnoModal turnoId={verTurno} onClose={() => cambiar({ turno: null })} onCambio={recargar} /> : null}
    </div>
  );
}

function TurnoCard({ r, fecha, onVer }: { r: ResumenTurno; fecha: string; onVer: () => void }) {
  const c = r.caja;
  const abierta = c.estado !== "cerrada";
  const e = r.efectivo;
  const difTotal = (Number(c.diferencia) || 0) + (Number(c.diferencia_otros) || 0);
  const cruzaDia = c.fecha_cierre && new Date(c.fecha_cierre).toLocaleDateString("en-CA", { timeZone: "America/Asuncion" }) !== fecha;
  const [bajando, setBajando] = useState(false);
  const pdf = async () => {
    setBajando(true);
    try { await descargarArchivo(`/api/caja/turnos/${c.id}/pdf`, `cierre-caja-${c.numero_caja}.pdf`); } finally { setBajando(false); }
  };
  const efectivo: [string, number][] = [
    ["Monto inicial", e.apertura], ["Ventas en efectivo", e.ventas], ["Cobros", e.cobros], ["Ingresos", e.ingresos],
    ["Retiros", -e.retiros], ["Compras", -e.compras], ["Gastos", -e.gastos], ["Pagos a proveedores", -e.pagos_proveedores],
    ["Devoluciones", -e.devoluciones], ["Egresos", -e.egresos_manuales],
  ];

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
            {c.punto_nombre} · {c.sucursal_nombre}
            <span className="text-xs font-medium text-slate-400">Turno N° {c.numero_caja}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${abierta ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{abierta ? "Abierta" : "Cerrada"}</span>
            {difTotal !== 0 && !abierta ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-600">Con diferencia</span> : null}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Abrió {c.abierta_por_nombre ?? "—"} a las {horaPY(c.fecha_apertura)} · {c.fecha_cierre ? <>cerró {c.cerrada_por_nombre ?? "—"} a las {horaPY(c.fecha_cierre)}{cruzaDia ? " (del día siguiente)" : ""}</> : "sigue abierta"} · sale de {c.deposito_nombre}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onVer} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-[var(--brand)] hover:text-[var(--brand)]">
            <ListChecks className="h-3.5 w-3.5" /> Movimientos y ventas
          </button>
          <button type="button" onClick={pdf} disabled={bajando} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:opacity-50">
            <Download className="h-3.5 w-3.5" /> {abierta ? "Arqueo parcial" : "PDF del turno"}
          </button>
        </div>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Dato l="Total vendido" v={gs(r.ventas.total)} sub={`${num(r.ventas.cantidad)} ventas`} fuerte />
            <Dato l="Contado" v={gs(r.ventas.contado.total)} sub={`${num(r.ventas.contado.cantidad)} ventas`} />
            <Dato l="Crédito" v={gs(r.ventas.credito.total)} sub={`${num(r.ventas.credito.cantidad)} ventas`} />
            <Dato l="Anuladas" v={num(r.ventas.anuladas.cantidad)} sub={gs(r.ventas.anuladas.total)} alerta={r.ventas.anuladas.cantidad > 0} />
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Arqueo por forma de pago</p>
            <Tabla cols={["Forma de pago", "Ingresos", "Egresos", "Esperado", "Declarado", "Diferencia"]} der={[1, 2, 3, 4, 5]}
              filas={r.metodos.map((m) => ({
                key: m.metodo,
                celdas: [m.label, gs(m.ingresos), gs(m.egresos), <b key="e">{gs(m.esperado)}</b>,
                  m.declarado == null ? <span key="d" className="text-slate-300">—</span> : gs(m.declarado),
                  m.diferencia == null ? <span key="x" className="text-slate-300">—</span>
                    : <span key="x" className={m.diferencia === 0 ? "text-emerald-600" : m.diferencia < 0 ? "font-semibold text-rose-600" : "font-semibold text-amber-600"}>{m.diferencia === 0 ? "0" : conSigno(m.diferencia)}</span>],
              }))} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Dato l="Cobros" v={gs(r.cobros.total)} sub={`${num(r.cobros.cantidad)} recibos`} />
            <Dato l="Egresos" v={gs(r.egresos.total)} sub={[r.egresos.compras.cantidad ? `${r.egresos.compras.cantidad} compras` : "", r.egresos.gastos.cantidad ? `${r.egresos.gastos.cantidad} gastos` : "", r.egresos.pagos_proveedores.cantidad ? `${r.egresos.pagos_proveedores.cantidad} pagos` : "", r.egresos.devoluciones.cantidad ? `${r.egresos.devoluciones.cantidad} devol.` : ""].filter(Boolean).join(" · ") || "—"} />
            <Dato l="Retiros" v={gs(r.manuales.retiros.total)} sub={`${num(r.manuales.retiros.cantidad)} retiros`} />
            <Dato l="Ingresos" v={gs(r.manuales.ingresos.total)} sub={`${num(r.manuales.ingresos.cantidad)} ingresos`} />
          </div>
        </div>

        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Efectivo en caja</p>
          <ul className="space-y-1 text-sm">
            {efectivo.filter(([l, v]) => v !== 0 || l === "Monto inicial").map(([l, v]) => (
              <li key={l} className="flex justify-between gap-3 text-slate-600"><span>{l}</span><span className="tabular-nums">{l === "Monto inicial" ? gs(v) : conSigno(v)}</span></li>
            ))}
            <li className="flex justify-between gap-3 border-t border-slate-200 pt-1.5 font-semibold text-slate-800"><span>Esperado</span><span className="tabular-nums">{gs(e.esperado)}</span></li>
            <li className="flex justify-between gap-3 text-slate-600"><span>Contado al cierre</span><span className="tabular-nums">{e.contado == null ? "—" : gs(e.contado)}</span></li>
            <li className={`flex justify-between gap-3 font-semibold ${e.diferencia == null ? "text-slate-400" : e.diferencia === 0 ? "text-emerald-700" : e.diferencia < 0 ? "text-rose-600" : "text-amber-600"}`}>
              <span>Diferencia</span><span className="tabular-nums">{e.diferencia == null ? "—" : e.diferencia === 0 ? "Cuadró" : conSigno(e.diferencia)}</span>
            </li>
          </ul>
          {c.motivo_diferencia ? <p className="mt-3 rounded-xl bg-white px-3 py-2 text-xs text-slate-600"><b className="text-slate-700">Motivo:</b> {c.motivo_diferencia}</p> : null}
          {c.observacion_apertura ? <p className="mt-2 text-xs text-slate-500"><b>Apertura:</b> {c.observacion_apertura}</p> : null}
          {c.observacion_cierre ? <p className="mt-1 text-xs text-slate-500"><b>Cierre:</b> {c.observacion_cierre}</p> : null}
        </div>
      </div>
    </section>
  );
}

function Dato({ l, v, sub, fuerte, alerta }: { l: string; v: string; sub?: string; fuerte?: boolean; alerta?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-100 px-3 py-2">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{l}</p>
      <p className={`mt-0.5 truncate text-sm font-semibold tabular-nums ${alerta ? "text-rose-600" : fuerte ? "text-[var(--brand)]" : "text-slate-800"}`}>{v}</p>
      {sub ? <p className="truncate text-[11px] text-slate-400">{sub}</p> : null}
    </div>
  );
}
