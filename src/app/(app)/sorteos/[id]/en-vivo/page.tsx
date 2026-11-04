"use client";

/**
 * /sorteos/<id>/en-vivo — Pantalla para transmitir el sorteo digital (receta 123). Ocupa toda la
 * pantalla: elegís el premio, tocás "Sortear", los números giran unos segundos y aparece el ganador
 * (número, nombre corto y ciudad). El resultado lo decide la base (sorteo verificable), no la animación.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Dices, Loader2, Maximize2, ShieldCheck, Trophy, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import type { Premio, Sorteo } from "@/modules/sorteos/tipos";

const corto = (nombre: string | null) => {
  const p = (nombre ?? "").trim().split(/\s+/);
  return p.length ? `${p[0]}${p[1] ? ` ${p[1][0]}.` : ""}` : "";
};

/**
 * Colores de la marca del cliente (cliente.config → --brand): un tono claro, la marca y uno oscuro.
 * Animaciones de la transmisión (sin animación si el equipo pide menos movimiento).
 */
const ESTILOS = `
.ev-raiz { --ev-claro: color-mix(in srgb, var(--brand) 35%, white); --ev-medio: color-mix(in srgb, var(--brand) 70%, white); --ev-oscuro: color-mix(in srgb, var(--brand) 75%, black); }
.ev-texto-claro { color: var(--ev-claro) }
.ev-tarjeta-ganador { border-color: color-mix(in srgb, var(--brand) 55%, white); background: linear-gradient(to bottom, color-mix(in srgb, var(--brand) 30%, transparent), rgba(255,255,255,.05)) }
.ev-halo { background: color-mix(in srgb, var(--brand) 45%, transparent) }
.ev-ficha-color { background: linear-gradient(to bottom, var(--ev-medio), var(--brand) 55%, var(--ev-oscuro)); color: white; box-shadow: inset 0 2px 0 rgba(255,255,255,.35); outline: 2px solid color-mix(in srgb, var(--brand) 25%, white); outline-offset: -2px; text-shadow: 0 2px 6px rgba(0,0,0,.25) }
.ev-chip-hecho { background: color-mix(in srgb, var(--brand) 25%, transparent); color: var(--ev-claro) }
.ev-chip-hecho:hover { background: color-mix(in srgb, var(--brand) 40%, transparent) }
.ev-chip-activo { background: var(--brand); color: white }
.ev-boton { background: var(--brand); color: white }
.ev-boton:hover { background: var(--ev-oscuro) }
.ev-borde-imagen { border-color: var(--ev-medio); box-shadow: 0 0 60px color-mix(in srgb, var(--brand) 45%, transparent) }
@keyframes ev-ficha { 0% { transform: translateY(18px) scale(.6) rotateX(70deg); opacity: 0 } 70% { transform: translateY(-4px) scale(1.06) rotateX(0) } 100% { transform: none; opacity: 1 } }
@keyframes ev-aparece { from { transform: translateY(12px); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes ev-cae { 0% { transform: translate3d(0,-20px,0) rotate(0); opacity: 1 } 85% { opacity: 1 } 100% { transform: translate3d(var(--dx), 640px, 0) rotate(var(--giro)); opacity: 0 } }
@keyframes ev-brillo { 0%,100% { filter: drop-shadow(0 0 0 transparent) } 50% { filter: drop-shadow(0 0 22px color-mix(in srgb, var(--brand) 60%, white)) } }
.ev-ficha { animation: ev-ficha .55s cubic-bezier(.2,.9,.3,1.3) both }
.ev-ficha-ganadora { animation: ev-ficha .55s cubic-bezier(.2,.9,.3,1.3) both, ev-brillo 2.4s ease-in-out 1s infinite }
.ev-aparece { animation: ev-aparece .5s ease-out both }
.ev-tarde { animation-delay: .7s }
.ev-papel { position: absolute; top: 0; width: 9px; height: 14px; border-radius: 2px; animation: ev-cae var(--dur) cubic-bezier(.25,.6,.4,1) var(--demora) both }
@media (prefers-reduced-motion: reduce) { .ev-ficha, .ev-ficha-ganadora, .ev-aparece, .ev-papel { animation: none !important } .ev-papel { display: none } }
`;

/** Cada cifra en su ficha. Girando: cifras que cambian; revelado: aparecen de a una y brillan. */
function Fichas({ texto, largo, girando, revelado }: { texto: string; largo: number; girando: boolean; revelado: boolean }) {
  const cifras = (texto || "").split("");
  const n = Math.max(cifras.length, Math.min(Math.max(largo, 1), 7));
  const lista = cifras.length ? cifras : Array.from({ length: n }, () => "");
  return (
    <div className="flex justify-center gap-2 sm:gap-3" style={{ perspective: "800px" }}>
      {lista.map((c, i) => (
        <span key={`${revelado ? "r" : "g"}-${i}-${revelado ? texto : ""}`}
          className={`grid place-items-center rounded-2xl font-black tabular-nums leading-none
            h-[clamp(4.25rem,min(17vw,16vh),9rem)] w-[clamp(3rem,min(12vw,11vh),6.5rem)] text-[clamp(2.5rem,min(11vw,11vh),6rem)]
            ${revelado ? "ev-ficha-ganadora ev-ficha-color"
              : girando ? "bg-white/10 text-white blur-[1px] ring-1 ring-white/15" : "bg-white/[0.06] text-white/25 ring-1 ring-white/10"}`}
          style={revelado ? { animationDelay: `${i * 0.18}s` } : undefined}>
          {c || "–"}
        </span>
      ))}
    </div>
  );
}

// Papelitos en tonos de la marca, con blanco.
const COLORES = ["var(--brand)", "var(--ev-claro)", "#ffffff", "var(--ev-medio)", "var(--ev-oscuro)", "#ffffff"];
/** Papelitos de festejo (se vuelven a tirar con cada ganador). */
function Confeti({ clave }: { clave: string }) {
  const [papeles] = useState(() =>
    Array.from({ length: 70 }, (_, i) => ({
      left: Math.random() * 100, dx: `${(Math.random() - 0.5) * 160}px`, giro: `${(Math.random() - 0.5) * 900}deg`,
      dur: `${2.4 + Math.random() * 2.2}s`, demora: `${Math.random() * 0.9}s`, color: COLORES[i % COLORES.length], ancho: 6 + Math.random() * 6,
    })),
  );
  return (
    <div key={clave} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {papeles.map((p, i) => (
        <span key={i} className="ev-papel" style={{
          left: `${p.left}%`, width: p.ancho, background: p.color,
          ["--dx" as string]: p.dx, ["--giro" as string]: p.giro, ["--dur" as string]: p.dur, ["--demora" as string]: p.demora,
        } as React.CSSProperties} />
      ))}
    </div>
  );
}

export default function SorteoEnVivoPage() {
  const { id } = useParams<{ id: string }>();
  const [s, setS] = useState<Sorteo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elegido, setElegido] = useState<string | null>(null);
  const [girando, setGirando] = useState(false);
  const [visor, setVisor] = useState<string>("");
  const [revelado, setRevelado] = useState<Premio | null>(null);
  // Se monta en <body>: tapa el menú y la barra del ERP (es para transmitir).
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const cargar = useCallback(async () => {
    try {
      const d = await apiFetch<Sorteo>(`/api/sorteos/${id}`);
      setS(d);
      // Por defecto el premio más chico que falta (se sortea del último al primero).
      const faltan = d.premios.filter((p) => !p.numero_ganador);
      setElegido((e) => (e && faltan.some((p) => p.id === e) ? e : faltan.at(-1)?.id ?? null));
      // Ya terminado: se muestra el ganador del 1° premio (los otros, tocando su premio).
      if (!faltan.length) {
        const primero = [...d.premios].sort((a, b) => a.posicion - b.posicion)[0];
        if (primero?.numero_ganador) { setRevelado(primero); setVisor(primero.numero_ganador); }
      }
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

  if (!montado) return null;
  return createPortal(
    <div className="ev-raiz fixed inset-0 z-[1000] flex flex-col overflow-y-auto bg-gradient-to-b from-slate-950 via-slate-900 to-[color-mix(in_srgb,var(--brand)_45%,#0f172a)] text-white">
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
              <button key={p.id} type="button" role="radio" aria-checked={p.numero_ganador ? revelado?.id === p.id : elegido === p.id} disabled={girando}
                // Un premio ya sorteado se toca para volver a mostrar su ganador.
                onClick={() => (p.numero_ganador ? (setRevelado(p), setVisor(p.numero_ganador)) : (setElegido(p.id), setRevelado(null), setVisor("")))}
                className={`min-h-11 rounded-full px-4 text-sm font-semibold transition ${p.numero_ganador ? (revelado?.id === p.id ? "ev-chip-activo" : "ev-chip-hecho") : elegido === p.id && !revelado ? "bg-white text-slate-900" : "bg-white/10 text-white hover:bg-white/20"}`}>
                {p.posicion}° · {p.nombre}{p.numero_ganador ? " ✓" : ""}
              </button>
            ))}
          </div>
        ) : <Loader2 className="h-8 w-8 animate-spin text-white/60" />}

        <div className={`relative w-full max-w-4xl overflow-hidden rounded-[2rem] border px-4 py-8 shadow-2xl backdrop-blur sm:px-10 sm:py-10 ${revelado ? "ev-tarjeta-ganador" : "border-white/15 bg-white/5"}`}>
          {revelado ? <Confeti clave={`${revelado.id}-${visor}`} /> : null}
          {revelado ? <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full ev-halo blur-3xl" /> : null}

          <div className={`relative grid items-center gap-4 sm:gap-8 ${revelado?.imagen_url ? "md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]" : ""}`}>
            {revelado?.imagen_url ? (
              <div className="ev-aparece mx-auto w-full max-w-[8.5rem] md:max-w-none">
                <div className="overflow-hidden rounded-3xl border-4 ev-borde-imagen bg-white/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={revelado.imagen_url} alt={revelado.nombre} className="aspect-square w-full object-cover" />
                </div>
              </div>
            ) : null}

            <div className="min-w-0">
              <p className={`text-xs font-bold uppercase tracking-[0.35em] sm:text-sm ${revelado ? "ev-texto-claro" : "text-white/50"}`}>
                {revelado ? `${revelado.posicion}° premio · ${revelado.nombre}` : girando ? "Sorteando…" : "Número ganador"}
              </p>
              {revelado ? <p className="ev-aparece mt-2 text-3xl font-black tracking-tight text-white sm:text-5xl">¡Tenemos ganador!</p> : null}

              <div className="mt-5" aria-live="polite">
                <Fichas texto={visor} largo={String(s?.numero_hasta ?? 1000).length} girando={girando} revelado={!!revelado} />
              </div>

              {revelado ? (
                <div className="ev-aparece ev-tarde mt-6 space-y-2">
                  <p className="flex items-center justify-center gap-3 text-3xl font-extrabold sm:text-4xl">
                    <Trophy className="ev-texto-claro h-8 w-8 shrink-0 sm:h-10 sm:w-10" /> <span className="min-w-0 break-words">{corto(revelado.ganador)}</span>
                  </p>
                  <div className="flex flex-wrap justify-center gap-2 text-xs font-semibold sm:text-sm">
                    {revelado.orden_numero ? <span className="rounded-full bg-white/10 px-3 py-1 text-white/80">Compra N° {revelado.orden_numero}</span> : null}
                    <span className="rounded-full bg-white/10 px-3 py-1 text-white/80">
                      {revelado.metodo === "urna" ? "Salió de la urna" : revelado.metodo === "externo" ? "Sorteo externo" : "Sorteo digital verificable"}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <style>{ESTILOS}</style>

        {error ? <p className="rounded-xl bg-rose-500/20 px-4 py-3 text-sm text-rose-100">{error}</p> : null}

        {s && s.estado === "cerrado" && elegido ? (
          <button type="button" onClick={sortear} disabled={girando}
            className="inline-flex min-h-14 items-center gap-2 rounded-2xl ev-boton px-8 text-lg font-bold shadow-lg ring-2 ring-white/20 transition active:scale-[0.98] disabled:opacity-60">
            {girando ? <Loader2 className="h-6 w-6 animate-spin" /> : <Dices className="h-6 w-6" />} Sortear {s.premios.find((p) => p.id === elegido)?.posicion}° premio
          </button>
        ) : null}
        {s && s.estado === "sorteado" ? <p className="ev-texto-claro text-lg font-semibold">¡Sorteo terminado! Todos los premios tienen ganador.</p> : null}

        {s?.semilla_hash ? (
          <p className="flex max-w-2xl items-start gap-2 text-left text-[11px] text-white/50">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Sorteo verificable. Huella publicada al activar: <span className="break-all font-mono">{s.semilla_hash}</span></span>
          </p>
        ) : null}
      </main>
    </div>,
    document.body,
  );
}
