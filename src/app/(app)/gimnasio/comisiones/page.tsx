"use client";

/**
 * /gimnasio/comisiones — Comisión de los profesores (receta 150). La regla la decide la empresa:
 * ninguna, un monto por alumno que asistió, un monto por clase dada o un % del valor de la clase
 * (clase suelta, o la cuota de la membresía repartida entre sus clases del mes). Se calcula por mes
 * con las asistencias culminadas, sin guardar nada (como las comisiones de ventas).
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Percent } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { hoyPY } from "@/lib/fecha/paraguay";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { Select } from "@/components/Select";
import { BOTON_PRIMARIO, ET, INPUT } from "@/modules/inventario/ui";
import { gs, type ComisionProfesor, type ConfigGim } from "@/modules/gimnasio/tipos";

type Resultado = { modo: ConfigGim["comision_modo"]; monto: number; pct: number; profesores: ComisionProfesor[] };

const MODOS: [ConfigGim["comision_modo"], string][] = [
  ["ninguna", "Sin comisión"],
  ["por_alumno", "Monto por alumno que asistió"],
  ["por_clase", "Monto por clase dada"],
  ["porcentaje", "% del valor de la clase"],
];

const mesDe = (f: string) => f.slice(0, 7);
const rango = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  const fin = new Date(a, m, 0).getDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(fin).padStart(2, "0")}` };
};
const moverMes = (mes: string, n: number) => {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const nombreMes = (mes: string) => new Date(`${mes}-15T12:00:00`).toLocaleDateString("es-PY", { month: "long", year: "numeric" });

export default function ComisionesProfesores() {
  const [mes, setMes] = useState(mesDe(hoyPY()));
  const [r, setR] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modo, setModo] = useState<string>("ninguna");
  const [monto, setMonto] = useState("");
  const [pct, setPct] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(() => {
    const { desde, hasta } = rango(mes);
    apiFetch<Resultado>(`/api/gimnasio/comisiones?desde=${desde}&hasta=${hasta}`).then((x) => { setR(x); setError(null); }).catch((e: Error) => setError(e.message));
  }, [mes]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    apiFetch<ConfigGim>("/api/gimnasio/config").then((c) => { setModo(c.comision_modo); setMonto(c.comision_monto ? String(c.comision_monto) : ""); setPct(c.comision_pct ? String(c.comision_pct) : ""); }).catch(() => undefined);
  }, []);

  async function guardar() {
    setGuardando(true); setError(null); setAviso(null);
    try {
      await apiFetch("/api/gimnasio/config", { method: "PUT", body: JSON.stringify({ comision_modo: modo, comision_monto: Number(monto) || 0, comision_pct: Number(pct.replace(",", ".")) || 0 }) });
      setAviso("Regla guardada.");
      cargar();
    } catch (e) { setError((e as Error).message); } finally { setGuardando(false); }
  }

  const total = (r?.profesores ?? []).reduce((s, p) => s + Number(p.comision), 0);
  return (
    <div className="space-y-4 pb-10">
      <EncabezadoPagina kicker="Gimnasio" titulo="Comisiones de profesores" subtitulo="Se calculan con las asistencias culminadas de cada mes." volver={{ href: "/gimnasio", label: "Recepción" }} />

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Percent className="h-4 w-4 text-slate-400" /> Cómo se paga</h2>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-end">
          <div><span className={ET}>Regla</span><Select value={modo} onChange={setModo} options={MODOS} etiqueta="Regla de comisión" block /></div>
          {modo === "por_alumno" || modo === "por_clase" ? (
            <label className="block"><span className={ET}>Monto (Gs.)</span><input inputMode="numeric" value={monto} onChange={(e) => setMonto(e.target.value.replace(/[^\d]/g, ""))} placeholder="0" className={INPUT} /></label>
          ) : modo === "porcentaje" ? (
            <label className="block"><span className={ET}>Porcentaje</span><input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="0" className={INPUT} /></label>
          ) : <span className="hidden sm:block" />}
          <button type="button" disabled={guardando} onClick={() => void guardar()} className={`${BOTON_PRIMARIO} bg-[var(--brand)] min-h-11 sm:min-h-10`}>{guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar</button>
        </div>
        {modo === "porcentaje" ? <p className="text-xs text-slate-500">El valor de una clase es lo que se cobró como clase suelta, o la cuota de la membresía repartida entre las clases que el alumno tomó ese mes.</p> : null}
        {aviso ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{aviso}</p> : null}
      </section>

      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-label="Mes anterior" onClick={() => setMes((m) => moverMes(m, -1))} className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-[var(--brand)] sm:h-10 sm:w-10"><ChevronLeft className="h-4 w-4" /></button>
        <span className="text-sm font-semibold capitalize text-slate-900">{nombreMes(mes)}</span>
        <button type="button" aria-label="Mes siguiente" onClick={() => setMes((m) => moverMes(m, 1))} className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-[var(--brand)] sm:h-10 sm:w-10"><ChevronRight className="h-4 w-4" /></button>
      </div>

      {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {!r && !error ? <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" /> : null}
      {r ? (r.profesores.length ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="hidden grid-cols-[minmax(0,1fr)_90px_90px_140px_140px] gap-3 bg-slate-50 px-5 py-2 text-xs font-medium text-slate-500 md:grid">
            <span>Profesor</span><span className="text-right">Clases</span><span className="text-right">Alumnos</span><span className="text-right">Valor</span><span className="text-right">Comisión</span>
          </div>
          <ul className="m-0 list-none divide-y divide-slate-100 p-0">
            {r.profesores.map((p) => (
              <li key={p.profesor_id} className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-3 md:grid-cols-[minmax(0,1fr)_90px_90px_140px_140px] md:items-center md:px-5">
                <span className="col-span-2 truncate text-sm font-semibold text-slate-900 md:col-span-1">{p.profesor}</span>
                <span className="text-sm tabular-nums text-slate-600 md:text-right"><span className="text-xs text-slate-400 md:hidden">Clases </span>{p.clases}</span>
                <span className="text-right text-sm tabular-nums text-slate-600"><span className="text-xs text-slate-400 md:hidden">Alumnos </span>{p.alumnos}</span>
                <span className="text-sm tabular-nums text-slate-600 md:text-right"><span className="text-xs text-slate-400 md:hidden">Valor </span>{gs(p.valor)}</span>
                <span className="text-right text-sm font-semibold tabular-nums text-slate-900">{gs(p.comision)}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-sm md:px-5">
            <span className="font-medium text-slate-600">Total del mes</span>
            <span className="font-semibold tabular-nums text-slate-900">{gs(total)}</span>
          </div>
        </div>
      ) : (
        <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">No hay clases culminadas con profesor en {nombreMes(mes)}.</p>
      )) : null}
    </div>
  );
}
