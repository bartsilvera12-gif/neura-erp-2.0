"use client";

/**
 * /inmobiliaria/alquileres — Contratos de alquiler y liquidación a dueños (receta 133).
 *   · Contratos: vigentes primero, con el alquiler de este mes, si ya se emitió y lo que debe el
 *     inquilino. "Emitir el mes" emite la cuota de todos los vigentes que no la tienen.
 *   · Liquidar a dueños: lo cobrado de propiedades de un dueño, menos la comisión; "Liquidar" le paga
 *     el neto (sale de la caja abierta) y queda en el historial.
 */
import { useCallback, useEffect, useState } from "react";
import { Building2, Loader2, Plus, ReceiptText, Search } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { usePermiso } from "@/lib/sesion/ContextoUsuario";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { Select } from "@/components/Select";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, INPUT_FILTRO, Pestanas } from "@/modules/inventario/ui";
import { FormContrato } from "@/modules/inmobiliaria/FormContrato";
import type { ContratoFila, Liquidacion, PendienteDueno } from "@/modules/inmobiliaria/tipos";

const gs = (n: number | null | undefined) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
const MEDIOS: [string, string][] = [["transferencia", "Transferencia"], ["efectivo", "Efectivo"], ["cheque", "Cheque"], ["otro", "Otro"]];

function Contratos({ puedeEditar }: { puedeEditar: boolean }) {
  const [filas, setFilas] = useState<ContratoFila[] | null>(null);
  const [estado, setEstado] = useState("vigente");
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState<string | null | undefined>(undefined);
  const [emitiendo, setEmitiendo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const p = new URLSearchParams();
    if (estado) p.set("estado", estado);
    if (q.trim()) p.set("q", q.trim());
    try { setFilas(await apiFetch<ContratoFila[]>(`/api/inmobiliaria/alquileres?${p}`)); setError(null); } catch (e) { setError((e as Error).message); }
  }, [estado, q]);
  useEffect(() => { const h = setTimeout(() => void cargar(), 250); return () => clearTimeout(h); }, [cargar]);

  async function emitirMes() {
    setEmitiendo(true); setAviso(null); setError(null);
    try {
      const r = await apiFetch<{ mes: string; emitidas: number; total: number; saltados: { numero: string; motivo: string }[] }>("/api/inmobiliaria/alquileres/emitir-mes", { method: "POST", body: "{}" });
      setAviso(r.emitidas ? `${r.emitidas} alquiler${r.emitidas === 1 ? "" : "es"} de ${r.mes} emitido${r.emitidas === 1 ? "" : "s"} (${gs(r.total)}): ya están en Cuentas a cobrar.` : `No había alquileres de ${r.mes} por emitir.`);
      void cargar();
    } catch (e) { setError((e as Error).message); } finally { setEmitiendo(false); }
  }

  const pendientes = (filas ?? []).filter((f) => f.estado === "vigente" && !f.emitido_mes).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por contrato, propiedad, inquilino o dueño…" aria-label="Buscar contratos" className={`${INPUT_FILTRO} w-full pl-9 max-sm:h-11`} />
        </label>
        <Select chip prefijo="Estado" textoVacio="Todos" value={estado} onChange={setEstado} options={[["", "Todos los contratos"], ["vigente", "Vigentes"], ["finalizado", "Terminados"], ["rescindido", "Rescindidos"]]} etiqueta="Estado" />
        {puedeEditar ? (
          <div className="grid grid-cols-2 gap-2 lg:flex">
            <button type="button" disabled={emitiendo || !pendientes} onClick={() => void emitirMes()} className={`${BOTON_SECUNDARIO} max-sm:min-h-11`} title={pendientes ? undefined : "Todos los vigentes ya tienen el mes"}>
              {emitiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <ReceiptText className="h-4 w-4" />} Emitir el mes{pendientes ? ` (${pendientes})` : ""}
            </button>
            <button type="button" onClick={() => setAbierto(null)} className={`${BOTON_PRIMARIO} bg-[var(--brand)] max-sm:min-h-11`}><Plus className="h-4 w-4" /> Nuevo contrato</button>
          </div>
        ) : null}
      </div>
      {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {aviso ? <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{aviso}</p> : null}
      {!filas ? <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" /> : filas.length ? (
        <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
          {filas.map((f) => (
            <li key={f.id}>
              <button type="button" onClick={() => setAbierto(f.id)} className="flex h-full w-full flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-[var(--brand)] hover:shadow-md">
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block text-[11px] font-medium text-slate-400">{f.numero} · {f.propiedad_codigo}</span>
                    <span className="block truncate text-[15px] font-semibold text-slate-900">{f.propiedad}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${f.estado === "vigente" ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>{f.estado === "vigente" ? "Vigente" : f.estado === "finalizado" ? "Terminado" : "Rescindido"}</span>
                </span>
                <span className="text-xs text-slate-500">Inquilino: <span className="font-medium text-slate-700">{f.inquilino}</span>{f.propietario ? ` · Dueño: ${f.propietario}` : ""}</span>
                <span className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-sm">
                  <span className="tabular-nums font-semibold text-slate-900">{gs(f.monto_actual)}<span className="text-xs font-normal text-slate-500">/mes · día {f.dia_vencimiento}</span></span>
                  <span className="flex gap-1.5 text-[11px] font-semibold">
                    {f.estado === "vigente" ? <span className={`rounded-full px-2 py-0.5 ${f.emitido_mes ? "bg-sky-50 text-sky-800" : "bg-amber-50 text-amber-800"}`}>{f.emitido_mes ? "Mes emitido" : "Mes sin emitir"}</span> : null}
                    {Number(f.deuda) > 0 ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">Debe {gs(f.deuda)}</span> : null}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--brand-50,#eef7f7)] text-[var(--brand)]"><Building2 className="h-6 w-6" /></span>
          <p className="text-sm font-semibold text-slate-800">{q || estado !== "vigente" ? "No hay contratos con esos filtros" : "Todavía no hay contratos vigentes"}</p>
          <p className="max-w-sm text-sm text-slate-500">Un contrato une una propiedad de alquiler con su inquilino: cada mes se emite su cuota y queda en Cuentas a cobrar.</p>
        </div>
      )}
      {abierto !== undefined ? <FormContrato key={abierto ?? "nuevo"} id={abierto} puedeEditar={puedeEditar} onCerrar={() => setAbierto(undefined)}
        onCambio={(x) => { void cargar(); if (abierto === null) setAbierto(x.id); }} /> : null}
    </div>
  );
}

function Liquidaciones({ puedeLiquidar }: { puedeLiquidar: boolean }) {
  const [d, setD] = useState<{ pendiente: PendienteDueno[]; historial: Liquidacion[] } | null>(null);
  const [medio, setMedio] = useState<Record<string, string>>({});
  const [ref, setRef] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(() => apiFetch<{ pendiente: PendienteDueno[]; historial: Liquidacion[] }>("/api/inmobiliaria/liquidaciones").then(setD).catch((e: Error) => setError(e.message)), []);
  useEffect(() => { void cargar(); }, [cargar]);

  async function liquidar(p: PendienteDueno) {
    setEnviando(p.propietario_id); setError(null); setAviso(null);
    try {
      const r = await apiFetch<{ numero: string; neto: number; desde_caja: boolean }>("/api/inmobiliaria/liquidaciones", {
        method: "POST", body: JSON.stringify({ propietario_id: p.propietario_id, medio: medio[p.propietario_id] ?? "transferencia", referencia: ref[p.propietario_id]?.trim() || null }),
      });
      setAviso(`Liquidación ${r.numero}: se le pagaron ${gs(r.neto)} a ${p.propietario}${r.desde_caja ? " (salió de tu caja)" : ""}.`);
      void cargar();
    } catch (e) { setError((e as Error).message); } finally { setEnviando(null); }
  }

  if (!d) return error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" />;
  return (
    <div className="space-y-5">
      {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {aviso ? <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{aviso}</p> : null}
      {d.pendiente.length ? d.pendiente.map((p) => (
        <section key={p.propietario_id} className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-[15px] font-semibold text-slate-900">{p.propietario}</h2>
              <p className="text-xs text-slate-500">Cobrado {gs(p.cobrado)} · comisión {gs(p.comision)}</p>
            </div>
            <p className="text-right"><span className="block text-[11px] text-slate-500">A pagarle</span><span className="text-lg font-semibold tabular-nums text-slate-900">{gs(p.neto)}</span></p>
          </div>
          <ul className="m-0 mt-3 list-none divide-y divide-slate-100 rounded-xl border border-slate-100 p-0 text-sm">
            {p.cuotas.map((q) => (
              <li key={q.id} className="flex justify-between gap-2 px-3 py-2">
                <span className="min-w-0 truncate text-slate-600"><span className="capitalize">{q.mes}</span> · {q.propiedad} ({q.contrato})</span>
                <span className="shrink-0 tabular-nums text-slate-800">{gs(q.neto)}</span>
              </li>
            ))}
          </ul>
          {puedeLiquidar ? (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr_auto]">
              <Select block value={medio[p.propietario_id] ?? "transferencia"} onChange={(v) => setMedio((m) => ({ ...m, [p.propietario_id]: v }))} options={MEDIOS} etiqueta="Medio de pago" />
              <input className={`${INPUT_FILTRO} w-full max-sm:h-11`} placeholder="Referencia (opcional)" value={ref[p.propietario_id] ?? ""} onChange={(e) => setRef((r) => ({ ...r, [p.propietario_id]: e.target.value }))} aria-label="Referencia" />
              <button type="button" disabled={!!enviando} onClick={() => void liquidar(p)} className={`${BOTON_PRIMARIO} bg-[var(--brand)] max-sm:min-h-11`}>
                {enviando === p.propietario_id ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Liquidar {gs(p.neto)}
              </button>
            </div>
          ) : null}
        </section>
      )) : <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">No hay alquileres cobrados pendientes de liquidar a dueños.</p>}

      {d.historial.length ? (
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Liquidaciones hechas</h3>
          <ul className="m-0 list-none divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white p-0 text-sm">
            {d.historial.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span className="min-w-0"><span className="font-medium text-slate-800">{l.numero} · {l.propietario}</span>
                  <span className="block text-xs text-slate-500">{new Date(l.fecha).toLocaleDateString("es-PY")} · {l.cuotas} cuota{l.cuotas === 1 ? "" : "s"} · {l.medio}{l.referencia ? ` · ${l.referencia}` : ""}</span></span>
                <span className="tabular-nums font-semibold text-slate-900">{gs(l.neto)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export default function PaginaAlquileres() {
  const puedeEditar = usePermiso("vender_credito");
  const puedeLiquidar = usePermiso("pagar_proveedores");
  const [tab, setTab] = useState("contratos");
  return (
    <div className="space-y-4 pb-10">
      <EncabezadoPagina volver={{ href: "/inmobiliaria/panel", label: "Inmobiliaria" }} titulo="Alquileres" subtitulo="Los contratos con su cuota de cada mes, y lo que se le debe a cada dueño de lo cobrado (menos la comisión)." />
      <Pestanas opciones={[{ id: "contratos", label: "Contratos" }, { id: "duenos", label: "Liquidar a dueños" }]} valor={tab} onChange={setTab} />
      {tab === "contratos" ? <Contratos puedeEditar={puedeEditar} /> : <Liquidaciones puedeLiquidar={puedeLiquidar} />}
    </div>
  );
}
