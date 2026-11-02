"use client";

/**
 * /rrhh/liquidaciones — Extracto del mes para el asesor (receta 118). Abierta se recalcula con los datos
 * de hoy; cerrada queda como estaba. No mueve plata.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Download, Loader2, Lock, Plus, Printer, Trash2, Unlock } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { hoyPY } from "@/lib/fecha/paraguay";
import { usePermiso } from "@/lib/sesion/ContextoUsuario";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { gs } from "@/components/graficos/formato";
import { etiquetaMes } from "@/modules/comisiones/calculo";
import { imprimirHtml } from "@/modules/mesas/imprimirComanda";
import { PIE_MODAL } from "@/modules/clientes/ui";
import type { Ajuste } from "@/modules/rrhh/calculo";
import type { ExtractoFila, ExtractoMes } from "@/modules/rrhh/tipos";
import { BOTON, BOTON_PRIMARIO, Campo, CampoMonto, INPUT, Interruptor, htmlExtracto, renglonesExtracto } from "@/modules/rrhh/ui";

/** Lo que falta resolver va primero. */
const peso = (f: ExtractoFila) => (f.faltan_dias ? 0 : f.estado === "abierta" ? 1 : 2);

function ultimosMeses(n: number): [string, string][] {
  const [a, m] = hoyPY().slice(0, 7).split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const total = a * 12 + (m - 1) - i;
    const mes = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
    return [mes, etiquetaMes(mes)];
  });
}

const liquidar = (body: object) => apiFetch("/api/rrhh/liquidaciones", { method: "POST", body: JSON.stringify(body) });

function ModalExtracto({ f, mes, periodo, onClose, onCambio }: { f: ExtractoFila; mes: string; periodo: string; onClose: () => void; onCambio: () => void }) {
  const r = f.resultado;
  const cerrada = f.estado === "cerrada";
  const [dias, setDias] = useState(r.tipo_salario === "jornalero" && !f.faltan_dias ? String(r.dias_pagados) : "");
  const [ajustes, setAjustes] = useState<Ajuste[]>(r.ajustes);
  const [motivo, setMotivo] = useState("");
  const [reabriendo, setReabriendo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jornalero = r.tipo_salario === "jornalero";
  const ajustesValidos = ajustes.filter((a) => a.concepto.trim() && a.monto > 0);
  const cambiar = (i: number, c: Partial<Ajuste>) => setAjustes((l) => l.map((a, k) => (k === i ? { ...a, ...c } : a)));

  async function correr(fn: () => Promise<unknown>, cerrar = false) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onCambio();
      if (cerrar) onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const guardar = () => liquidar({ accion: "ajustar", mes, usuario_id: f.usuario_id, dias_trabajados: jornalero ? (dias.trim() === "" ? null : Number(dias.replace(",", "."))) : null, ajustes: ajustesValidos });

  return (
    <Modal titulo={`${f.nombre}: ${periodo}`} onClose={busy ? () => {} : onClose} size="xl">
      <div className="space-y-4">
        <dl className="rounded-xl border border-slate-200 p-3 text-sm">
          {renglonesExtracto(r).map((x, i) => (
            <div key={i} className={`flex justify-between gap-3 py-1 ${x.total ? "font-semibold text-slate-900" : x.info ? "text-xs text-slate-500" : "text-slate-600"}`}>
              <dt className="min-w-0">{x.label}</dt><dd className="shrink-0 tabular-nums">{x.signo === "-" ? "− " : ""}{gs(x.monto)}</dd>
            </div>
          ))}
        </dl>
        {cerrada ? <p className="text-xs text-slate-500">Cerrada por {f.cerrada_por ?? "—"}. Para cambiarla, primero reabrila.</p> : <p className="text-xs text-slate-500">Lo que cambies se ve en el extracto al guardar.</p>}

        {!cerrada ? (
          <>
            {jornalero ? <Campo label="Días trabajados en el mes *"><input inputMode="decimal" className={INPUT} value={dias} onChange={(e) => setDias(e.target.value)} /></Campo> : null}
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-600">Extras y descuentos</p>
              {ajustes.map((a, i) => (
                <div key={i} className="space-y-2 rounded-xl border border-slate-200 p-3">
                  <div className="flex gap-2">
                    <input className={INPUT} aria-label="Concepto" placeholder="Concepto: horas extra, adelanto…" value={a.concepto} onChange={(e) => cambiar(i, { concepto: e.target.value })} />
                    <button type="button" aria-label="Quitar" className={BOTON} onClick={() => setAjustes((l) => l.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select block value={a.tipo} etiqueta="Tipo" options={[["extra", "Suma"], ["descuento", "Resta"]]} onChange={(v) => cambiar(i, { tipo: v as Ajuste["tipo"] })} />
                    <CampoMonto valor={a.monto} onChange={(n) => cambiar(i, { monto: n })} />
                  </div>
                  {a.tipo === "extra" ? <Interruptor valor={a.imponible} onChange={(v) => cambiar(i, { imponible: v })} label="Aporta IPS" ayuda="Horas extra sí. Bonificación familiar no." /> : null}
                </div>
              ))}
              <button type="button" className={`${BOTON} w-full`} onClick={() => setAjustes((l) => [...l, { concepto: "", monto: 0, tipo: "extra", imponible: true }])}><Plus className="h-4 w-4" /> Agregar</button>
            </div>
          </>
        ) : null}

        {reabriendo ? <Campo label="Motivo para reabrir *"><input autoFocus className={INPUT} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo> : null}
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        <div className={`${PIE_MODAL} flex-wrap`}>
          <button type="button" className={BOTON} onClick={() => void imprimirHtml(htmlExtracto({ periodo, nombre: f.nombre, ci: f.ci, sucursal: f.sucursal, area: f.area, antiguedad: f.antiguedad, vacaciones: f.vacaciones_saldo, aguinaldo: f.aguinaldo.total, estado: f.estado, resultado: r }))}><Printer className="h-4 w-4" /> Imprimir</button>
          {cerrada ? (
            reabriendo
              ? <button type="button" className={BOTON_PRIMARIO} disabled={busy || motivo.trim().length < 3} onClick={() => void correr(() => liquidar({ accion: "reabrir", mes, usuario_id: f.usuario_id, motivo }), true)}>Confirmar</button>
              : <button type="button" className={BOTON} onClick={() => setReabriendo(true)}><Unlock className="h-4 w-4" /> Reabrir</button>
          ) : (
            <>
              <button type="button" className={BOTON} disabled={busy} onClick={() => void correr(guardar)}>Guardar</button>
              <button type="button" className={BOTON_PRIMARIO} disabled={busy} onClick={() => void correr(async () => { await guardar(); await liquidar({ accion: "cerrar", mes, usuarios: [f.usuario_id] }); }, true)}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Cerrar
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function PaginaLiquidaciones() {
  const puedeExportar = usePermiso("exportar");
  const [mes, setMes] = useState(hoyPY().slice(0, 7));
  const [datos, setDatos] = useState<ExtractoMes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(() => {
    setError(null);
    apiFetch<ExtractoMes>(`/api/rrhh/liquidaciones?mes=${mes}`).then(setDatos).catch((e: Error) => setError(e.message));
  }, [mes]);
  useEffect(() => { cargar(); }, [cargar]);

  const filas = datos?.mes === mes ? datos.filas : [];
  const sumar = (fn: (f: ExtractoFila) => number) => filas.reduce((s, f) => s + fn(f), 0);
  const abiertas = filas.filter((f) => f.estado === "abierta");
  const elegida = filas.find((f) => f.usuario_id === abierta) ?? null;

  async function cerrarTodas() {
    setBusy(true);
    setError(null);
    try {
      await liquidar({ accion: "cerrar", mes, usuarios: abiertas.map((f) => f.usuario_id) });
      cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const meses = ultimosMeses(24);
  const pos = meses.findIndex(([m]) => m === mes);
  const cerradas = filas.length - abiertas.length;
  const ordenadas = [...filas].sort((a, b) => peso(a) - peso(b) || a.nombre.localeCompare(b.nombre, "es"));
  const totales: [string, number, string][] = [
    ["Neto a cobrar", sumar((f) => f.resultado.neto), "Lo que cobra el personal"],
    ["Imponible", sumar((f) => f.resultado.imponible), "Base del IPS"],
    ["IPS trabajadores", sumar((f) => f.resultado.ips_trabajador), "9 %, sale del salario"],
    ["IPS empresa", sumar((f) => f.resultado.ips_empresa), "16,5 %, lo paga la empresa"],
  ];

  return (
    <div className="space-y-4 pb-10">
      <Link href="/rrhh/panel" className="-ml-1 inline-flex min-h-9 w-fit items-center gap-1 rounded-lg px-1 text-xs font-semibold text-slate-500 no-underline transition-colors hover:text-slate-800 max-md:min-h-11 max-md:pr-2">
        <ArrowLeft className="h-3.5 w-3.5" /> RR HH
      </Link>

      <div className="overflow-hidden rounded-2xl border border-[var(--brand)]/40 bg-white shadow-sm">
        <div className="bg-gradient-to-br from-white via-white to-[var(--brand-50)] px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">Liquidaciones</p>
              <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-slate-900 first-letter:uppercase sm:text-2xl">{etiquetaMes(mes)}</h1>
              <p className="mt-1 text-xs text-slate-500">Extracto para revisar con tu asesor. No genera pagos ni gastos.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 max-sm:w-full max-sm:[&>*]:flex-1">
              {puedeExportar ? <button type="button" className={BOTON} disabled={!filas.length} onClick={() => void descargarArchivo(`/api/rrhh/liquidaciones/export?mes=${mes}`, `liquidacion-${mes}.xlsx`).catch((e: Error) => setError(e.message))}><Download className="h-4 w-4" /> Excel</button> : null}
              <button type="button" className={BOTON_PRIMARIO} disabled={busy || !abiertas.length} onClick={() => void cerrarTodas()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Cerrar el mes</button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-slate-200/70 pt-4">
            <div className="flex items-center gap-1">
              <button type="button" aria-label="Mes anterior" disabled={pos >= meses.length - 1} onClick={() => setMes(meses[pos + 1][0])} className={`${BOTON} w-11 px-0 sm:w-9`}><ChevronLeft className="h-4 w-4" /></button>
              <div className="w-48"><Select block value={mes} onChange={setMes} options={meses} etiqueta="Mes" /></div>
              <button type="button" aria-label="Mes siguiente" disabled={pos <= 0} onClick={() => setMes(meses[pos - 1][0])} className={`${BOTON} w-11 px-0 sm:w-9`}><ChevronRight className="h-4 w-4" /></button>
            </div>
            {filas.length ? (
              <div className="min-w-48 flex-1">
                <p className="text-xs font-medium text-slate-600">{cerradas} de {filas.length} {filas.length === 1 ? "cerrada" : "cerradas"}</p>
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-slate-200"><span className="block h-full rounded-full bg-[var(--brand)] transition-all" style={{ width: `${(cerradas / filas.length) * 100}%` }} /></span>
              </div>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px border-t border-slate-100 bg-slate-100 lg:grid-cols-4">
          {totales.map(([k, v, sub]) => (
            <div key={k} className="min-w-0 bg-[#fcfdfd] px-3 py-3 sm:px-5 sm:py-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{k}</p>
              <p className="mt-1 truncate text-base font-semibold tabular-nums text-slate-900">{gs(v)}</p>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">{sub}</p>
            </div>
          ))}
        </div>
      </div>

      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {!datos && !error ? <p className="text-sm text-slate-400">Cargando…</p> : null}
      {datos ? (
        ordenadas.length ? (
          <ul className="m-0 list-none divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            {ordenadas.map((f) => {
              const r = f.resultado;
              const jornalero = r.tipo_salario === "jornalero";
              const detalle = [jornalero ? "Jornalero" : "Mensualero", f.area, r.dias_ausencia ? `${r.dias_ausencia} ${r.dias_ausencia === 1 ? "día" : "días"} de ausencia` : null].filter(Boolean).join(" · ");
              return (
                <li key={f.usuario_id}>
                  <button type="button" onClick={() => setAbierta(f.usuario_id)} className="flex min-h-[72px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 sm:gap-4 sm:px-5">
                    <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--brand-50)] text-sm font-semibold text-[var(--brand)]">{f.nombre.trim().split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase() ?? "").join("")}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-slate-900">{f.nombre}</span>
                      <span className="mt-0.5 block truncate text-[13px] text-slate-500">{detalle}</span>
                    </span>
                    <span className="hidden w-28 shrink-0 text-right lg:block">
                      <span className="block text-sm tabular-nums text-slate-700">{f.faltan_dias ? "—" : gs(r.imponible)}</span>
                      <span className="block text-xs text-slate-500">Imponible</span>
                    </span>
                    <span className="hidden w-24 shrink-0 text-right lg:block">
                      <span className="block text-sm tabular-nums text-slate-700">{f.faltan_dias ? "—" : gs(r.ips_trabajador)}</span>
                      <span className="block text-xs text-slate-500">IPS</span>
                    </span>
                    <span className="w-28 shrink-0 text-right">
                      <span className="block text-sm font-semibold tabular-nums text-slate-900">{f.faltan_dias ? "—" : gs(r.neto)}</span>
                      <span className="block text-xs text-slate-500 max-sm:hidden">Neto</span>
                      <span className={`block text-xs font-medium sm:hidden ${f.estado === "cerrada" ? "text-emerald-700" : f.faltan_dias ? "text-amber-700" : "text-sky-700"}`}>{f.estado === "cerrada" ? "Cerrada" : f.faltan_dias ? "Faltan días" : "Abierta"}</span>
                    </span>
                    <span className="hidden w-24 shrink-0 justify-center sm:flex">
                      {f.estado === "cerrada" ? <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">Cerrada</span>
                        : f.faltan_dias ? <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">Faltan días</span>
                        : <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold text-sky-700">Abierta</span>}
                    </span>
                    <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-slate-300" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">No hay nadie para liquidar en este mes.</p>
        )
      ) : null}

      {datos && datos.sin_legajo > 0 ? (
        <p className="flex items-start gap-2 text-[13px] text-slate-500">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span>{datos.sin_legajo === 1 ? "A 1 persona le faltan" : `A ${datos.sin_legajo} personas les faltan`} sus datos y no sale acá. <Link href="/rrhh" className="font-medium text-[var(--brand)]">Ir a Personal</Link></span>
        </p>
      ) : null}

      {elegida && datos ? <ModalExtracto key={`${elegida.usuario_id}-${elegida.estado}`} f={elegida} mes={mes} periodo={datos.periodo} onClose={() => setAbierta(null)} onCambio={cargar} /> : null}
    </div>
  );
}
