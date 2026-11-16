"use client";

/** /comedor/retiro — Terminal de autoservicio (enlace + depósito) y supervisión de los retiros del día. */
import { useCallback, useEffect, useState } from "react";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { Select } from "@/components/Select";
import { apiFetch } from "@/lib/api/client-fetch";
import { Check, Copy, Link2, Loader2, RefreshCw, Trash2, Utensils } from "lucide-react";

type Terminal = { retiro_token: string | null; deposito_id: string | null; depositos: { id: string; nombre: string }[] };
type Retiro = { id: string; funcionario: string; documento: string | null; menu: string; hora: string; subsidio: number; excedente: number; diferencia: number; especial: boolean };
type Retiros = { fecha: string; total: number; rows: Retiro[] };

const gs = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-PY");

export default function RetiroPage() {
  const [term, setTerm] = useState<Terminal | null>(null);
  const [retiros, setRetiros] = useState<Retiros | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [t, r] = await Promise.all([
        apiFetch<Terminal>("/api/comedor/terminal").catch(() => null),
        apiFetch<Retiros>("/api/comedor/retiros"),
      ]);
      if (t) setTerm(t);
      setRetiros(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  async function guardarTerminal(patch: { deposito_id?: string | null; generar?: boolean }) {
    setBusy(true);
    setError(null);
    try {
      setTerm(await apiFetch<Terminal>("/api/comedor/terminal", { method: "POST", body: JSON.stringify(patch) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function anular(id: string) {
    const motivo = window.prompt("¿Por qué anulás este retiro? (queda registrado)");
    if (motivo === null) return;
    setBusy(true);
    try {
      await apiFetch("/api/comedor/retiros/anular", { method: "POST", body: JSON.stringify({ consumo_id: id, motivo }) });
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const link = term?.retiro_token ? `${typeof window !== "undefined" ? window.location.origin : ""}/retiro/${term.retiro_token}` : null;
  const totSub = retiros?.rows.reduce((a, r) => a + r.subsidio, 0) ?? 0;
  const totExc = retiros?.rows.reduce((a, r) => a + r.excedente, 0) ?? 0;

  return (
    <div className="space-y-5">
      <EncabezadoPagina kicker="Comedor" titulo="Retiro" subtitulo="La terminal donde el funcionario marca su retiro por cédula, y los retiros del día." volver={{ href: "/comedor/panel", label: "Comedor" }} />

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      {/* Terminal */}
      {term ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Utensils className="h-4 w-4 text-[var(--brand)]" /> Terminal de autoservicio</h2>
          <p className="text-xs text-slate-500">Abrí este enlace en la tablet/terminal del comedor. El funcionario pone su cédula, ve su menú reservado y confirma el retiro.</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Depósito del que descuenta el stock</span>
              <Select value={term.deposito_id ?? ""} onChange={(v) => void guardarTerminal({ deposito_id: v || null })} options={term.depositos.map((d) => [d.id, d.nombre] as [string, string])} textoVacio="Automático" />
            </label>
            <button onClick={() => void guardarTerminal({ generar: true })} disabled={busy} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw className="h-4 w-4" /> {link ? "Regenerar enlace" : "Generar enlace"}
            </button>
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
        </div>
      ) : null}

      {/* Retiros del día */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">Retiros de hoy</h2>
          <button onClick={() => void cargar()} disabled={cargando} aria-label="Actualizar" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} /></button>
        </div>
        {retiros && retiros.rows.length > 0 ? (
          <div className="mb-3 grid grid-cols-3 gap-2 text-sm">
            <Mini label="Retiros" valor={retiros.total} />
            <Mini label="Subsidio" valor={`Gs ${gs(totSub)}`} />
            <Mini label="Excedente" valor={`Gs ${gs(totExc)}`} />
          </div>
        ) : null}
        {cargando ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
        ) : !retiros || retiros.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">Todavía no hay retiros hoy.</p>
        ) : (
          <div className="space-y-2">
            {retiros.rows.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-lg border border-slate-100 p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{r.funcionario} <span className="text-xs font-normal text-slate-400">· {r.hora}</span></p>
                  <p className="truncate text-xs text-slate-500">{r.menu}{r.especial ? " · especial" : ""} · subsidio Gs {gs(r.subsidio)}{r.excedente ? ` · excedente Gs ${gs(r.excedente)}` : ""}</p>
                </div>
                <button onClick={() => void anular(r.id)} disabled={busy} aria-label="Anular" className="rounded-lg p-2 text-slate-300 transition hover:bg-red-50 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Mini({ label, valor }: { label: string; valor: string | number }) {
  return <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p><p className="font-semibold tabular-nums text-slate-800">{valor}</p></div>;
}
