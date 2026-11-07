"use client";

/** /comedor/menu — Menú semanal: 2 opciones por día, publicar el enlace de reserva y ver el conteo. */
import { useCallback, useEffect, useState } from "react";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { apiFetch } from "@/lib/api/client-fetch";
import { Check, ChevronLeft, ChevronRight, Copy, Link2, Loader2, Save, Users } from "lucide-react";

type Opcion = { id?: string; dia: number; opcion: number; nombre: string; producto_id: string | null; especial: boolean; precio_habitual: number; precio_especial: number | null; activa: boolean; reservas?: number };
type Semana = { id: string | null; semana_inicio: string; publicado: boolean; cierre_at: string | null; token: string | null; opciones: Opcion[]; propio: number };

const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];
const gs = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-PY");
const clave = (d: number, o: number) => `${d}-${o}`;
const fmtFecha = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("es-PY", { day: "2-digit", month: "short" });

function lunesDe(d: Date) { const x = new Date(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x; }
function isoDia(d: Date) { return d.toISOString().slice(0, 10); }

export default function MenuSemanalPage() {
  const [fecha, setFecha] = useState(() => isoDia(lunesDe(new Date())));
  const [semana, setSemana] = useState<Semana | null>(null);
  const [opts, setOpts] = useState<Record<string, Opcion>>({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cierre, setCierre] = useState("");
  const [copiado, setCopiado] = useState(false);

  const cargar = useCallback(async (f: string) => {
    setCargando(true);
    setError(null);
    try {
      const s = await apiFetch<Semana>(`/api/comedor/menu?fecha=${f}`);
      setSemana(s);
      const m: Record<string, Opcion> = {};
      for (let d = 1; d <= 5; d++) for (let o = 1; o <= 2; o++) m[clave(d, o)] = { dia: d, opcion: o, nombre: "", producto_id: null, especial: false, precio_habitual: 0, precio_especial: null, activa: true };
      for (const op of s.opciones) m[clave(op.dia, op.opcion)] = op;
      setOpts(m);
      setCierre(s.cierre_at ? toLocalInput(s.cierre_at) : "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(fecha); }, [fecha, cargar]);

  const set = (d: number, o: number, patch: Partial<Opcion>) =>
    setOpts((prev) => ({ ...prev, [clave(d, o)]: { ...prev[clave(d, o)], ...patch } }));

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const opciones = Object.values(opts).filter((o) => o.nombre.trim());
      const s = await apiFetch<Semana>("/api/comedor/menu", { method: "POST", body: JSON.stringify({ semana_inicio: fecha, opciones }) });
      aplicar(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  async function publicar(valor: boolean) {
    setGuardando(true);
    setError(null);
    try {
      // Guarda una vez (asegura id + opciones al día) y después publica.
      const guardada = await apiFetch<Semana>("/api/comedor/menu", { method: "POST", body: JSON.stringify({ semana_inicio: fecha, opciones: Object.values(opts).filter((o) => o.nombre.trim()) }) });
      const s = await apiFetch<Semana>("/api/comedor/menu/publicar", {
        method: "POST",
        body: JSON.stringify({ semana_id: guardada.id, cierre_at: cierre ? new Date(cierre).toISOString() : null, publicar: valor }),
      });
      aplicar(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  function aplicar(s: Semana) {
    setSemana(s);
    const m = { ...opts };
    for (const op of s.opciones) m[clave(op.dia, op.opcion)] = op;
    setOpts(m);
  }

  const link = semana?.token ? `${typeof window !== "undefined" ? window.location.origin : ""}/menu/${semana.token}` : null;
  const totalReservas = semana?.opciones.reduce((a, o) => a + (o.reservas ?? 0), 0) ?? 0;

  function moverSemana(dias: number) {
    const d = new Date(fecha + "T00:00:00"); d.setDate(d.getDate() + dias); setFecha(isoDia(d));
  }
  const finSemana = (() => { const d = new Date(fecha + "T00:00:00"); d.setDate(d.getDate() + 4); return isoDia(d); })();

  return (
    <div className="space-y-5">
      <EncabezadoPagina
        kicker="Comedor"
        titulo="Menú semanal"
        subtitulo="Cargá las 2 opciones de cada día, publicá el enlace y mirá cuántos reservaron para preparar."
        volver={{ href: "/comedor/panel", label: "Comedor" }}
      />

      {/* Navegación de semana */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <button onClick={() => moverSemana(-7)} aria-label="Semana anterior" className="rounded-lg border border-slate-200 p-2 hover:bg-slate-50"><ChevronLeft className="h-4 w-4" /></button>
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-slate-800">Semana del {fmtFecha(fecha)} al {fmtFecha(finSemana)}</p>
            <p className="text-xs text-slate-500">
              {semana?.publicado ? <span className="font-medium text-emerald-600">Publicada</span> : "Borrador (sin publicar)"}
              {semana?.publicado && totalReservas > 0 ? ` · ${totalReservas} reserva(s)` : ""}
            </p>
          </div>
          <button onClick={() => moverSemana(7)} aria-label="Semana siguiente" className="rounded-lg border border-slate-200 p-2 hover:bg-slate-50"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <button onClick={guardar} disabled={guardando || cargando} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar
        </button>
      </div>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      {cargando ? (
        <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-5">
          {DIAS.map((nombre, i) => {
            const dia = i + 1;
            const fechaDia = (() => { const d = new Date(fecha + "T00:00:00"); d.setDate(d.getDate() + i); return isoDia(d); })();
            return (
              <div key={dia} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-baseline justify-between"><p className="font-semibold text-slate-800">{nombre}</p><p className="text-xs text-slate-400">{fmtFecha(fechaDia)}</p></div>
                {[1, 2].map((o) => {
                  const op = opts[clave(dia, o)];
                  if (!op) return null;
                  return (
                    <div key={o} className="space-y-1.5 rounded-lg border border-slate-100 bg-slate-50/60 p-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Opción {o}</span>
                        {typeof op.reservas === "number" && op.reservas > 0 ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--brand-700)]"><Users className="h-3 w-3" />{op.reservas}</span> : null}
                      </div>
                      <input value={op.nombre} onChange={(e) => set(dia, o, { nombre: e.target.value })} placeholder="Nombre del plato" className="min-h-10 w-full rounded-md border border-slate-200 px-2 text-sm outline-none focus:border-[var(--brand)]" />
                      <div className="flex items-center gap-2">
                        <input value={op.precio_habitual || ""} inputMode="numeric" onChange={(e) => set(dia, o, { precio_habitual: Number(e.target.value.replace(/\D/g, "")) || 0 })} placeholder="Precio" className="min-h-9 w-full rounded-md border border-slate-200 px-2 text-xs tabular-nums outline-none focus:border-[var(--brand)]" />
                        <label className="flex shrink-0 cursor-pointer items-center gap-1 text-xs text-slate-600" title="Menú especial (la diferencia la paga la empresa)">
                          <input type="checkbox" checked={op.especial} onChange={(e) => set(dia, o, { especial: e.target.checked, precio_especial: e.target.checked ? op.precio_especial : null })} className="h-4 w-4 rounded border-slate-300" /> Especial
                        </label>
                      </div>
                      {op.especial ? (
                        <input value={op.precio_especial || ""} inputMode="numeric" onChange={(e) => set(dia, o, { precio_especial: Number(e.target.value.replace(/\D/g, "")) || 0 })} placeholder="Precio especial" className="min-h-9 w-full rounded-md border border-amber-200 bg-amber-50/50 px-2 text-xs tabular-nums outline-none focus:border-amber-400" />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* Publicar */}
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Cierre de reservas</span>
            <input type="datetime-local" value={cierre} onChange={(e) => setCierre(e.target.value)} className="min-h-11 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[var(--brand)]" />
          </label>
          {semana?.publicado ? (
            <>
              <button onClick={() => void publicar(true)} disabled={guardando} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Actualizar cierre</button>
              <button onClick={() => void publicar(false)} disabled={guardando} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">Despublicar</button>
            </>
          ) : (
            <button onClick={() => void publicar(true)} disabled={guardando} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-95 disabled:opacity-50">
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Publicar y generar enlace
            </button>
          )}
        </div>
        {link ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-sm">
            <Link2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-emerald-800">{link}</span>
            <button onClick={() => { void navigator.clipboard.writeText(link); setCopiado(true); setTimeout(() => setCopiado(false), 1500); }} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
              {copiado ? <><Check className="h-3.5 w-3.5" /> Copiado</> : <><Copy className="h-3.5 w-3.5" /> Copiar</>}
            </button>
          </div>
        ) : null}
        {semana?.publicado ? <p className="text-xs text-slate-500">Para preparar: {totalReservas} reserva(s) con menú · {semana.propio} con «traigo mi almuerzo».</p> : null}
      </div>
    </div>
  );
}

/** ISO (UTC) → valor para <input type="datetime-local"> en hora local. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}
