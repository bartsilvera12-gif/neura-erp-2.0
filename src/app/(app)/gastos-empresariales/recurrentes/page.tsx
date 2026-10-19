"use client";

/**
 * /gastos-empresariales/recurrentes — Plantillas de gastos que se repiten cada mes (alquiler,
 * internet, sueldos…) y "Generar gastos del mes": un botón VISIBLE que crea los borradores del
 * mes elegido (nunca se generan solos ni se confirman solos). Al lado, los próximos vencimientos:
 * borradores programados, plantillas sin generar y deudas con proveedores por vencer.
 */
import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, CalendarPlus, CheckCircle2, ChevronLeft, ChevronRight, Loader2, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { hoyPY } from "@/lib/fecha/paraguay";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { AccionesPagina, EncabezadoPagina } from "@/components/EncabezadoPagina";
import { MenuAcciones } from "@/components/MenuAcciones";
import { FormRecurrente } from "@/modules/gastos/FormRecurrente";
import { ESTADO_GASTO, fechaCorta, gs, monto, nombreMedioGasto, nombreMes, type ListaRecurrentes, type Plantilla, type Vencimientos } from "@/modules/gastos/tipos";

const sumarMes = (ymd: string, n: number) => {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
};

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Recurrentes />
    </Suspense>
  );
}

function Recurrentes() {
  const [periodo, setPeriodo] = useState(`${hoyPY().slice(0, 7)}-01`);
  const [datos, setDatos] = useState<ListaRecurrentes | null>(null);
  const [venc, setVenc] = useState<Vencimientos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [form, setForm] = useState<{ p: Plantilla | null } | null>(null);
  const [generar, setGenerar] = useState(false);
  const [borrar, setBorrar] = useState<Plantilla | null>(null);

  useEffect(() => {
    let vivo = true;
    apiFetch<ListaRecurrentes>(`/api/gastos/recurrentes?periodo=${periodo}`)
      .then((d) => { if (vivo) { setDatos(d); setError(null); } })
      .catch((e) => vivo && setError((e as Error).message));
    return () => { vivo = false; };
  }, [periodo, recarga]);
  useEffect(() => {
    apiFetch<Vencimientos>("/api/gastos/vencimientos?dias=30").then(setVenc).catch(() => setVenc(null));
  }, [recarga]);
  const refrescar = useCallback(() => setRecarga((k) => k + 1), []);

  const r = datos?.resumen;
  const maxPeriodo = sumarMes(`${hoyPY().slice(0, 7)}-01`, 2);
  const pendientes = (datos?.plantillas ?? []).filter((p) => p.aplica && !p.generado);

  return (
    <div className="space-y-5 pb-10">
      <EncabezadoPagina
        titulo="Gastos recurrentes"
        subtitulo="Lo que se paga todos los meses. Cada mes generás los borradores, los revisás y los confirmás cuando llega la factura o se paga."
        acciones={<AccionesPagina acciones={[{ etiqueta: "Nueva plantilla", icono: <Plus />, onClick: () => setForm({ p: null }) }]} />} />

      {/* Mes + acción principal (en celular: mes arriba a todo el ancho, cifras y el botón abajo) */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#4FAEB2]/30 bg-[#4FAEB2]/5 px-3 py-3 sm:px-4">
        <div className="flex items-center gap-1 max-sm:w-full max-sm:justify-between">
          <button onClick={() => setPeriodo((p) => sumarMes(p, -1))} aria-label="Mes anterior" className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-500 hover:bg-white max-sm:h-11 max-sm:w-11"><ChevronLeft className="h-4 w-4 max-sm:h-5 max-sm:w-5" /></button>
          <span className="min-w-[10rem] text-center text-base font-semibold capitalize text-slate-800">{nombreMes(periodo)}</span>
          <button onClick={() => setPeriodo((p) => (sumarMes(p, 1) <= maxPeriodo ? sumarMes(p, 1) : p))} disabled={sumarMes(periodo, 1) > maxPeriodo}
            aria-label="Mes siguiente" className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-500 hover:bg-white disabled:opacity-30 max-sm:h-11 max-sm:w-11"><ChevronRight className="h-4 w-4 max-sm:h-5 max-sm:w-5" /></button>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-slate-600 max-sm:w-full max-sm:justify-center">
          <span>Previsto <b className="tabular-nums text-slate-900">{gs(r?.previsto_mes)}</b></span>
          <span>Generados <b className="tabular-nums text-slate-900">{r ? `${r.generadas} de ${r.aplican}` : "—"}</b></span>
          {r && r.a_completar > 0 ? <span className="text-xs text-slate-500">{r.a_completar} con monto variable</span> : null}
        </div>
        <button onClick={() => setGenerar(true)} disabled={!pendientes.length}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#3F8E91] disabled:opacity-50 max-sm:min-h-11 max-sm:w-full">
          <CalendarPlus className="h-4 w-4" />
          {pendientes.length ? `Generar gastos de ${nombreMes(periodo).split(" ")[0]} (${pendientes.length})` : "Todo generado este mes"}
        </button>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Plantillas */}
        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:col-span-2">
          <div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold text-slate-800">Plantillas</h2></div>
          {!datos ? <p className="px-4 py-10 text-center text-sm text-slate-400">Cargando…</p>
            : datos.plantillas.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                <p className="text-sm text-slate-500">Todavía no hay plantillas. Cargá el alquiler, internet o los sueldos una vez y generalos cada mes.</p>
                <button onClick={() => setForm({ p: null })} className="rounded-xl bg-[#4FAEB2] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91]">Nueva plantilla</button>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {datos.plantillas.map((p) => <FilaPlantilla key={p.id} p={p} onEditar={() => setForm({ p })} onBorrar={() => setBorrar(p)} />)}
              </ul>
            )}
        </section>

        {/* Vencimientos */}
        <section className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-800">Próximos vencimientos</h2>
            <p className="text-[11px] text-slate-400">Próximos 30 días y lo vencido · {venc ? gs(venc.total_gs) : "—"}</p>
          </div>
          {!venc ? <p className="px-4 py-8 text-center text-sm text-slate-400">Cargando…</p>
            : venc.rows.length === 0 ? <p className="px-4 py-8 text-center text-sm text-slate-400">Nada por vencer.</p> : (
              <ul className="divide-y divide-slate-100 lg:max-h-[34rem] lg:overflow-y-auto">
                {venc.rows.map((v, i) => {
                  const href = v.tipo === "a_pagar" ? "/compras/pagos" : v.gasto_id ? `/gastos-empresariales/compras-gastos?gasto=${v.gasto_id}&desde=&hasta=` : null;
                  const badge = v.tipo === "a_pagar" ? ["A pagar", "bg-sky-50 text-sky-700"] : v.tipo === "borrador" ? ["Borrador", "bg-slate-100 text-slate-600"] : ["Sin generar", "bg-amber-50 text-amber-700"];
                  const cuerpo = (
                    <div className="flex items-start gap-3 px-4 py-2.5">
                      <div className={`w-11 shrink-0 rounded-lg py-1 text-center ${v.vencido ? "bg-rose-50 text-rose-700" : v.dias <= 7 ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-600"}`}>
                        <p className="text-sm font-bold leading-none">{v.fecha.slice(8, 10)}</p>
                        <p className="text-[10px] uppercase">{["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"][Number(v.fecha.slice(5, 7)) - 1]}</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-slate-800">{v.concepto}</p>
                        <p className="truncate text-[11px] text-slate-400">{v.proveedor ?? "—"}{v.vencido ? ` · vencido hace ${-v.dias} d` : v.dias === 0 ? " · hoy" : ` · en ${v.dias} d`}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold tabular-nums text-slate-800">{Number(v.monto) > 0 ? monto(v.monto, v.moneda) : "variable"}</p>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${badge[1]}`}>{badge[0]}</span>
                      </div>
                    </div>
                  );
                  return <li key={`${v.tipo}-${v.cxp_id ?? v.gasto_id ?? v.recurrente_id}-${i}`}>{href ? <Link href={href} className="block hover:bg-slate-50">{cuerpo}</Link> : cuerpo}</li>;
                })}
              </ul>
            )}
          {venc && venc.vencido_gs > 0 ? (
            <p className="flex items-center gap-1.5 border-t border-slate-100 px-4 py-2.5 text-xs text-rose-600"><AlertTriangle className="h-3.5 w-3.5" /> Vencido: {gs(venc.vencido_gs)}</p>
          ) : null}
        </section>
      </div>

      {form ? <FormRecurrente plantilla={form.p} onClose={() => setForm(null)} onGuardado={refrescar} /> : null}
      {generar && datos ? <GenerarMes periodo={periodo} pendientes={pendientes} onClose={() => setGenerar(false)} onHecho={refrescar} /> : null}
      {borrar ? <BorrarPlantilla p={borrar} onClose={() => setBorrar(null)} onHecho={refrescar} /> : null}
    </div>
  );
}

function FilaPlantilla({ p, onEditar, onBorrar }: { p: Plantilla; onEditar: () => void; onBorrar: () => void }) {
  const est = p.generado ? ESTADO_GASTO[p.generado.estado] : null;
  return (
    <li className={`flex items-center gap-3 px-3.5 py-3 sm:px-4 ${p.activo ? "" : "opacity-50"}`}>
      <div className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-slate-50 py-1.5 text-slate-600">
        <span className="text-[9px] uppercase tracking-wide text-slate-400">día</span>
        <span className="text-base font-bold leading-none">{p.dia_vencimiento}</span>
      </div>
      {/* En celular el monto y el estado van debajo del nombre (no se aprietan contra las acciones). */}
      <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
        <div className="min-w-0 sm:flex-1">
          <p className="truncate text-sm font-semibold text-slate-800">{p.nombre}{!p.activo ? <span className="ml-2 text-[11px] font-normal text-slate-400">inactiva</span> : null}</p>
          <p className="truncate text-[11px] text-slate-500">
            {[p.proveedor_nombre ?? (p.con_comprobante ? null : "Sin comprobante"), p.categorias, p.sucursal_nombre,
              p.tipo_pago === "credito" ? "Crédito" : nombreMedioGasto(p.medio_pago)].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 sm:mt-0 sm:block sm:shrink-0 sm:text-right">
          <p className="text-sm font-semibold tabular-nums text-slate-800">{Number(p.total) > 0 ? monto(p.total, p.moneda) : <span className="text-slate-400">variable</span>}</p>
          {!p.aplica ? <p className="text-[11px] text-slate-400">{p.activo ? "fuera de vigencia" : "—"}</p>
            : p.generado ? (
              <Link href={`/gastos-empresariales/compras-gastos?gasto=${p.generado.id}&desde=&hasta=`} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#3F8E91] hover:underline max-sm:-my-2 max-sm:min-h-11">
                <CheckCircle2 className="h-3 w-3" /> {p.generado.numero ?? "Borrador"} {est && p.generado.estado !== "confirmado" ? `· ${est.t.toLowerCase()}` : ""}
              </Link>
            ) : <p className="inline-flex items-center gap-1 text-[11px] text-amber-700"><CalendarClock className="h-3 w-3" /> pendiente · {fechaCorta(p.fecha_periodo)}</p>}
        </div>
      </div>
      {/* Celular: un solo botón "⋯" de 44 px (hoja con Editar / Eliminar); desde sm, los dos íconos. */}
      <div className="-mr-1.5 shrink-0 sm:hidden">
        <MenuAcciones etiqueta={`Acciones de ${p.nombre}`} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 active:bg-slate-100"
          items={[
            { etiqueta: "Editar plantilla", icono: <Pencil className="h-4 w-4" />, onClick: onEditar },
            { etiqueta: p.ultimo_periodo ? "Desactivar" : "Eliminar", icono: <Trash2 className="h-4 w-4" />, onClick: onBorrar, tono: "peligro" },
          ]}>
          <MoreHorizontal className="h-5 w-5" />
        </MenuAcciones>
      </div>
      <div className="flex shrink-0 gap-1 max-sm:hidden">
        <button onClick={onEditar} aria-label={`Editar ${p.nombre}`} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-700"><Pencil className="h-4 w-4" /></button>
        <button onClick={onBorrar} aria-label={`Eliminar ${p.nombre}`} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
      </div>
    </li>
  );
}

/** Confirmación de "Generar gastos del mes": se ve qué se va a crear y se puede destildar. */
function GenerarMes({ periodo, pendientes, onClose, onHecho }: { periodo: string; pendientes: Plantilla[]; onClose: () => void; onHecho: () => void }) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(pendientes.map((p) => p.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<{ creados: { id: string; plantilla: string; fecha: string; total: number; moneda: string }[]; ya_estaban: number } | null>(null);
  const total = pendientes.filter((p) => sel.has(p.id)).reduce((a, p) => a + Number(p.total) * (p.moneda === "USD" ? Number(p.tipo_cambio) : 1), 0);

  async function ok() {
    if (busy || sel.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ creados: { id: string; plantilla: string; fecha: string; total: number; moneda: string }[]; ya_estaban: number }>(
        "/api/gastos/recurrentes/generar", { method: "POST", body: JSON.stringify({ periodo, ids: [...sel] }) });
      setHecho(r);
      onHecho();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <CapaModal onClose={busy ? undefined : onClose}>
      <div className={`flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${ALTO_MAX_MODAL}`} style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
          <h2 className="min-w-0 text-lg font-semibold capitalize text-slate-800">{hecho ? "Borradores creados" : `Generar gastos de ${nombreMes(periodo)}`}</h2>
          <button onClick={onClose} disabled={busy} aria-label="Cerrar" className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm sm:px-6">
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">{error}</div> : null}
          {hecho ? (
            <>
              <p className="text-slate-600">Se crearon {hecho.creados.length} {hecho.creados.length === 1 ? "borrador" : "borradores"}. Revisalos y confirmalos cuando llegue la factura o se pague.</p>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {hecho.creados.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 max-sm:py-0.5">
                    <span className="min-w-0 truncate">{c.plantilla} <span className="text-xs text-slate-400">· {fechaCorta(c.fecha)}</span></span>
                    <Link href={`/gastos-empresariales/compras-gastos?gasto=${c.id}&desde=&hasta=`} className="inline-flex shrink-0 items-center text-xs font-semibold text-[#3F8E91] hover:underline max-sm:min-h-11 max-sm:px-2">Abrir</Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p className="text-slate-600">Se crea un <b>borrador</b> por cada plantilla elegida (no se confirma ni sale plata). Los que ya existen para este mes no se repiten.</p>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {pendientes.map((p) => (
                  <li key={p.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50 max-sm:min-h-12">
                      <input type="checkbox" className="shrink-0 accent-[#4FAEB2] max-sm:h-5 max-sm:w-5" checked={sel.has(p.id)}
                        onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} />
                      <span className="min-w-0 flex-1 max-sm:[overflow-wrap:anywhere] sm:truncate">{p.nombre} <span className="text-xs text-slate-400 max-sm:block">· vence {fechaCorta(p.fecha_periodo)}</span></span>
                      <span className="shrink-0 tabular-nums text-slate-700">{Number(p.total) > 0 ? monto(p.total, p.moneda) : "variable"}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="text-right text-slate-600">Total previsto: <b className="text-slate-900">{gs(total)}</b></p>
            </>
          )}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
          {hecho ? (
            <Link href="/gastos-empresariales/compras-gastos?estado=borrador&desde=&hasta=" className="inline-flex items-center justify-center rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] max-sm:flex-1">Ver borradores</Link>
          ) : (
            <>
              <button onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 max-sm:flex-1">Cancelar</button>
              <button onClick={() => void ok()} disabled={busy || sel.size === 0}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50 max-sm:flex-[2]">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />} Crear {sel.size} {sel.size === 1 ? "borrador" : "borradores"}
              </button>
            </>
          )}
        </div>
      </div>
    </CapaModal>
  );
}

function BorrarPlantilla({ p, onClose, onHecho }: { p: Plantilla; onClose: () => void; onHecho: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function ok() {
    setBusy(true);
    try {
      await apiFetch(`/api/gastos/recurrentes/${p.id}`, { method: "DELETE" });
      onHecho();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <CapaModal onClose={busy ? undefined : onClose}>
      <div className={`flex w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${ALTO_MAX_MODAL}`} style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="shrink-0 border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4"><h2 className="text-base font-semibold text-slate-800 [overflow-wrap:anywhere]">Eliminar «{p.nombre}»</h2></div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4 text-sm text-slate-600 sm:px-6">
          <p>{p.ultimo_periodo ? "Ya generó gastos: la plantilla se desactiva (los gastos quedan como están)." : "La plantilla se elimina."}</p>
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">{error}</div> : null}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
          <button onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 max-sm:flex-1">Cancelar</button>
          <button onClick={() => void ok()} disabled={busy} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50 max-sm:flex-1">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {p.ultimo_periodo ? "Desactivar" : "Eliminar"}
          </button>
        </div>
      </div>
    </CapaModal>
  );
}
