"use client";

/**
 * /manual — Manual de usuario. Muestra las guías del rubro activo que el perfil puede usar: cada guía
 * declara su pantalla, y se aplica la misma regla que al menú (funciones de la empresa + perfil).
 */
import { createContext, Suspense, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, BookOpen, ChevronRight, Lightbulb, Search, X } from "lucide-react";
import { CapaModal } from "@/components/CapaModal";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { rubroDe } from "@/modules/configuracion/funciones";
import { GRUPOS, GUIAS, type Bloque, type Guia } from "@/modules/manual/contenido";
import marcasJson from "@/modules/manual/marcas.json";
import { pantallaDeRuta, pantallasCatalogo, perfilVePantalla } from "@/modules/registry";

type RubroImagen = "comercio" | "gastronomia";
const MARCAS = marcasJson as unknown as Record<RubroImagen, Record<string, Record<string, { x: number; y: number } | null>>>;
/** Las capturas son por rubro: la de otro rubro solo si la pantalla no existe en el tuyo. */
const carpetaDe = (img: string, rubro: RubroImagen): RubroImagen => (MARCAS[rubro][img] ? rubro : rubro === "comercio" ? "gastronomia" : "comercio");
const ContextoRubro = createContext<RubroImagen>("comercio");

const NOMBRE_RUBRO = { comercio: "Comercio", gastronomia: "Gastronomía", personalizado: "tu negocio" };

function norm(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function textoDeGuia(g: Guia) {
  return norm([g.titulo, g.resumen, ...g.bloques.flatMap((b) => [b.texto, b.consejo, b.ojo, ...(b.pasos ?? []).map((p) => p.t)])].filter(Boolean).join(" "));
}

/** Número del paso: el mismo sobre la imagen y en la lista. */
function Numero({ n, chico = false }: { n: number; chico?: boolean }) {
  return (
    <span className={`inline-grid shrink-0 place-items-center rounded-full bg-rose-600 font-bold text-white ${chico ? "h-5 w-5 text-[11px] ring-2 ring-white sm:h-6 sm:w-6 sm:text-xs" : "h-7 w-7 text-sm"}`}>
      {n}
    </span>
  );
}

function Imagen({ b, desde, onAmpliar }: { b: Bloque; desde: number; onAmpliar: () => void }) {
  return (
    <button type="button" onClick={onAmpliar} aria-label={`Ampliar imagen: ${b.alt ?? ""}`} className="relative block w-full cursor-zoom-in overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm">
      <ImagenConMarcas b={b} desde={desde} />
    </button>
  );
}

function ImagenConMarcas({ b, desde }: { b: Bloque; desde: number }) {
  const rubro = useContext(ContextoRubro);
  const carpeta = carpetaDe(b.img ?? "", rubro);
  const m = MARCAS[carpeta][b.img ?? ""] ?? {};
  return (
    <span className="relative block w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/manual/${carpeta}/${b.img}.webp`} alt={b.alt ?? ""} loading="lazy" className="block h-auto w-full" />
      {(b.pasos ?? []).map((p, i) => {
        const pos = p.marca ? m[p.marca] : null;
        if (!pos) return null;
        return (
          // A la izquierda del botón, para no taparle el texto.
          <span key={i} className="absolute -translate-x-full -translate-y-1/2" style={{ left: `${Math.max(pos.x, 2.5)}%`, top: `${pos.y}%` }}>
            <Numero n={desde + i} chico />
          </span>
        );
      })}
    </span>
  );
}

function Contenido({ guia, onAmpliar }: { guia: Guia; onAmpliar: (b: Bloque, desde: number) => void }) {
  const rubro = useContext(ContextoRubro);
  let cuenta = 0;
  return (
    <div className="space-y-5">
      {guia.bloques.filter((b) => !b.rubro || b.rubro === rubro).map((b, i) => {
        const desde = cuenta + 1;
        cuenta += b.pasos?.length ?? 0;
        return (
          <div key={i} className="space-y-3">
            {b.texto ? <p className="text-[15px] leading-relaxed text-slate-700">{b.texto}</p> : null}
            {b.img ? <Imagen b={b} desde={desde} onAmpliar={() => onAmpliar(b, desde)} /> : null}
            {b.pasos?.length ? (
              <ol className="space-y-2.5">
                {b.pasos.map((p, k) => (
                  <li key={k} className="flex gap-3">
                    <Numero n={desde + k} />
                    <span className="pt-0.5 text-[15px] leading-relaxed text-slate-800">{p.t}</span>
                  </li>
                ))}
              </ol>
            ) : null}
            {b.consejo ? (
              <p className="flex gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm leading-relaxed text-emerald-900">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> <span>{b.consejo}</span>
              </p>
            ) : null}
            {b.ojo ? (
              <p className="flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm leading-relaxed text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> <span>{b.ojo}</span>
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function ManualPage() {
  return (
    <Suspense fallback={null}>
      <Manual />
    </Suspense>
  );
}

function Manual() {
  const me = useUsuario();
  const router = useRouter();
  const params = useSearchParams();
  const idGuia = params.get("guia");
  const [q, setQ] = useState("");
  const [ampliada, setAmpliada] = useState<{ b: Bloque; desde: number } | null>(null);
  const arriba = useRef<HTMLDivElement>(null);

  const rubro = me?.funciones ? rubroDe(me.funciones) : "comercio";
  const rubroImagen: RubroImagen = rubro === "personalizado" ? (me?.funciones?.mesas ? "gastronomia" : "comercio") : rubro;
  const guias = useMemo(() => {
    if (!me) return [];
    const catalogo = pantallasCatalogo();
    return GUIAS.filter((g) => {
      if (g.rubro && g.rubro !== rubroImagen) return false;
      if (!g.ruta) return true;
      if (g.ruta === "/") return true;
      const p = pantallaDeRuta(g.ruta, catalogo);
      return p ? perfilVePantalla(p, me.rol, me.perfil, me.funciones) : false;
    });
  }, [me, rubroImagen]);

  const lista = useMemo(() => {
    const n = norm(q.trim());
    return n ? guias.filter((g) => textoDeGuia(g).includes(n)) : guias;
  }, [guias, q]);

  const guia = guias.find((g) => g.id === idGuia) ?? null;
  const i = guia ? guias.indexOf(guia) : -1;
  const anterior = i > 0 ? guias[i - 1] : null;
  const siguiente = i >= 0 && i < guias.length - 1 ? guias[i + 1] : null;

  useEffect(() => {
    arriba.current?.closest("main")?.scrollTo({ top: 0 });
  }, [idGuia]);

  if (guia) {
    return (
      <ContextoRubro.Provider value={rubroImagen}>
      <div ref={arriba} className="mx-auto max-w-4xl space-y-5 pb-12">
        <Link href="/manual" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-slate-500 no-underline hover:text-slate-800 lg:min-h-0">
          <ArrowLeft className="h-4 w-4" /> Todas las guías
        </Link>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{guia.grupo}</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">{guia.titulo}</h1>
          <p className="mt-1 text-[15px] text-slate-500">{guia.resumen}</p>
        </div>
        <Contenido guia={guia} onAmpliar={(b, desde) => setAmpliada({ b, desde })} />
        {guia.ruta && guia.ruta !== "/" ? (
          <Link href={guia.ruta} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white no-underline">
            Ir a esta pantalla <ArrowRight className="h-4 w-4" />
          </Link>
        ) : null}
        <div className="grid grid-cols-1 gap-2 border-t border-slate-200 pt-4 sm:grid-cols-2">
          {anterior ? (
            <button type="button" onClick={() => router.push(`/manual?guia=${anterior.id}`)} className="min-h-11 rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-slate-300">
              <span className="block text-xs text-slate-400">Anterior</span>
              <span className="text-sm font-medium text-slate-800">{anterior.titulo}</span>
            </button>
          ) : <span className="hidden sm:block" />}
          {siguiente ? (
            <button type="button" onClick={() => router.push(`/manual?guia=${siguiente.id}`)} className="min-h-11 rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-slate-300 sm:text-right">
              <span className="block text-xs text-slate-400">Siguiente</span>
              <span className="text-sm font-medium text-slate-800">{siguiente.titulo}</span>
            </button>
          ) : null}
        </div>
        {ampliada ? (
          <CapaModal onClose={() => setAmpliada(null)} z="z-[120]">
            <div className="relative w-full max-w-6xl overflow-hidden rounded-xl bg-white shadow-xl">
              <button type="button" onClick={() => setAmpliada(null)} aria-label="Cerrar imagen" className="absolute right-2 top-2 z-10 grid h-11 w-11 place-items-center rounded-full bg-slate-900/70 text-white">
                <X className="h-5 w-5" />
              </button>
              <ImagenConMarcas b={ampliada.b} desde={ampliada.desde} />
            </div>
          </CapaModal>
        ) : null}
      </div>
      </ContextoRubro.Provider>
    );
  }

  return (
    <div className="space-y-5 pb-12">
      <EncabezadoPagina kicker="Ayuda" titulo={`Manual de ${NOMBRE_RUBRO[rubro]}`} subtitulo="Elegí qué querés hacer y seguí los pasos. Los números de cada imagen te muestran dónde tocar." />
      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="¿Qué querés hacer? Por ejemplo: devolver un producto" aria-label="Buscar en el manual"
          className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3.5 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-[var(--brand)]" />
      </div>
      {me === null ? <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" /> : null}
      {me && !lista.length ? <p className="text-sm text-slate-500">No encontramos nada con esas palabras. Probá con otra, por ejemplo «caja» o «stock».</p> : null}
      {GRUPOS.map((grupo) => {
        const delGrupo = lista.filter((g) => g.grupo === grupo);
        if (!delGrupo.length) return null;
        return (
          <section key={grupo}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{grupo}</h2>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {delGrupo.map((g) => (
                <Link key={g.id} href={`/manual?guia=${g.id}`} className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5 no-underline transition hover:border-[var(--brand)]">
                  <BookOpen className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-800">{g.titulo}</span>
                    <span className="block text-xs text-slate-500">{g.resumen}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
