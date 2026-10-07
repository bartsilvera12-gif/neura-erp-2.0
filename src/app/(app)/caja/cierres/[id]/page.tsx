"use client";

/**
 * /caja/cierres/[id] — Detalle de un turno de caja (portado de Ferretería República):
 * resumen del arqueo + línea de tiempo (apertura, ventas y movimientos manuales).
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowDownCircle, ArrowLeft, ArrowUpCircle, DoorOpen, Download, Loader2, ShoppingCart } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { abrirHtml } from "@/lib/api/client-blob";
import { clienteConfig } from "@/cliente.config";
import { formatGs } from "@/modules/caja/lib";
import { VentaDetalle } from "@/modules/caja/VentaDetalle";
import { estadoCajaLabel, medioLabel, type CajaDetalle } from "@/modules/caja/reporte-cajas";

const TEAL = clienteConfig.color;
const TZ = "America/Asuncion";
const dia = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
// Turno que cruza la medianoche → la hora sola no alcanza: se antepone dd/mm.
const horaTurno = (iso: string, conDia: boolean) =>
  new Date(iso)
    .toLocaleString("es-PY", { timeZone: TZ, ...(conDia ? { day: "2-digit", month: "2-digit" } : {}), hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .replace(",", "");
const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-PY", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

type Fila = {
  key: string;
  ts: string;
  icon: React.ReactNode;
  tipo: string;
  tipoClass: string;
  detalle: string;
  medio: string;
  monto: number;
  signo: 1 | -1;
  tachado?: boolean;
  ventaId?: string;
};

export default function DetalleTurnoPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [data, setData] = useState<CajaDetalle | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abriendo, setAbriendo] = useState(false);
  const [viendo, setViendo] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancel = false;
    setCargando(true);
    apiFetch<CajaDetalle>(`/api/reportes/cajas/${id}`)
      .then((d) => { if (!cancel) setData(d); })
      .catch((e: Error) => { if (!cancel) setError(e.message); })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [id, recarga]);

  async function descargarPdf() {
    setAbriendo(true);
    try { await abrirHtml(`/api/reportes/cajas/${id}/pdf?auto=1`); } catch { /* best-effort */ } finally { setAbriendo(false); }
  }

  const c = data?.caja;
  const conDia = c ? dia(c.fecha_apertura) !== dia(c.fecha_cierre ?? new Date().toISOString()) : false;

  // Línea de tiempo unificada: apertura + ventas + movimientos manuales.
  const filas: Fila[] = [];
  if (c && data) {
    filas.push({
      key: "apertura",
      ts: c.fecha_apertura,
      icon: <DoorOpen className="h-3.5 w-3.5" />,
      tipo: "Apertura",
      tipoClass: "bg-[var(--brand-50)] text-[var(--brand)]",
      detalle: c.abierta_por_nombre ? `Abrió ${c.abierta_por_nombre}` : "Apertura de caja",
      medio: "Efectivo",
      monto: c.monto_apertura,
      signo: 1,
    });
    for (const v of data.ventas) {
      const credito = v.tipo_venta === "CREDITO";
      filas.push({
        key: `v-${v.id}`,
        ts: v.fecha,
        icon: <ShoppingCart className="h-3.5 w-3.5" />,
        tipo: "Venta",
        tipoClass: credito ? "bg-orange-50 text-orange-600" : "bg-emerald-50 text-emerald-700",
        detalle: `${v.numero_control ?? "Venta"}${v.tipo_venta ? ` · ${credito ? "Crédito" : "Contado"}` : ""}`,
        medio: credito ? "Crédito" : v.medios.length ? v.medios.map(medioLabel).join(" + ") : medioLabel(v.metodo_pago),
        monto: v.total,
        signo: 1,
        tachado: v.estado === "anulada",
        ventaId: v.id,
      });
    }
    for (const m of data.movimientos) {
      const entrada = m.tipo === "ingreso" || (m.tipo === "ajuste" && m.monto >= 0);
      const tipo = m.tipo === "ingreso" ? "Ingreso" : m.tipo === "egreso" ? "Egreso" : m.tipo === "retiro" ? "Retiro" : "Ajuste";
      const autor = m.usuario_nombre || m.usuario_email;
      filas.push({
        key: `m-${m.id}`,
        ts: m.created_at,
        icon: entrada ? <ArrowDownCircle className="h-3.5 w-3.5" /> : <ArrowUpCircle className="h-3.5 w-3.5" />,
        tipo,
        tipoClass: entrada ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-700",
        detalle: [m.concepto, m.observacion, autor].filter(Boolean).join(" · "),
        medio: medioLabel(m.medio_pago),
        monto: Math.abs(m.monto),
        signo: entrada ? 1 : -1,
      });
    }
    filas.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  }

  const dif = c?.diferencia ?? null;
  const difClass = dif == null ? "text-slate-400" : dif === 0 ? "text-emerald-600" : dif < 0 ? "text-red-600" : "text-amber-600";

  return (
    <div className="space-y-6 pb-10">
      {/* Encabezado */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/caja/cierres" className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-800">
            <ArrowLeft className="h-3.5 w-3.5" /> Cierres de caja
          </Link>
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Caja · Reportes</p>
          </div>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">
            Detalle del turno
            {c ? (
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${c.estado === "cerrada" ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>
                Caja {c.numero_caja} · {estadoCajaLabel(c.estado)}
              </span>
            ) : null}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {c
              ? `${fechaHora(c.fecha_apertura)}${c.fecha_cierre ? ` → ${fechaHora(c.fecha_cierre)}` : " · en curso"}${c.cerrada_por_nombre ? ` · cerró ${c.cerrada_por_nombre}` : ""}`
              : "Arqueo del turno: ventas y movimientos."}
          </p>
        </div>
        {c ? (
          <button
            type="button"
            onClick={descargarPdf}
            disabled={abriendo}
            className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
            style={{ backgroundColor: TEAL }}
          >
            {abriendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Descargar PDF
          </button>
        ) : null}
      </div>

      {cargando ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-[78px] animate-pulse rounded-xl border border-slate-200 bg-white" />)}
        </div>
      ) : error || !c ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">{error ?? "Sin datos."}</div>
      ) : (
        <>
          {/* Resumen del arqueo */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
            <Resumen accent label="Vendido" value={formatGs(c.total_vendido)} hint={`${c.cantidad_ventas} venta(s)`} />
            <Resumen label="Efectivo" value={formatGs(c.total_efectivo)} />
            <Resumen label="Tarjeta" value={formatGs(c.total_tarjeta)} />
            <Resumen label="POS" value={formatGs(c.total_pos)} />
            <Resumen label="Transferencia" value={formatGs(c.total_transferencia)} hint={c.total_otros ? `+ ${formatGs(c.total_otros)} otros` : undefined} />
            <Resumen label="Crédito" value={formatGs(c.total_credito)} hint="no ingresa a caja" />
            <Resumen label="Efectivo esperado" value={formatGs(c.efectivo_esperado)} hint="apertura + efectivo ± movs" />
            <Resumen
              label="Contado / Diferencia"
              value={c.monto_cierre_contado == null ? "—" : formatGs(c.monto_cierre_contado)}
              hint={dif == null ? "turno abierto" : `${dif > 0 ? "+" : ""}${formatGs(dif)}`}
              hintClass={`font-semibold ${difClass}`}
            />
          </div>

          {/* Línea de tiempo */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="block h-5 w-1 rounded-full" style={{ backgroundColor: TEAL }} />
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">Movimientos del turno</h2>
              </div>
              <span className="text-sm text-slate-400">{filas.length} registro(s)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs font-semibold text-slate-500">
                    <th className="rounded-l-lg px-3 py-3">Hora</th>
                    <th className="px-3 py-3">Movimiento</th>
                    <th className="px-3 py-3">Detalle</th>
                    <th className="px-3 py-3">Método</th>
                    <th className="rounded-r-lg px-3 py-3 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((r) => (
                    <tr
                      key={r.key}
                      onClick={r.ventaId ? () => setViendo(r.ventaId!) : undefined}
                      title={r.ventaId ? "Ver el detalle de la venta" : undefined}
                      className={`border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50 ${r.ventaId ? "cursor-pointer" : ""}`}
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs tabular-nums text-slate-500">{horaTurno(r.ts, conDia)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.tipoClass}`}>
                          {r.icon}
                          {r.tipo}
                        </span>
                      </td>
                      <td className={`px-3 py-2.5 text-xs ${r.tachado ? "text-slate-400 line-through" : "text-slate-700"}`}>
                        {r.detalle}
                        {r.tachado && <span className="ml-1 text-[10px] font-semibold text-red-500 no-underline">(anulada)</span>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-500">{r.medio}</td>
                      <td className={`px-3 py-2.5 text-right text-xs font-semibold tabular-nums ${r.tachado ? "text-slate-400 line-through" : r.signo < 0 ? "text-red-600" : "text-emerald-600"}`}>
                        {r.signo < 0 ? "−" : "+"}
                        {formatGs(r.monto)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {c.observacion_apertura || c.observacion_cierre ? (
              <div className="mt-4 space-y-2">
                {c.observacion_apertura ? (
                  <p className="whitespace-pre-line rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <span className="font-semibold text-slate-700">Observación de apertura:</span> {c.observacion_apertura}
                  </p>
                ) : null}
                {c.observacion_cierre ? (
                  <p className="whitespace-pre-line rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <span className="font-semibold text-slate-700">Observación de cierre:</span> {c.observacion_cierre}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        </>
      )}

      {viendo ? <VentaDetalle ventaId={viendo} onClose={() => setViendo(null)} onAnulada={() => setRecarga((n) => n + 1)} /> : null}
    </div>
  );
}

function Resumen({ label, value, hint, hintClass, accent }: { label: string; value: string; hint?: string; hintClass?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border bg-white p-3 shadow-sm" style={accent ? { borderColor: `${TEAL}55`, backgroundColor: "var(--brand-50)" } : { borderColor: "#e2e8f0" }}>
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-800" style={accent ? { color: TEAL } : undefined}>{value}</p>
      {hint ? <p className={`mt-0.5 truncate text-[11px] tabular-nums ${hintClass ?? "text-slate-400"}`}>{hint}</p> : null}
    </div>
  );
}
