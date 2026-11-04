"use client";

/**
 * /sorteos/<id>/en-vivo — Pantalla para transmitir el sorteo digital (receta 123). Ocupa toda la
 * pantalla: elegís el premio, tocás "Sortear", los números giran unos segundos y aparece el ganador
 * (número, nombre corto y ciudad). El resultado lo decide la base (sorteo verificable), no la animación.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dices, Loader2, Maximize2, ShieldCheck, Trophy, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import type { Premio, Sorteo } from "@/modules/sorteos/tipos";

const corto = (nombre: string | null) => {
  const p = (nombre ?? "").trim().split(/\s+/);
  return p.length ? `${p[0]}${p[1] ? ` ${p[1][0]}.` : ""}` : "";
};

export default function SorteoEnVivoPage() {
  const { id } = useParams<{ id: string }>();
  const [s, setS] = useState<Sorteo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elegido, setElegido] = useState<string | null>(null);
  const [girando, setGirando] = useState(false);
  const [visor, setVisor] = useState<string>("");
  const [revelado, setRevelado] = useState<Premio | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const cargar = useCallback(async () => {
    try {
      const d = await apiFetch<Sorteo>(`/api/sorteos/${id}`);
      setS(d);
      // Por defecto el premio más chico que falta (se sortea del último al primero).
      const faltan = d.premios.filter((p) => !p.numero_ganador);
      setElegido((e) => (e && faltan.some((p) => p.id === e) ? e : faltan.at(-1)?.id ?? null));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  async function sortear() {
    if (!s || !elegido || girando) return;
    setError(null);
    setRevelado(null);
    setGirando(true);
    const largo = String(s.numero_hasta).length;
    timer.current = setInterval(() => {
      const n = s.numero_desde + Math.floor(Math.random() * (s.numero_hasta - s.numero_desde + 1));
      setVisor(String(n).padStart(largo, "0"));
    }, 60);
    const inicio = Date.now();
    try {
      const r = await apiFetch<Sorteo>(`/api/sorteos/premios/${elegido}`, { method: "POST", body: JSON.stringify({ accion: "sortear" }) });
      // Que gire al menos 4 segundos: es para la transmisión.
      await new Promise((ok) => setTimeout(ok, Math.max(0, 4000 - (Date.now() - inicio))));
      const p = r.premios.find((x) => x.id === elegido) ?? null;
      if (timer.current) clearInterval(timer.current);
      setVisor(p?.numero_ganador ?? "");
      setRevelado(p);
      setS(r);
      const faltan = r.premios.filter((x) => !x.numero_ganador);
      setElegido(faltan.at(-1)?.id ?? null);
    } catch (e) {
      if (timer.current) clearInterval(timer.current);
      setVisor("");
      setError((e as Error).message);
    } finally {
      setGirando(false);
    }
  }

  const pantallaCompleta = () => { void document.documentElement.requestFullscreen?.().catch(() => {}); };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-gradient-to-b from-slate-950 via-slate-900 to-[color-mix(in_srgb,var(--brand)_45%,#0f172a)] text-white">
      <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-8 sm:py-5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/60">Sorteo en vivo</p>
          <h1 className="truncate text-lg font-bold sm:text-2xl">{s?.nombre ?? "…"}</h1>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={pantallaCompleta} className="hidden min-h-11 items-center gap-1.5 rounded-xl bg-white/10 px-3 text-sm font-semibold hover:bg-white/20 sm:inline-flex"><Maximize2 className="h-4 w-4" /> Pantalla completa</button>
          <Link href={`/sorteos/${id}`} aria-label="Salir" className="grid h-11 w-11 place-items-center rounded-xl bg-white/10 text-white no-underline hover:bg-white/20"><X className="h-5 w-5" /></Link>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 pb-8 text-center sm:gap-8">
        {s && s.estado !== "cerrado" && s.estado !== "sorteado" ? (
          <p className="rounded-2xl bg-white/10 px-5 py-4 text-sm">Primero cerrá la venta del sorteo. Después volvé a esta pantalla.</p>
        ) : null}

        {s ? (
          <div className="flex max-w-full flex-wrap justify-center gap-2" role="radiogroup" aria-label="Premio a sortear">
            {s.premios.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={elegido === p.id} disabled={!!p.numero_ganador || girando} onClick={() => setElegido(p.id)}
                className={`min-h-11 rounded-full px-4 text-sm font-semibold transition ${p.numero_ganador ? "bg-amber-400/20 text-amber-200 line-through decoration-amber-200/60" : elegido === p.id ? "bg-white text-slate-900" : "bg-white/10 text-white hover:bg-white/20"}`}>
                {p.posicion}° · {p.nombre}
              </button>
            ))}
          </div>
        ) : <Loader2 className="h-8 w-8 animate-spin text-white/60" />}

        <div className="w-full max-w-3xl rounded-[2rem] border border-white/15 bg-white/5 px-4 py-8 shadow-2xl backdrop-blur sm:px-10 sm:py-12">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-white/50">{revelado ? `Ganador del ${revelado.posicion}° premio` : girando ? "Sorteando…" : "Número ganador"}</p>
          <p className={`mt-3 font-black tabular-nums tracking-[0.15em] ${revelado ? "text-amber-300" : "text-white"} text-[clamp(3rem,16vw,9rem)] leading-none`} aria-live="polite">
            {visor || "— — —"}
          </p>
          {revelado ? (
            <div className="mt-5 space-y-1">
              <p className="flex items-center justify-center gap-2 text-2xl font-bold sm:text-3xl"><Trophy className="h-7 w-7 text-amber-300" /> {corto(revelado.ganador)}</p>
              <p className="text-white/70">{revelado.nombre}</p>
            </div>
          ) : null}
        </div>

        {error ? <p className="rounded-xl bg-rose-500/20 px-4 py-3 text-sm text-rose-100">{error}</p> : null}

        {s && s.estado === "cerrado" && elegido ? (
          <button type="button" onClick={sortear} disabled={girando}
            className="inline-flex min-h-14 items-center gap-2 rounded-2xl bg-amber-400 px-8 text-lg font-bold text-slate-900 shadow-lg transition hover:bg-amber-300 active:scale-[0.98] disabled:opacity-60">
            {girando ? <Loader2 className="h-6 w-6 animate-spin" /> : <Dices className="h-6 w-6" />} Sortear {s.premios.find((p) => p.id === elegido)?.posicion}° premio
          </button>
        ) : null}
        {s && s.estado === "sorteado" ? <p className="text-lg font-semibold text-amber-200">¡Sorteo terminado! Todos los premios tienen ganador.</p> : null}

        {s?.semilla_hash ? (
          <p className="flex max-w-2xl items-start gap-2 text-left text-[11px] text-white/50">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Sorteo verificable. Huella publicada al activar: <span className="break-all font-mono">{s.semilla_hash}</span></span>
          </p>
        ) : null}
      </main>
    </div>
  );
}
