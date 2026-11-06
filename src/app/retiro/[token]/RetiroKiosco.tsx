"use client";

/** Terminal de autoservicio del comedor: el funcionario pone su CI, ve su menú y confirma el retiro. */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, UtensilsCrossed } from "lucide-react";

type Estado = {
  ok: boolean;
  funcionario: { id: string; nombre: string };
  fecha: string;
  reservo: boolean;
  reserva: { opcion_id: string; nombre: string; especial: boolean } | null;
  reserva_propio: boolean;
  ya_retiro: boolean;
  saldo: { subsidio: number; disponible: number };
  retiro?: { menu: string; especial: boolean };
};

const gs = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-PY");

async function pub(token: string, accion: "identificar" | "confirmar", documento: string): Promise<Estado> {
  const res = await fetch(`/api/publico/comedor-retiro/${token}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion, documento }),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || j?.ok === false) throw new Error(j?.error?.message || "No se pudo completar");
  return j.data as Estado;
}

export function RetiroKiosco({ token }: { token: string }) {
  const [documento, setDocumento] = useState("");
  const [estado, setEstado] = useState<Estado | null>(null);
  const [confirmado, setConfirmado] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reiniciar = useCallback(() => {
    setDocumento(""); setEstado(null); setConfirmado(false); setError(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Vuelve solo a la pantalla inicial unos segundos después de un retiro (kiosco).
  useEffect(() => {
    if (!confirmado) return;
    const t = setTimeout(reiniciar, 6000);
    return () => clearTimeout(t);
  }, [confirmado, reiniciar]);

  async function identificar() {
    setBusy(true); setError(null);
    try { setEstado(await pub(token, "identificar", documento.trim())); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function confirmar() {
    setBusy(true); setError(null);
    try { setEstado(await pub(token, "confirmar", documento.trim())); setConfirmado(true); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl text-white" style={{ backgroundColor: "var(--brand)" }}><UtensilsCrossed className="h-7 w-7" /></div>
          <h1 className="text-xl font-bold text-slate-900">Retiro de almuerzo</h1>
        </div>

        {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-center text-sm text-red-700">{error}</div> : null}

        {!estado ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <label className="block text-center text-base font-medium text-slate-700">Pasá tu cédula</label>
            <input
              ref={inputRef}
              autoFocus
              value={documento}
              inputMode="numeric"
              onChange={(e) => setDocumento(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && documento.trim().length >= 3) void identificar(); }}
              placeholder="Cédula (sin puntos)"
              className="mt-3 min-h-14 w-full rounded-2xl border border-slate-200 px-4 text-center text-2xl tabular-nums tracking-wide outline-none focus:border-[var(--brand)]"
            />
            <button onClick={() => void identificar()} disabled={busy || documento.trim().length < 3} className="mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl text-lg font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand)" }}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : null} Continuar
            </button>
          </div>
        ) : confirmado && estado.retiro ? (
          <Tarjeta tono="ok">
            <Check className="mx-auto h-14 w-14 text-emerald-600" />
            <p className="mt-3 text-center text-lg font-semibold text-slate-900">¡Listo, {primerNombre(estado.funcionario.nombre)}!</p>
            <p className="mt-1 text-center text-slate-600">Retiraste: <span className="font-medium">{estado.retiro.menu}</span></p>
            <Siguiente onClick={reiniciar} />
          </Tarjeta>
        ) : estado.ya_retiro ? (
          <Tarjeta tono="info">
            <AlertTriangle className="mx-auto h-12 w-12 text-amber-500" />
            <p className="mt-3 text-center text-lg font-semibold text-slate-900">Ya retiraste hoy</p>
            <p className="mt-1 text-center text-slate-600">{estado.funcionario.nombre}</p>
            <Siguiente onClick={reiniciar} />
          </Tarjeta>
        ) : estado.reserva ? (
          <Tarjeta>
            <p className="text-center text-slate-600">Hola, <span className="font-semibold text-slate-900">{primerNombre(estado.funcionario.nombre)}</span></p>
            <p className="mt-1 text-center text-sm text-slate-400">Reservaste para hoy</p>
            <div className="mt-3 rounded-xl border border-[var(--brand)]/20 bg-[var(--brand-50)] p-4 text-center">
              <p className="text-lg font-semibold text-slate-900">{estado.reserva.nombre}</p>
              {estado.reserva.especial ? <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Especial</span> : null}
            </div>
            <button onClick={() => void confirmar()} disabled={busy} className="mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl text-lg font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand)" }}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />} Confirmar retiro
            </button>
            <button onClick={reiniciar} className="mt-2 min-h-11 w-full text-sm font-medium text-slate-400 hover:text-slate-600">No soy yo</button>
          </Tarjeta>
        ) : (
          <Tarjeta tono="info">
            <AlertTriangle className="mx-auto h-12 w-12 text-amber-500" />
            <p className="mt-3 text-center text-lg font-semibold text-slate-900">{estado.reserva_propio ? "Reservaste traer tu almuerzo" : "No reservaste almuerzo para hoy"}</p>
            <p className="mt-1 text-center text-slate-600">{estado.funcionario.nombre}</p>
            {!estado.reserva_propio ? <p className="mt-1 text-center text-sm text-slate-400">Para retirar tenés que reservar en el enlace del menú.</p> : null}
            <Siguiente onClick={reiniciar} />
          </Tarjeta>
        )}
      </div>
    </div>
  );
}

function Tarjeta({ tono, children }: { tono?: "ok" | "info"; children: React.ReactNode }) {
  const borde = tono === "ok" ? "border-emerald-200" : tono === "info" ? "border-amber-200" : "border-slate-200";
  return <div className={`rounded-2xl border ${borde} bg-white p-6 shadow-sm`}>{children}</div>;
}
function Siguiente({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} className="mt-4 min-h-12 w-full rounded-2xl border border-slate-200 text-base font-semibold text-slate-700 hover:bg-slate-50">Siguiente</button>;
}
function primerNombre(n: string) { return n.split(/\s+/)[0] || n; }
