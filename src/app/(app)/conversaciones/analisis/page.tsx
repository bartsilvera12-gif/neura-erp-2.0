"use client";

/**
 * /conversaciones/analisis — Análisis de conversaciones (solo ADMIN, receta 174).
 * Claude lee los chats que atendieron personas (desde la bandeja o desde el celular), con los datos
 * personales tapados, y arma un informe: qué preguntan los clientes, cómo responde el equipo,
 * objeciones, productos que piden y no hay, tono, y sugerencias para el bot vendedor. Una sugerencia
 * se aplica con un clic (se agrega a las instrucciones del bot). SOLO LEE: no le escribe a nadie.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, Loader2, Search, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { fechaHora } from "@/lib/fecha/paraguay";
import { BOTON, BOTON_PRIMARIO } from "@/modules/rrhh/ui";
import type { Informe } from "@/lib/conversaciones/analisis-tipos";

type Fila = {
  id: string; desde: string; hasta: string; estado: "procesando" | "listo" | "error"; conversaciones: number; mensajes: number;
  resultado: Informe | null; aplicadas: number[]; costo_usd: number | null; error: string | null; creado_at: string; terminado_at: string | null;
};

const PERIODOS = [7, 30, 90] as const;

function Lista({ titulo, items }: { titulo: string; items: React.ReactNode[] }) {
  if (!items.length) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-900">{titulo}</h3>
      <ul className="space-y-1.5 text-sm text-slate-700">{items.map((x, i) => <li key={i} className="rounded-xl bg-slate-50 p-2.5">{x}</li>)}</ul>
    </section>
  );
}

function VerInforme({ f, onAplicada }: { f: Fila; onAplicada: (indice: number) => void }) {
  const r = f.resultado;
  const [busy, setBusy] = useState<number | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  if (!r) return <p className="text-sm text-slate-500">No hubo conversaciones atendidas por personas en ese período.</p>;

  async function aplicar(i: number) {
    setBusy(i);
    setAviso(null);
    try {
      const { donde } = await apiFetch<{ donde: string }>(`/api/conversaciones/analisis/${f.id}`, { method: "POST", body: JSON.stringify({ indice: i }) });
      onAplicada(i);
      setAviso({ ok: true, texto: `Agregada a las ${donde}.` });
    } catch (e) {
      setAviso({ ok: false, texto: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <section className="space-y-1">
        <h3 className="text-sm font-semibold text-slate-900">Resumen</h3>
        <p className="whitespace-pre-line text-sm text-slate-700">{r.resumen}</p>
      </section>

      <section className="space-y-2 rounded-2xl border border-[color-mix(in_srgb,var(--brand)_30%,white)] bg-[var(--brand-50,#eef7f7)] p-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Sparkles className="h-4 w-4 text-[var(--brand)]" /> Sugerencias para el bot ({r.sugerencias.length})</h3>
        {aviso ? <p className={`rounded-xl p-2 text-sm ${aviso.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{aviso.texto}</p> : null}
        {r.sugerencias.length ? (
          <ul className="space-y-2">
            {r.sugerencias.map((s, i) => {
              const hecha = f.aplicadas.includes(i);
              return (
                <li key={i} className="space-y-1.5 rounded-xl bg-white p-3 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{s.destino === "categoria" && s.categoria ? `Vendedor de ${s.categoria}` : "Instrucciones de la tienda"}</p>
                  <p className="text-sm font-medium text-slate-900">{s.texto}</p>
                  <p className="text-xs text-slate-500">Por qué: {s.motivo}</p>
                  {hecha ? (
                    <p className="flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Aplicada</p>
                  ) : (
                    <button type="button" className={`${BOTON} min-h-9`} disabled={busy !== null} onClick={() => void aplicar(i)}>
                      {busy === i ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Aplicar al bot
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : <p className="text-sm text-slate-500">Sin sugerencias nuevas.</p>}
      </section>

      <Lista titulo="Lo que más preguntan" items={r.preguntas_frecuentes.map((p) => (
        <><b className="font-semibold">{p.pregunta}</b> <span className="text-xs text-slate-500">({p.frecuencia})</span><br /><span className="text-slate-600">Cómo responde el equipo: {p.como_responde_el_equipo}</span></>
      ))} />
      <Lista titulo="Objeciones y qué funciona" items={r.objeciones.map((o) => <><b className="font-semibold">{o.objecion}</b><br /><span className="text-slate-600">{o.respuesta_que_funciona}</span></>)} />
      <Lista titulo="Piden y no hay" items={r.productos_que_piden_y_no_hay} />
      <section className="space-y-1">
        <h3 className="text-sm font-semibold text-slate-900">Tono del equipo</h3>
        <p className="text-sm text-slate-700">{r.tono.descripcion}</p>
        {r.tono.frases_tipicas.length ? <p className="text-sm text-slate-500">{r.tono.frases_tipicas.map((x) => `“${x}”`).join(" · ")}</p> : null}
      </section>
      <Lista titulo="Lo que funciona" items={r.buenas_practicas} />
      <Lista titulo="Problemas detectados" items={r.problemas} />
    </div>
  );
}

export default function AnalisisConversacionesPage() {
  const [informes, setInformes] = useState<Fila[] | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [dias, setDias] = useState<(typeof PERIODOS)[number]>(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await apiFetch<{ informes: Fila[] }>("/api/conversaciones/analisis");
      setInformes(r.informes);
      setAbierto((a) => a ?? r.informes.find((x) => x.estado === "listo")?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  // Mientras hay uno procesando, se consulta cada 5 s.
  const procesando = informes?.some((x) => x.estado === "procesando");
  useEffect(() => {
    if (!procesando) return;
    const t = setInterval(() => void cargar(), 5000);
    return () => clearInterval(t);
  }, [procesando, cargar]);

  async function analizar() {
    setBusy(true);
    setError(null);
    try {
      const f = await apiFetch<Fila>("/api/conversaciones/analisis", { method: "POST", body: JSON.stringify({ dias }) });
      setInformes((l) => [f, ...(l ?? [])]);
      setAbierto(f.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 pb-10">
      <EncabezadoPagina
        titulo="Análisis de conversaciones"
        subtitulo="Claude lee los chats que atendió tu equipo y te dice qué preguntan los clientes, qué respuestas venden y qué conviene enseñarle al bot."
        volver={{ href: "/omnicanal", label: "Omnicanal" }}
      />
      <p className="flex gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
        <ShieldCheck className="h-4 w-4 shrink-0" /> Solo lee: no le escribe a ningún cliente. Los teléfonos, documentos y correos se tapan antes de mandar los chats a Claude.
      </p>

      <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <p className="mb-1 text-[11px] font-medium text-slate-500">Período</p>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Período">
            {PERIODOS.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={dias === d} onClick={() => setDias(d)}
                className={`min-h-11 rounded-xl border px-3 text-sm font-semibold ${dias === d ? "border-[var(--brand)] bg-[var(--brand-50,#eef7f7)] text-[var(--brand)]" : "border-slate-200 text-slate-700"}`}>
                Últimos {d} días
              </button>
            ))}
          </div>
        </div>
        <button type="button" className={`${BOTON_PRIMARIO} max-sm:w-full`} disabled={busy || !!procesando} onClick={() => void analizar()}>
          {busy || procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} {procesando ? "Analizando…" : "Analizar conversaciones"}
        </button>
        <p className="w-full text-xs text-slate-500">Lee hasta 150 conversaciones donde respondió una persona. Tarda uno o dos minutos y cuesta centavos de dólar de tu saldo de Claude.</p>
      </section>

      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {!informes && !error ? <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" /> : null}
      {informes && !informes.length ? <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">Todavía no hiciste ningún análisis.</p> : null}

      {informes?.map((f) => (
        <section key={f.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <button type="button" className="flex w-full items-center justify-between gap-3 p-4 text-left" onClick={() => setAbierto(abierto === f.id ? null : f.id)} aria-expanded={abierto === f.id}>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-900">
                {new Date(f.desde).toLocaleDateString("es-PY", { timeZone: "America/Asuncion" })} al {new Date(f.hasta).toLocaleDateString("es-PY", { timeZone: "America/Asuncion" })}
              </span>
              <span className="block text-xs text-slate-500">
                {f.estado === "procesando" ? "Analizando…" : f.estado === "error" ? "No se pudo hacer" : `${f.conversaciones} conversaciones · ${f.mensajes} mensajes`}
                {f.costo_usd != null && f.estado === "listo" ? ` · costó USD ${Number(f.costo_usd).toFixed(2)}` : ""} · pedido {fechaHora(f.creado_at)}
              </span>
            </span>
            {f.estado === "procesando" ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" /> : <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${abierto === f.id ? "rotate-180" : ""}`} />}
          </button>
          {abierto === f.id && f.estado !== "procesando" ? (
            <div className="border-t border-slate-100 p-4">
              {f.estado === "error" ? <p className="flex gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700"><TriangleAlert className="h-4 w-4 shrink-0" /> {f.error}</p>
                : <VerInforme f={f} onAplicada={(i) => setInformes((l) => (l ?? []).map((x) => (x.id === f.id ? { ...x, aplicadas: [...x.aplicadas, i] } : x)))} />}
            </div>
          ) : null}
        </section>
      ))}

      <p className="text-xs text-slate-500">
        Las sugerencias aplicadas se suman a las instrucciones de <Link className="font-semibold text-[var(--brand)]" href="/conversaciones/bot-vendedor">Bot vendedor</Link>; ahí las podés editar o borrar.
      </p>
    </div>
  );
}
