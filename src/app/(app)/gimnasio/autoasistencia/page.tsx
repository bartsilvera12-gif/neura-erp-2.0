"use client";

/**
 * /gimnasio/autoasistencia — Que el alumno marque solo (recetas 155 y 156). La lista de alumnos con lo
 * último que hizo cada uno ("Marcó hoy 18:00", "Reservó Yoga mañana", "Todavía no tiene su link") y un
 * solo botón: mandarle su link por WhatsApp. Con su link reserva y marca su asistencia desde el celular.
 * Filtros: Todos, Sin link (no se le mandó) y Deben.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, MessageCircle, Search } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { copiarLinkAlumno, enviarLinkWhatsApp } from "@/modules/gimnasio/ui";
import { gs, hora } from "@/modules/gimnasio/tipos";

type Alumno = {
  id: string; nombre: string; documento: string | null; telefono: string | null; enviado: boolean; tiene_link: boolean;
  deuda_vencida: number; bloqueado: boolean;
  ultima: { clase: string; fecha: string; hora: string | null } | null;
  proxima: { clase: string; inicio_at: string } | null;
  membresia: { plan: string; clases_mes: number | null; usadas: number } | null;
};
type Filtro = "todos" | "sin_link" | "deben";
type Lista = { alumnos: Alumno[]; totales: Record<Filtro, number> };

const FILTROS: { id: Filtro; label: string }[] = [{ id: "todos", label: "Todos" }, { id: "sin_link", label: "Sin link" }, { id: "deben", label: "Deben" }];
const TZ = "America/Asuncion";
const fechaPY = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
function cuando(iso: string): string {
  const f = fechaPY(new Date(iso));
  const hoy = new Date();
  const man = new Date(hoy.getTime() + 86_400_000);
  const dia = f === fechaPY(hoy) ? "hoy" : f === fechaPY(man) ? "mañana" : new Date(iso).toLocaleDateString("es-PY", { weekday: "long", timeZone: TZ });
  return `${dia} ${hora(iso)}`;
}
const iniciales = (n: string) => n.replace(/^PRUEBA\s+/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");

function estado(a: Alumno): { texto: string; tono: string } {
  if (a.deuda_vencida > 0) return { texto: `Debe ${gs(a.deuda_vencida)}`, tono: "text-rose-700" };
  if (a.proxima) return { texto: `Reservó ${a.proxima.clase} ${cuando(a.proxima.inicio_at)}`, tono: "text-slate-500" };
  if (a.ultima) {
    const hoy = a.ultima.fecha === fechaPY(new Date());
    return { texto: hoy && a.ultima.hora ? `Marcó hoy ${hora(a.ultima.hora)}` : `Vino el ${new Date(`${a.ultima.fecha}T12:00:00`).toLocaleDateString("es-PY", { day: "numeric", month: "numeric" })}`, tono: "text-slate-500" };
  }
  return a.enviado ? { texto: "Todavía no usó su link", tono: "text-slate-400" } : { texto: "Todavía no tiene su link", tono: "text-slate-400" };
}

function Fila({ a, onEnviado }: { a: Alumno; onEnviado: (id: string) => void }) {
  const [ocupado, setOcupado] = useState<"wa" | "copiar" | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function correr(cual: "wa" | "copiar") {
    setOcupado(cual); setError(null);
    try {
      if (cual === "wa") await enviarLinkWhatsApp(a.id);
      else { await copiarLinkAlumno(a.id); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }
      onEnviado(a.id);
    } catch (e) { setError((e as Error).message); } finally { setOcupado(null); }
  }
  const e = estado(a);
  const m = a.membresia;
  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold ${a.deuda_vencida > 0 ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"}`}>{iniciales(a.nombre) || "?"}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-900">{a.nombre}</span>
          <span className={`block truncate text-xs ${e.tono}`}>{e.texto}{m?.clases_mes ? <span className="text-slate-400"> · {m.usadas} de {m.clases_mes}</span> : null}</span>
        </span>
        {a.enviado ? (
          <span className="flex shrink-0 items-center">
            <button type="button" aria-label="Copiar link" title="Copiar link" disabled={!!ocupado} onClick={() => void correr("copiar")}
              className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50">
              {ocupado === "copiar" ? <Loader2 className="h-4 w-4 animate-spin" /> : copiado ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            </button>
            <button type="button" title="Mandar de nuevo" disabled={!!ocupado} onClick={() => void correr("wa")}
              className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
              {ocupado === "wa" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />} Enviado
            </button>
          </span>
        ) : (
          <button type="button" disabled={!!ocupado} onClick={() => void correr("wa")}
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:opacity-50">
            {ocupado === "wa" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />} Enviar link
          </button>
        )}
      </div>
      {error ? <p role="alert" className="mt-1 break-all pl-[52px] text-xs text-rose-700">{error}</p> : null}
    </li>
  );
}

export default function AutoasistenciaPage() {
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [d, setD] = useState<Lista | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback((texto: string, f: Filtro) => {
    const sp = new URLSearchParams({ filtro: f });
    if (texto.trim()) sp.set("q", texto.trim());
    apiFetch<Lista>(`/api/gimnasio/alumnos?${sp}`).then((x) => { setD(x); setError(null); }).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    const t = setTimeout(() => cargar(q, filtro), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, filtro, cargar]);

  function enviado(id: string) {
    setD((x) => {
      if (!x) return x;
      const antes = x.alumnos.find((a) => a.id === id);
      if (!antes || antes.enviado) return x;
      return { totales: { ...x.totales, sin_link: Math.max(0, x.totales.sin_link - 1) }, alumnos: x.alumnos.map((a) => (a.id === id ? { ...a, enviado: true, tiene_link: true } : a)) };
    });
  }

  return (
    <div className="space-y-4 pb-10">
      <EncabezadoPagina kicker="Asistencia" titulo="Que el alumno marque solo" volver={{ href: "/gimnasio/panel", label: "Asistencia" }}
        subtitulo="Mandale a cada alumno su link: con él reserva sus clases y marca su asistencia desde el celular." />
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative block min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar alumno" aria-label="Buscar alumno"
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-100,#d7efee)]" />
          </label>
          <div className="flex gap-1.5 overflow-x-auto">
            {FILTROS.map((f) => (
              <button key={f.id} type="button" onClick={() => setFiltro(f.id)}
                className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition ${filtro === f.id ? "bg-[var(--brand)] text-white" : "border border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                {f.label}{d ? <span className={filtro === f.id ? "text-white/80" : "text-slate-400"}>{d.totales[f.id]}</span> : null}
              </button>
            ))}
          </div>
        </div>
        {error ? <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
        {!d && !error ? <div className="mt-3 h-64 animate-pulse rounded-xl bg-slate-50" /> : null}
        {d ? (d.alumnos.length ? (
          <ul className="m-0 mt-2 list-none divide-y divide-slate-100 p-0">{d.alumnos.map((a) => <Fila key={a.id} a={a} onEnviado={enviado} />)}</ul>
        ) : (
          <p className="py-10 text-center text-sm text-slate-500">{q ? "Ningún alumno coincide." : filtro === "sin_link" ? "Todos tienen su link." : filtro === "deben" ? "Nadie debe." : "Todavía no hay alumnos."}</p>
        )) : null}
      </section>
    </div>
  );
}
