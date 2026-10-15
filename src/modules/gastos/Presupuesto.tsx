"use client";

/**
 * Presupuesto mensual por categoría (modal): monto previsto por rubro (o por subcategoría) y
 * para las compras de mercadería, con lo gastado del mes al lado. "Copiar del mes anterior"
 * trae lo previsto del mes anterior (no guarda hasta "Guardar presupuesto").
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Copy, Loader2, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import MontoInput from "@/components/ui/MontoInput";
import { gs, nombreMes } from "@/modules/gastos/tipos";

type Fila = { id: string; nombre: string; previsto: number | null; anterior: number | null; gastado: number; tipo_costo?: string };
type Datos = {
  periodo: string;
  mercaderia: { previsto: number | null; anterior: number | null; gastado: number };
  rubros: (Fila & { subcategorias: Fila[] })[];
};

const MERC = "__mercaderia__";
const sumarMes = (ymd: string, n: number) => {
  const [y, m] = ymd.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
};

export function PresupuestoModal({ periodoInicial, onClose, onGuardado }: { periodoInicial: string; onClose: () => void; onGuardado: () => void }) {
  const [periodo, setPeriodo] = useState(`${periodoInicial.slice(0, 7)}-01`);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [montos, setMontos] = useState<Record<string, number>>({});
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [cambios, setCambios] = useState(false);

  useEffect(() => {
    let vivo = true;
    setDatos(null);
    apiFetch<Datos>(`/api/gastos/presupuesto?periodo=${periodo}`)
      .then((d) => {
        if (!vivo) return;
        setDatos(d);
        const m: Record<string, number> = {};
        if (d.mercaderia.previsto) m[MERC] = Number(d.mercaderia.previsto);
        const ab: Record<string, boolean> = {};
        for (const r of d.rubros) {
          if (r.previsto) m[r.id] = Number(r.previsto);
          for (const s of r.subcategorias) if (s.previsto) { m[s.id] = Number(s.previsto); ab[r.id] = true; }
        }
        setMontos(m);
        setAbiertos(ab);
        setCambios(false);
      })
      .catch((e) => vivo && setError((e as Error).message));
    return () => { vivo = false; };
  }, [periodo]);

  const set = (k: string, v: number) => { setMontos((m) => ({ ...m, [k]: v })); setCambios(true); };
  const previstoRubro = (r: Datos["rubros"][number]) => (montos[r.id] ?? 0) + r.subcategorias.reduce((a, s) => a + (montos[s.id] ?? 0), 0);
  const totalPrevisto = useMemo(() => (datos ? (montos[MERC] ?? 0) + datos.rubros.reduce((a, r) => a + previstoRubro(r), 0) : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [datos, montos]);
  const totalGastado = datos ? Number(datos.mercaderia.gastado) + datos.rubros.reduce((a, r) => a + Number(r.gastado), 0) : 0;
  const hayAnterior = !!datos && (datos.mercaderia.anterior != null || datos.rubros.some((r) => r.anterior != null || r.subcategorias.some((s) => s.anterior != null)));

  function copiarAnterior() {
    if (!datos) return;
    const m: Record<string, number> = {};
    if (datos.mercaderia.anterior) m[MERC] = Number(datos.mercaderia.anterior);
    for (const r of datos.rubros) {
      if (r.anterior) m[r.id] = Number(r.anterior);
      for (const s of r.subcategorias) if (s.anterior) m[s.id] = Number(s.anterior);
    }
    setMontos(m);
    setCambios(true);
  }

  async function guardar() {
    if (guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const items = Object.entries(montos).filter(([, v]) => v > 0).map(([k, v]) => ({ categoria_id: k === MERC ? null : k, monto: Math.round(v) }));
      await apiFetch("/api/gastos/presupuesto", { method: "PUT", body: JSON.stringify({ periodo, items }) });
      setCambios(false);
      onGuardado();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  const INPUT = "w-36 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-right text-sm tabular-nums text-slate-800 outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

  return (
    <CapaModal onClose={guardando ? undefined : onClose}>
      <div className={`flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${ALTO_MAX_MODAL}`} style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Presupuesto mensual</h2>
            <p className="text-xs text-slate-500">Cuánto prevés gastar por categoría. Podés cargarlo por rubro o abrir el rubro y cargarlo por subcategoría.</p>
          </div>
          <button onClick={onClose} disabled={guardando} aria-label="Cerrar" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-6 py-2.5">
          <div className="flex items-center gap-1">
            <button onClick={() => setPeriodo((p) => sumarMes(p, -1))} aria-label="Mes anterior" className="rounded-lg p-1.5 text-slate-500 hover:bg-white"><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-[9rem] text-center text-sm font-semibold capitalize text-slate-800">{nombreMes(periodo)}</span>
            <button onClick={() => setPeriodo((p) => sumarMes(p, 1))} aria-label="Mes siguiente" className="rounded-lg p-1.5 text-slate-500 hover:bg-white"><ChevronRight className="h-4 w-4" /></button>
          </div>
          {hayAnterior ? (
            <button onClick={copiarAnterior} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#3F8E91] hover:bg-slate-50">
              <Copy className="h-3.5 w-3.5" /> Copiar del mes anterior
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {error ? <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
          {!datos ? (
            <p className="py-10 text-center text-sm text-slate-400">Cargando…</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-slate-400">
                <tr><th className="pb-2 text-left font-semibold">Categoría</th><th className="pb-2 text-right font-semibold">Gastado</th><th className="pb-2 pl-3 text-right font-semibold">Previsto</th></tr>
              </thead>
              <tbody>
                <tr className="border-t border-slate-100">
                  <td className="py-2 font-medium text-slate-800">Compras de mercadería</td>
                  <td className="py-2 text-right tabular-nums text-slate-500">{gs(datos.mercaderia.gastado)}</td>
                  <td className="py-2 pl-3 text-right"><MontoInput value={montos[MERC] ?? ""} onChange={(n) => set(MERC, n)} decimals={false} placeholder="—" className={INPUT} /></td>
                </tr>
                {datos.rubros.map((r) => {
                  const ab = !!abiertos[r.id];
                  const subTotal = r.subcategorias.reduce((a, s) => a + (montos[s.id] ?? 0), 0);
                  return (
                    <RubroFilas key={r.id} r={r} ab={ab} subTotal={subTotal} montos={montos} set={set} input={INPUT}
                      toggle={() => setAbiertos((a) => ({ ...a, [r.id]: !a[r.id] }))} />
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
          <p className="text-sm text-slate-500">Previsto <b className="tabular-nums text-slate-900">{gs(totalPrevisto)}</b> · gastado <b className="tabular-nums text-slate-700">{gs(totalGastado)}</b></p>
          <div className="flex gap-2">
            <button onClick={onClose} disabled={guardando} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
            <button onClick={() => void guardar()} disabled={guardando || !cambios || !datos}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50">
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar presupuesto
            </button>
          </div>
        </div>
      </div>
    </CapaModal>
  );
}

function RubroFilas({ r, ab, subTotal, montos, set, input, toggle }: {
  r: Fila & { subcategorias: Fila[] }; ab: boolean; subTotal: number; montos: Record<string, number>;
  set: (k: string, v: number) => void; input: string; toggle: () => void;
}) {
  return (
    <>
      <tr className="border-t border-slate-100">
        <td className="py-2">
          <button onClick={toggle} className="inline-flex items-center gap-1 font-medium text-slate-800 hover:text-[#3F8E91]" aria-expanded={ab}>
            <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${ab ? "" : "-rotate-90"}`} /> {r.nombre}
          </button>
          {subTotal > 0 ? <span className="ml-2 text-[11px] text-slate-400">+ {gs(subTotal)} en subcategorías</span> : null}
        </td>
        <td className="py-2 text-right tabular-nums text-slate-500">{gs(r.gastado)}</td>
        <td className="py-2 pl-3 text-right"><MontoInput value={montos[r.id] ?? ""} onChange={(n) => set(r.id, n)} decimals={false} placeholder="—" className={input} /></td>
      </tr>
      {ab ? r.subcategorias.map((s) => (
        <tr key={s.id} className="text-[13px]">
          <td className="py-1.5 pl-7 text-slate-600">{s.nombre}{s.tipo_costo === "fijo" ? <span className="ml-1.5 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">Fijo</span> : null}</td>
          <td className="py-1.5 text-right tabular-nums text-slate-400">{gs(s.gastado)}</td>
          <td className="py-1.5 pl-3 text-right"><MontoInput value={montos[s.id] ?? ""} onChange={(n) => set(s.id, n)} decimals={false} placeholder="—" className={input} /></td>
        </tr>
      )) : null}
    </>
  );
}
