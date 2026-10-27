"use client";

/**
 * Historial omnicanal: buscás un contacto por nombre o número y ves TODAS sus
 * conversaciones (cualquier canal) con su cierre, y el flujo de acciones (ingreso,
 * asignaciones, transferencias, reasignaciones por SLA, cierres). Cualquier chat se lee
 * en modo lectura. Enlace directo: /conversaciones/historial?contacto=<id>.
 * Pestaña "Todas las cerradas" (?modo=cerradas): bandeja de solo lectura de todas las
 * cerradas con filtro de asignación (HistorialCerradas).
 */
import { TablaScroll } from "@/components/TablaResponsive";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Eye, History, MessagesSquare, Search, UserRound } from "lucide-react";
import { TZ_PY } from "@/lib/fecha/paraguay";
import { buscarContactos, pedirHistorial } from "@/modules/conversaciones/api-supervision";
import { ESTADO_CLASE, ESTADO_LABEL, horaLista, nombreContacto, telefonoLegible } from "@/modules/conversaciones/dominio";
import { eventoRuteo, type ContactoBuscado, type ConversacionHistorial, type Historial as DatosHistorial } from "@/modules/conversaciones/supervision";
import { AvatarTono, Cargando, Encabezado, VOLVER_OMNICANAL } from "@/modules/conversaciones/ui-supervision";
import { Girando, tabClass } from "@/modules/conversaciones/ui";
import { HistorialCerradas } from "@/modules/conversaciones/HistorialCerradas";

const VisorChat = dynamic(() => import("@/modules/conversaciones/VisorChat").then((m) => m.VisorChat), { ssr: false });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const F_CORTA = new Intl.DateTimeFormat("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const F_LARGA = new Intl.DateTimeFormat("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const corta = (iso: string | null | undefined) => (iso ? F_CORTA.format(new Date(iso)).replace(",", "") : "—");
const larga = (iso: string | null | undefined) => (iso ? F_LARGA.format(new Date(iso)).replace(",", "") : "—");

type Paso = { at: string; accion: string; clase: string; usuario: string; destino: string; linea: string | null };

/** Flujo de acciones (de más viejo a más nuevo): ingresos + ruteo + cierres. */
function armarFlujo(h: DatosHistorial): Paso[] {
  const pasos: Paso[] = [];
  for (const c of h.conversaciones) {
    pasos.push({ at: c.created_at, accion: "Ingreso", clase: "border-slate-200 bg-slate-50 text-slate-600", usuario: "—", destino: "—", linea: c.canal });
    if (c.estado === "cerrada" && c.cerrada_at) {
      pasos.push({ at: c.cerrada_at, accion: "Finalizado", clase: "border-slate-300 bg-slate-100 text-slate-700", usuario: c.asignado ?? "—", destino: c.cierre_estado ?? "—", linea: c.canal });
    }
  }
  for (const r of h.ruteo) {
    const e = eventoRuteo(r.evento);
    const p: Paso = { at: r.created_at, accion: e.label, clase: e.clase, usuario: "Sistema", destino: r.a ?? "—", linea: null };
    switch (r.evento) {
      case "asignada_auto":
        p.usuario = "Automático";
        break;
      case "reasignada_sla":
        p.usuario = r.de ? `Sistema (antes ${r.de})` : "Sistema";
        break;
      case "tomada":
        p.usuario = r.a ?? "—";
        p.destino = "—";
        break;
      case "transferida":
        p.usuario = r.de ?? "—";
        break;
      case "asignada_supervisor":
        p.usuario = "Supervisor";
        break;
      case "liberada":
        p.usuario = r.de ?? "—";
        p.destino = "Sin asignar";
        break;
      case "derivada":
        p.usuario = r.de ?? "—";
        p.destino = r.cola ? `Cola ${r.cola}` : "—";
        break;
      default:
        p.destino = "—";
    }
    pasos.push(p);
  }
  return pasos.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

type Modo = "contacto" | "cerradas";

export function Historial() {
  const sp = useSearchParams();
  const inicial = sp.get("contacto");
  const [modo, setModo] = useState<Modo>(sp.get("modo") === "cerradas" && !inicial ? "cerradas" : "contacto");
  const cambiarModo = (m: Modo) => {
    setModo(m);
    const url = new URL(window.location.href);
    if (m === "cerradas") url.searchParams.set("modo", "cerradas");
    else url.searchParams.delete("modo");
    window.history.replaceState(window.history.state, "", url);
  };
  const [texto, setTexto] = useState("");
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<ContactoBuscado[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(inicial && UUID.test(inicial) ? inicial : null);
  const [hist, setHist] = useState<DatosHistorial | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visor, setVisor] = useState<ConversacionHistorial | null>(null);
  const abortB = useRef<AbortController | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(texto.trim()), 300);
    return () => window.clearTimeout(t);
  }, [texto]);

  useEffect(() => {
    abortB.current?.abort();
    if (q.length < 2) {
      setResultados([]);
      setBuscando(false);
      return;
    }
    const ac = new AbortController();
    abortB.current = ac;
    setBuscando(true);
    setErrorBusqueda(null);
    buscarContactos(q, ac.signal)
      .then((r) => {
        if (ac.signal.aborted) return;
        setResultados(r);
        // Como el sistema actual: sin contacto elegido, se abre el primero.
        if (r.length) setSelId((s) => s ?? r[0].id);
      })
      .catch((e) => !ac.signal.aborted && setErrorBusqueda((e as Error).message))
      .finally(() => !ac.signal.aborted && setBuscando(false));
    return () => ac.abort();
  }, [q]);

  // El contacto elegido va en la URL (sin navegar), así el enlace se puede compartir.
  const elegir = useCallback((id: string) => {
    setSelId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("contacto", id);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  useEffect(() => {
    if (!selId) return;
    const ac = new AbortController();
    setCargando(true);
    setError(null);
    pedirHistorial(selId, ac.signal)
      .then((h) => !ac.signal.aborted && setHist(h))
      .catch((e) => {
        if (ac.signal.aborted) return;
        setHist(null);
        setError((e as Error).message);
      })
      .finally(() => !ac.signal.aborted && setCargando(false));
    return () => ac.abort();
  }, [selId]);

  const flujo = useMemo(() => (hist ? armarFlujo(hist) : []), [hist]);
  const contacto = hist?.contacto ?? null;
  const nombre = contacto ? nombreContacto({ contacto_nombre: contacto.nombre, contacto_telefono: contacto.telefono }) : "";
  const canales = useMemo(() => [...new Set((hist?.conversaciones ?? []).map((c) => c.canal))], [hist]);

  return (
    <div className="flex flex-col gap-4 pb-10">
      <Encabezado
        volver={VOLVER_OMNICANAL}
        eyebrow="Omnicanal"
        titulo="Historial omnicanal"
        detalle={
          modo === "cerradas"
            ? "Todas las conversaciones cerradas en una bandeja de solo lectura, filtrable por asignación, cola y canal."
            : "Auditoría por contacto: todas sus conversaciones en cualquier canal, con asignaciones, transferencias y cierres."
        }
      />

      <div role="tablist" aria-label="Modo del historial" className="flex w-full gap-1 rounded-xl border border-slate-200 bg-slate-100/80 p-1 sm:w-fit">
        {(
          [
            ["contacto", "Por contacto"],
            ["cerradas", "Todas las cerradas"],
          ] as [Modo, string][]
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={modo === m}
            onClick={() => cambiarModo(m)}
            className={`${tabClass(modo === m)} max-sm:min-h-11 max-sm:flex-1 max-sm:justify-center`}
          >
            {label}
          </button>
        ))}
      </div>

      {modo === "cerradas" ? <HistorialCerradas /> : (
      <div className="flex min-h-[520px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" style={{ height: "max(520px, calc(100dvh - 15rem))" }}>
        {/* Búsqueda */}
        <aside className={`min-h-0 w-full shrink-0 flex-col border-slate-200 bg-slate-50/80 md:flex md:w-[280px] md:border-r lg:w-[320px] xl:w-[350px] ${selId ? "hidden" : "flex"}`}>
          <div className="shrink-0 border-b border-slate-200 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                type="search"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), setQ(texto.trim()))}
                placeholder="Buscar por nombre o número"
                aria-label="Buscar contacto"
                autoFocus
                enterKeyHint="search"
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-24 text-xs text-slate-800 outline-none max-md:h-11 placeholder:text-slate-400 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
              />
              {buscando ? (
                <span className="pointer-events-none absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 text-[11px] font-medium text-[#3F8E91]">
                  <Girando /> <span className="max-sm:sr-only">Buscando…</span>
                </span>
              ) : null}
            </div>
          </div>
          <p className="shrink-0 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Contactos encontrados</p>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {errorBusqueda ? <p className="m-3 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">{errorBusqueda}</p> : null}
            {q.length < 2 ? (
              <p className="px-3 py-6 text-center text-xs text-slate-500">Buscá un contacto para ver su historial.</p>
            ) : !buscando && !resultados.length ? (
              <p className="px-3 py-6 text-center text-xs text-slate-500">Ningún contacto coincide con la búsqueda.</p>
            ) : (
              resultados.map((c) => {
                const n = nombreContacto({ contacto_nombre: c.nombre, contacto_telefono: c.telefono });
                const activo = c.id === selId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => elegir(c.id)}
                    className={`flex min-h-16 w-full items-start gap-2.5 border-b border-slate-100 px-3 py-2.5 text-left transition-colors ${activo ? "border-l-[3px] border-l-[#4FAEB2] bg-white" : "hover:bg-white"}`}
                  >
                    <AvatarTono nombre={n} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-slate-900">{n}</span>
                        <span className="shrink-0 text-[10.5px] tabular-nums text-slate-400">{horaLista(c.ultimo_mensaje_at)}</span>
                      </span>
                      <span className="block truncate font-mono text-[11px] text-slate-500">{telefonoLegible(c.telefono)}</span>
                      <span className="block truncate text-[11px] text-slate-500">
                        {c.conversaciones} {c.conversaciones === 1 ? "conversación" : "conversaciones"} · {c.canales.join(" · ")}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Detalle */}
        <div className={`min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:flex ${selId ? "flex" : "hidden"}`}>
          {!selId ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-slate-400">
              <History className="h-10 w-10 text-slate-300" />
              Seleccioná un contacto
            </div>
          ) : cargando && !hist ? (
            <div className="px-5"><Cargando texto="Cargando historial…" /></div>
          ) : error || !contacto ? (
            <div className="m-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error ?? "No se pudo cargar el historial."}</div>
          ) : (
            <>
              <div className="shrink-0 border-b border-slate-200 bg-white px-2.5 py-2.5 sm:px-4 sm:py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <button type="button" onClick={() => setSelId(null)} aria-label="Volver a la búsqueda" className="inline-flex h-11 shrink-0 items-center rounded-lg px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 md:hidden">
                      ← Volver
                    </button>
                    <AvatarTono nombre={nombre} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{nombre}</p>
                      <p className="font-mono text-[11px] tabular-nums text-slate-500">{telefonoLegible(contacto.telefono)}</p>
                    </div>
                    {cargando ? <Girando className="h-3.5 w-3.5 text-[#3F8E91]" /> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {contacto.cliente_id ? (
                      <Link href={`/clientes/${contacto.cliente_id}`} className="inline-flex items-center gap-1 rounded-full border border-[#4FAEB2]/30 bg-[#4FAEB2]/10 px-2.5 py-1 text-[11px] max-sm:min-h-10 max-sm:px-3.5 font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/20">
                        <UserRound className="h-3 w-3" aria-hidden /> Ver cliente →
                      </Link>
                    ) : null}
                    {contacto.prospecto_id ? (
                      <Link href={`/crm?p=${contacto.prospecto_id}`} className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] max-sm:min-h-10 max-sm:px-3.5 font-semibold text-violet-700 hover:bg-violet-100">
                        Ver prospecto CRM →
                      </Link>
                    ) : null}
                  </div>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">
                  {hist!.conversaciones.length} {hist!.conversaciones.length === 1 ? "conversación" : "conversaciones"}
                  {canales.length ? ` · ${canales.join(" · ")}` : ""} · Primer contacto: {larga(contacto.created_at)}
                </p>
              </div>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain bg-slate-50/50 px-2.5 py-3 sm:px-4 sm:py-4">
                <section>
                  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Conversaciones ({hist!.conversaciones.length})</h3>
                  <div className="space-y-2">
                    {hist!.conversaciones.map((c) => (
                      <article key={c.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-1.5 text-sm">
                              <strong className="text-slate-900">{c.canal}</strong>
                              <span className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${ESTADO_CLASE[c.estado]}`}>{ESTADO_LABEL[c.estado]}</span>
                              {c.asignado ? <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-900">Agente · {c.asignado}</span> : null}
                              {c.cola ? <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">Cola · {c.cola}</span> : null}
                            </p>
                            <p className="mt-0.5 text-[11px] text-slate-500">
                              Desde {larga(c.created_at)}
                              {c.ultimo_mensaje_at ? ` · último mensaje ${larga(c.ultimo_mensaje_at)}` : ""}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5 max-sm:w-full max-sm:[&>*]:flex-1 max-sm:[&>*]:justify-center">
                            <button
                              type="button"
                              onClick={() => setVisor(c)}
                              className="inline-flex items-center gap-1 rounded-lg border border-[#4FAEB2]/50 bg-[#4FAEB2]/8 px-2.5 py-1.5 text-xs font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/15 max-sm:min-h-11"
                            >
                              <Eye className="h-3.5 w-3.5" aria-hidden /> Leer chat
                            </button>
                            <Link href={`/conversaciones?c=${c.id}`} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold max-sm:min-h-11 text-slate-700 hover:border-[#4FAEB2]/60 hover:text-[#3F8E91]">
                              <MessagesSquare className="h-3.5 w-3.5" aria-hidden /> Bandeja
                            </Link>
                          </div>
                        </div>
                        {c.ultimo_preview ? <p className="mt-2 line-clamp-2 text-xs text-slate-600">{c.ultimo_preview}</p> : null}
                        {c.estado === "cerrada" && (c.cierre_estado || c.cierre_observacion) ? (
                          <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 text-xs">
                            <span className="font-semibold text-slate-700">Último cierre{c.cerrada_at ? ` (${larga(c.cerrada_at)})` : ""}:</span>{" "}
                            {c.cierre_estado ? <span className="rounded-full bg-[#4FAEB2]/15 px-2 py-0.5 font-semibold text-[#2F6E71]">{c.cierre_estado}</span> : null}
                            {c.cierre_observacion ? <p className="mt-1 whitespace-pre-wrap text-slate-600 [overflow-wrap:anywhere]">{c.cierre_observacion}</p> : null}
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Flujo / Acciones</h3>
                  {!flujo.length ? (
                    <p className="text-xs text-slate-500">Sin movimientos registrados.</p>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                      <TablaScroll primeraFija>
                      <table className="w-full min-w-[560px] text-xs">
                        <thead className="border-b border-slate-200 bg-slate-50">
                          <tr>
                            {["Fecha", "Línea", "Acción", "Usuario", "Destino"].map((h) => (
                              <th key={h} className="whitespace-nowrap px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {flujo.map((p, i) => (
                            <tr key={`${p.at}-${i}`}>
                              <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-600" title={larga(p.at)}>{corta(p.at)}</td>
                              <td className="px-2 py-1.5">
                                {p.linea ? <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-600">{p.linea}</span> : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-2 py-1.5">
                                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${p.clase}`}>{p.accion}</span>
                              </td>
                              <td className="px-2 py-1.5 text-slate-700">{p.usuario}</td>
                              <td className="px-2 py-1.5 text-slate-700">{p.destino}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </TablaScroll>
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
      </div>
      )}

      {visor && contacto ? (
        <VisorChat
          convId={visor.id}
          nombre={contacto.nombre}
          telefono={contacto.telefono}
          detalle={`${telefonoLegible(contacto.telefono)} · ${visor.canal} · ${ESTADO_LABEL[visor.estado]}`}
          onCerrar={() => setVisor(null)}
        />
      ) : null}
    </div>
  );
}
