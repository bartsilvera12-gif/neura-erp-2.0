"use client";

/** Página pública (sin login) para que el funcionario elija su menú de la semana por CI. */
import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, UtensilsCrossed } from "lucide-react";

type OpcionMenu = { id: string; nombre: string; especial: boolean };
type DiaMenu = { dia: number; fecha: string; opciones: OpcionMenu[] };
type Menu = { empresa_nombre: string; semana_inicio: string; cierre_at: string | null; cerrado: boolean; dias: DiaMenu[] };
type MisReservas = { ok: boolean; funcionario: { nombre: string }; reservas: Record<string, string> };

const DIAS = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];
const fmt = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("es-PY", { weekday: "long", day: "2-digit", month: "long" });

async function pub<T>(token: string, body?: object): Promise<T> {
  const res = await fetch(`/api/publico/comedor/${token}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || j?.ok === false) throw new Error(j?.error?.message || "No se pudo completar");
  return j.data as T;
}

export function ReservaCliente({ token }: { token: string }) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [cargandoMenu, setCargandoMenu] = useState(true);
  const [errorMenu, setErrorMenu] = useState<string | null>(null);

  const [documento, setDocumento] = useState("");
  const [funcionario, setFuncionario] = useState<string | null>(null);
  const [reservas, setReservas] = useState<Record<string, string>>({});
  const [identificando, setIdentificando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);

  useEffect(() => {
    pub<Menu>(token).then(setMenu).catch((e) => setErrorMenu((e as Error).message)).finally(() => setCargandoMenu(false));
  }, [token]);

  const identificar = useCallback(async () => {
    setIdentificando(true);
    setError(null);
    try {
      const r = await pub<MisReservas>(token, { accion: "identificar", documento: documento.trim() });
      setFuncionario(r.funcionario.nombre);
      setReservas(r.reservas ?? {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIdentificando(false);
    }
  }, [token, documento]);

  async function reservar(fecha: string, opcionId: string | null) {
    setGuardando(fecha);
    setError(null);
    try {
      const r = await pub<MisReservas>(token, { accion: "reservar", documento: documento.trim(), fecha, opcion_id: opcionId });
      setReservas(r.reservas ?? {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(null);
    }
  }

  if (cargandoMenu) return <Centro><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></Centro>;
  if (errorMenu || !menu) return <Centro><p className="text-sm text-slate-500">{errorMenu || "Enlace no disponible"}</p></Centro>;

  const cerrado = menu.cerrado;

  return (
    <div className="mx-auto min-h-dvh max-w-xl px-4 py-6 pb-16">
      <header className="mb-5 flex items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white" style={{ backgroundColor: "var(--brand)" }}><UtensilsCrossed className="h-5 w-5" /></div>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-slate-900">Menú del comedor</h1>
          <p className="truncate text-sm text-slate-500">{menu.empresa_nombre} · semana del {new Date(menu.semana_inicio + "T00:00:00").toLocaleDateString("es-PY", { day: "2-digit", month: "long" })}</p>
        </div>
      </header>

      {cerrado ? <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Las reservas de esta semana ya cerraron. Podés ver el menú pero no cambiar tu elección.</div> : null}
      {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      {!funcionario ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <label className="block text-sm font-medium text-slate-700">Ingresá tu cédula para elegir</label>
          <div className="mt-2 flex gap-2">
            <input
              value={documento}
              inputMode="numeric"
              onChange={(e) => setDocumento(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && documento.trim()) void identificar(); }}
              placeholder="Cédula (sin puntos)"
              className="min-h-12 w-full rounded-xl border border-slate-200 px-4 text-base outline-none focus:border-[var(--brand)]"
            />
            <button onClick={() => void identificar()} disabled={identificando || documento.trim().length < 3} className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-xl px-5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand)" }}>
              {identificando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Entrar
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2.5">
            <p className="text-sm text-slate-600">Hola, <span className="font-semibold text-slate-900">{funcionario}</span></p>
            <button onClick={() => { setFuncionario(null); setDocumento(""); setReservas({}); }} className="text-xs font-medium text-slate-400 hover:text-slate-600">Cambiar</button>
          </div>

          {menu.dias.map((d) => {
            const elegido = reservas[d.fecha];
            return (
              <div key={d.fecha} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="mb-3 text-sm font-semibold capitalize text-slate-800">{fmt(d.fecha)}</p>
                <div className="space-y-2">
                  {d.opciones.map((o) => (
                    <OpcionBtn key={o.id} activo={elegido === o.id} cargando={guardando === d.fecha} disabled={cerrado} onClick={() => reservar(d.fecha, o.id)}>
                      <span>{o.nombre}</span>
                      {o.especial ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Especial</span> : null}
                    </OpcionBtn>
                  ))}
                  {d.opciones.length === 0 ? <p className="text-sm text-slate-400">Sin menú cargado para este día.</p> : (
                    <OpcionBtn activo={elegido === "propio"} cargando={guardando === d.fecha} disabled={cerrado} onClick={() => reservar(d.fecha, null)}>
                      <span className="text-slate-500">Traigo mi propio almuerzo</span>
                    </OpcionBtn>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OpcionBtn({ activo, cargando, disabled, onClick, children }: { activo: boolean; cargando: boolean; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || cargando}
      className={`flex min-h-12 w-full items-center justify-between gap-2 rounded-xl border px-4 text-left text-sm transition disabled:opacity-60 ${activo ? "border-transparent bg-[var(--brand)] text-white shadow-sm" : "border-slate-200 bg-white text-slate-800 hover:border-[var(--brand)]/50"}`}
    >
      <span className="flex min-w-0 items-center">{children}</span>
      {cargando ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : activo ? <Check className="h-5 w-5 shrink-0" /> : null}
    </button>
  );
}

function Centro({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-dvh place-items-center p-6">{children}</div>;
}
