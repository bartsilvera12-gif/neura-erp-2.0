"use client";

/**
 * /clientes/suscripciones — cobros recurrentes de todos los clientes (cuotas, abonos…).
 * Arriba los números (activas, pausadas, ingreso mensual Gs./US$, por emitir en el mes);
 * selector de mes, buscador y filtro de estado; la tabla con la cuota de ese mes de cada
 * suscripción y su botón "Emitir". "Emitir cuotas del mes (N)" emite todas las que faltan,
 * siempre con confirmación (nunca se emite nada solo). Pestaña "Planes": alta y edición.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Loader2, Repeat, Search } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { VentaDetalle } from "@/modules/caja/VentaDetalle";
import { CodigoChip, TEAL, codigoCliente } from "@/modules/clientes/ui";
import type { FilaSuscripcion, KpisSuscripciones, ListadoSuscripciones, ResultadoEmitirMes } from "@/modules/clientes/suscripciones/tipos";
import { BadgeSuscripcion, mesActual, monto, nombreMes, sumarMes } from "@/modules/clientes/suscripciones/ui";
import { PanelPlanes } from "@/modules/clientes/suscripciones/PanelPlanes";

type Vista = "suscripciones" | "planes";

/** Precio que va a tener la cuota del mes (si hay un cambio de plan programado que ya rige, el nuevo). */
const precioDelMes = (r: FilaSuscripcion, periodo: string) =>
  r.pendiente_desde && r.precio_pendiente != null && r.pendiente_desde.slice(0, 7) <= periodo ? Number(r.precio_pendiente) : Number(r.precio);

export default function SuscripcionesPage() {
  const me = useUsuario();
  const esAdmin = me?.rol === "ADMIN";
  const puedeEmitir = me?.rol === "ADMIN" || me?.rol === "VENDEDOR";
  const [vista, setVista] = useState<Vista>("suscripciones");
  const [periodo, setPeriodo] = useState(mesActual());
  const [borrador, setBorrador] = useState("");
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("");
  const [rows, setRows] = useState<FilaSuscripcion[]>([]);
  const [todas, setTodas] = useState<FilaSuscripcion[]>([]);
  const [kpis, setKpis] = useState<KpisSuscripciones | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [emitiendo, setEmitiendo] = useState<string | null>(null);
  const [confirmarFila, setConfirmarFila] = useState<FilaSuscripcion | null>(null);
  const [confirmarMes, setConfirmarMes] = useState(false);
  const [emitiendoMes, setEmitiendoMes] = useState(false);
  const [resultado, setResultado] = useState<ResultadoEmitirMes | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [viendo, setViendo] = useState<string | null>(null);
  const actual = mesActual();

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "planes") setVista("planes");
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setQ(borrador.trim()), 300);
    return () => clearTimeout(t);
  }, [borrador]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  // Lista filtrada + (si hay filtros) la lista completa del mes: el botón "Emitir cuotas
  // del mes" emite TODAS las que faltan, así que su cuenta no depende de los filtros.
  useEffect(() => {
    let cancel = false;
    setCargando(true);
    const base = new URLSearchParams({ periodo });
    const filtrada = new URLSearchParams(base);
    if (q) filtrada.set("q", q);
    if (estado) filtrada.set("estado", estado);
    const hayFiltros = !!(q || estado);
    Promise.all([
      apiFetch<ListadoSuscripciones>(`/api/suscripciones?${filtrada}`),
      hayFiltros ? apiFetch<ListadoSuscripciones>(`/api/suscripciones?${base}`) : Promise.resolve(null),
    ])
      .then(([f, t]) => {
        if (cancel) return;
        setRows(f.rows ?? []);
        setTodas((t ?? f).rows ?? []);
        setKpis((t ?? f).kpis);
        setError(null);
      })
      .catch((e) => { if (!cancel) setError((e as Error).message); })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [periodo, q, estado, recarga]);

  const refrescar = useCallback(() => setRecarga((k) => k + 1), []);

  const pendientes = useMemo(() => todas.filter((r) => r.corresponde_mes && !r.cuota_venta_id), [todas]);
  const totalPendGs = pendientes.filter((r) => r.moneda !== "USD").reduce((a, r) => a + precioDelMes(r, periodo), 0);
  const totalPendUsd = pendientes.filter((r) => r.moneda === "USD").reduce((a, r) => a + precioDelMes(r, periodo), 0);

  async function emitirFila(r: FilaSuscripcion) {
    setConfirmarFila(null);
    setEmitiendo(r.id);
    setError(null);
    try {
      const v = await apiFetch<{ numero_control: string; total: number }>(`/api/suscripciones/${r.id}/emitir`, {
        method: "POST",
        body: JSON.stringify({ periodo }),
      });
      setAviso(`${r.cliente_nombre}: cuota de ${nombreMes(periodo)} emitida (${v.numero_control} · ${monto(v.total, r.moneda)})`);
      refrescar();
    } catch (e) {
      setError(`${r.cliente_nombre}: ${(e as Error).message}`);
    } finally {
      setEmitiendo(null);
    }
  }

  async function emitirMes() {
    setEmitiendoMes(true);
    setError(null);
    try {
      const r = await apiFetch<ResultadoEmitirMes>("/api/suscripciones/emitir-mes", { method: "POST", body: JSON.stringify({ periodo }) });
      setConfirmarMes(false);
      setResultado(r);
      refrescar();
    } catch (e) {
      setError((e as Error).message);
      setConfirmarMes(false);
    } finally {
      setEmitiendoMes(false);
    }
  }

  const futuro = periodo > actual;
  const hayFiltros = !!(q || borrador || estado);

  return (
    <div className="space-y-4 pb-10">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Cobros recurrentes</p>
          </div>
          <h1 className="mt-0.5 text-lg font-semibold tracking-tight text-slate-900">Suscripciones</h1>
          <p className="text-xs text-slate-500">Cuotas, abonos y todo lo que tus clientes pagan cada mes</p>
        </div>
        {vista === "suscripciones" && esAdmin ? (
          <button type="button" onClick={() => setConfirmarMes(true)} disabled={cargando || pendientes.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: TEAL }}>
            <Repeat className="h-3.5 w-3.5" /> Emitir cuotas de {nombreMes(periodo)} ({pendientes.length})
          </button>
        ) : null}
      </div>

      {/* Pestañas */}
      <div className="flex gap-1 border-b border-slate-200">
        {([["suscripciones", "Suscripciones"], ["planes", "Planes"]] as [Vista, string][]).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setVista(id)}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${vista === id ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {label}
          </button>
        ))}
      </div>

      {vista === "planes" ? (
        <PanelPlanes esAdmin={esAdmin} onCambio={refrescar} />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi titulo="Activas" valor={String(kpis?.activas ?? 0)} sub={kpis?.canceladas ? `${kpis.canceladas} cancelada${kpis.canceladas === 1 ? "" : "s"}` : undefined} />
            <Kpi titulo="Pausadas" valor={String(kpis?.pausadas ?? 0)} sub="no emiten cuotas" />
            <Kpi titulo="Ingreso mensual" valor={monto(kpis?.mensual_gs ?? 0, "GS")} sub={Number(kpis?.mensual_usd) > 0 ? `+ ${monto(kpis!.mensual_usd, "USD")}` : "de las activas"} />
            <Kpi titulo={`Por emitir · ${nombreMes(periodo)}`} valor={String(kpis?.por_emitir ?? 0)}
              sub={`${kpis?.emitidas_mes ?? 0} ya emitida${kpis?.emitidas_mes === 1 ? "" : "s"}`} tono={(kpis?.por_emitir ?? 0) > 0 ? "ambar" : undefined} />
          </div>

          {/* Filtros */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm">
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
              <button type="button" onClick={() => setPeriodo((p) => sumarMes(p, -1))} aria-label="Mes anterior" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><ChevronLeft className="h-4 w-4" /></button>
              <span className="min-w-[8.5rem] text-center text-xs font-semibold text-slate-800">{nombreMes(periodo)}</span>
              <button type="button" onClick={() => setPeriodo((p) => sumarMes(p, 1))} aria-label="Mes siguiente" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><ChevronRight className="h-4 w-4" /></button>
            </div>
            {periodo !== actual ? (
              <button type="button" onClick={() => setPeriodo(actual)} className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold hover:bg-slate-100" style={{ color: TEAL }}>Este mes</button>
            ) : null}
            <div className="relative min-w-[200px] flex-1">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: TEAL }} />
              <input type="text" value={borrador} onChange={(e) => setBorrador(e.target.value)} placeholder="Buscar por cliente, código o plan…"
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 hover:border-slate-300 focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-100)]" />
            </div>
            <Select value={estado} onChange={setEstado} minWidth={150}
              options={[["", "Todos los estados"], ["activa", "Activas"], ["pausada", "Pausadas"], ["cancelada", "Canceladas"]]} />
            {hayFiltros ? (
              <button type="button" onClick={() => { setBorrador(""); setQ(""); setEstado(""); }}
                className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700">
                Limpiar filtros
              </button>
            ) : null}
          </div>

          {aviso ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-800">✓ {aviso}</p> : null}
          {error ? <p className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</p> : null}
          {futuro ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Estás viendo {nombreMes(periodo)}, que todavía no llegó: si emitís, la cuota queda en la cuenta a cobrar con su vencimiento de ese mes.
            </p>
          ) : null}

          {/* Tabla */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {cargando && rows.length === 0 ? (
              <div className="flex items-center justify-center gap-3 py-20 text-sm text-slate-500">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ backgroundColor: TEAL }} /> Cargando suscripciones…
              </div>
            ) : rows.length === 0 ? (
              <div className="py-20 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border" style={{ borderColor: `${TEAL}40`, backgroundColor: `${TEAL}1a`, color: TEAL }}>
                  <Repeat className="h-5 w-5" />
                </div>
                <p className="text-sm font-semibold text-slate-700">{hayFiltros ? "Sin resultados para los filtros aplicados" : "Todavía no hay suscripciones"}</p>
                <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
                  {hayFiltros ? "Probá ajustar la búsqueda o limpiar los filtros." : "Se crean desde la ficha de cada cliente con \"+ Nueva suscripción\". Antes, cargá tus planes en la pestaña Planes."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50/80">
                    <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                      <th className="px-4 py-2.5">Cliente</th>
                      <th className="px-4 py-2.5">Plan</th>
                      <th className="px-4 py-2.5 text-right">Precio</th>
                      <th className="whitespace-nowrap px-4 py-2.5">Día fact. / venc.</th>
                      <th className="px-4 py-2.5">Estado</th>
                      <th className="whitespace-nowrap px-4 py-2.5">Cuota de {nombreMes(periodo)}</th>
                      <th className="px-4 py-2.5 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y divide-slate-100 ${cargando ? "opacity-60" : ""}`}>
                    {rows.map((r) => (
                      <tr key={r.id} className={`hover:bg-[var(--brand-50)] ${r.estado === "cancelada" ? "opacity-60" : ""}`}>
                        <td className="px-4 py-3">
                          <div className="flex min-w-48 items-center gap-2">
                            <CodigoChip codigo={codigoCliente({ id: r.cliente_id, codigo: r.cliente_codigo })} />
                            <Link href={`/clientes/${r.cliente_id}`} className="truncate font-semibold text-slate-900 hover:underline">{r.cliente_nombre}</Link>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{r.plan_nombre}</p>
                          {r.plan_pendiente_nombre && r.pendiente_desde ? (
                            <span className="mt-1 flex w-fit items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                              <CalendarClock className="h-3 w-3" /> Desde {nombreMes(r.pendiente_desde)}: {r.plan_pendiente_nombre}
                            </span>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-800">{monto(r.precio, r.moneda)}</td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{r.dia_facturacion} / {r.dia_vencimiento}</td>
                        <td className="px-4 py-3"><BadgeSuscripcion estado={r.estado} /></td>
                        <td className="whitespace-nowrap px-4 py-3"><CuotaDelMes r={r} /></td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          {r.cuota_venta_id ? (
                            <button type="button" onClick={() => setViendo(r.cuota_venta_id)}
                              className="rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold transition hover:brightness-95"
                              style={{ borderColor: `${TEAL}66`, color: TEAL }}>
                              Ver venta
                            </button>
                          ) : r.corresponde_mes && puedeEmitir ? (
                            <button type="button" disabled={!!emitiendo} onClick={() => (futuro ? setConfirmarFila(r) : void emitirFila(r))}
                              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:brightness-95 disabled:opacity-50"
                              style={{ backgroundColor: TEAL }}>
                              {emitiendo === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                              {emitiendo === r.id ? "Emitiendo…" : "Emitir"}
                            </button>
                          ) : (
                            <Link href={`/clientes/${r.cliente_id}`} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Ver ficha</Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {confirmarFila ? (
        <Modal titulo="Emitir cuota de un mes futuro" onClose={() => setConfirmarFila(null)}>
          <p className="text-sm text-slate-600">
            {nombreMes(periodo)} todavía no llegó. ¿Emitir ya la cuota de <strong>{confirmarFila.cliente_nombre}</strong> ({confirmarFila.plan_nombre} ·{" "}
            {monto(precioDelMes(confirmarFila, periodo), confirmarFila.moneda)})?
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmarFila(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Volver</button>
            <button type="button" onClick={() => void emitirFila(confirmarFila)} className="rounded-lg px-3 py-2 text-sm font-semibold text-white hover:brightness-95" style={{ backgroundColor: TEAL }}>Sí, emitir</button>
          </div>
        </Modal>
      ) : null}

      {confirmarMes ? (
        <Modal titulo={`Emitir cuotas de ${nombreMes(periodo)}`} onClose={() => { if (!emitiendoMes) setConfirmarMes(false); }} size="lg">
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Se emite la cuota de {nombreMes(periodo)} de cada suscripción activa que todavía no la tiene. Cada una queda como venta a crédito en la cuenta a cobrar del cliente.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cuotas</p>
                <p className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900">{pendientes.length}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{monto(totalPendGs, "GS")}</p>
                {totalPendUsd > 0 ? <p className="text-sm font-semibold tabular-nums text-slate-700">+ {monto(totalPendUsd, "USD")}</p> : null}
              </div>
            </div>
            {futuro ? <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{nombreMes(periodo)} todavía no llegó.</p> : null}
            <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 text-xs">
              {pendientes.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="truncate text-slate-700">{r.cliente_nombre} <span className="text-slate-400">· {r.plan_nombre}</span></span>
                  <span className="shrink-0 font-semibold tabular-nums text-slate-800">{monto(precioDelMes(r, periodo), r.moneda)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button type="button" onClick={() => setConfirmarMes(false)} disabled={emitiendoMes} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={() => void emitirMes()} disabled={emitiendoMes || pendientes.length === 0}
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50" style={{ backgroundColor: TEAL }}>
                {emitiendoMes ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {emitiendoMes ? "Emitiendo…" : `Emitir ${pendientes.length} cuota${pendientes.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {resultado ? (
        <Modal titulo={`Cuotas de ${nombreMes(resultado.periodo)}`} onClose={() => setResultado(null)} size="lg">
          <div className="space-y-3">
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              ✓ <strong>{resultado.emitidas}</strong> cuota{resultado.emitidas === 1 ? "" : "s"} emitida{resultado.emitidas === 1 ? "" : "s"}
              {totalPendUsd === 0 && resultado.emitidas > 0 ? <> por <strong>{monto(resultado.total, "GS")}</strong></> : null}.
            </p>
            {resultado.errores.length > 0 ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                <p className="mb-1.5 text-sm font-semibold text-rose-800">{resultado.errores.length} no se pudo emitir:</p>
                <ul className="space-y-1 text-xs text-rose-800">
                  {resultado.errores.map((e, i) => <li key={i}><strong>{e.cliente}:</strong> {e.error}</li>)}
                </ul>
              </div>
            ) : null}
            <div className="flex justify-end">
              <button type="button" onClick={() => setResultado(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Cerrar</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {viendo ? <VentaDetalle ventaId={viendo} onClose={() => setViendo(null)} onAnulada={() => { setViendo(null); refrescar(); }} /> : null}
    </div>
  );
}

function CuotaDelMes({ r }: { r: FilaSuscripcion }) {
  if (r.cuota_venta_id) {
    if (r.cuota_estado === "pagada") {
      return <span className="text-xs font-semibold text-emerald-700">Pagada <span className="font-mono font-normal text-slate-500">{r.cuota_numero}</span></span>;
    }
    return (
      <span className="text-xs text-slate-700">
        Emitida <span className="font-mono text-slate-500">{r.cuota_numero}</span>
        {r.cuota_saldo != null ? <span className="block text-[11px] text-slate-400">saldo {monto(r.cuota_saldo, r.moneda)}</span> : null}
      </span>
    );
  }
  if (r.corresponde_mes) return <span className="text-xs font-semibold text-amber-700">Pendiente de emitir</span>;
  return <span className="text-xs text-slate-400">No corresponde</span>;
}

function Kpi({ titulo, valor, sub, tono }: { titulo: string; valor: string; sub?: string; tono?: "ambar" }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className={`text-[11px] font-semibold uppercase tracking-wide ${tono === "ambar" ? "text-amber-700" : "text-slate-500"}`}>{titulo}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${tono === "ambar" ? "text-amber-700" : "text-slate-900"}`}>{valor}</p>
      {sub ? <p className="text-[11px] text-slate-400">{sub}</p> : null}
    </div>
  );
}
