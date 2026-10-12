"use client";

/**
 * Bandeja omnicanal (Conversaciones). Lista a la izquierda con pestañas (Mías / Sin asignar /
 * Todas / Cerradas), búsqueda y filtros; chat al centro; ficha del contacto superpuesta.
 * Todo en vivo por Realtime (broadcast privado) con respaldo por sondeo si se cae.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { CheckCircle2, FlaskConical, MessagesSquare, Zap } from "lucide-react";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { olvidarOpciones, pedirOpciones } from "@/modules/conversaciones/api";
import { VISTAS, esVista, type FilaBandeja, type OpcionesBandeja, type Vista } from "@/modules/conversaciones/dominio";
import { useBandeja } from "@/modules/conversaciones/useBandeja";
import { ListaConversaciones } from "@/modules/conversaciones/ListaConversaciones";
import { PanelChat } from "@/modules/conversaciones/PanelChat";
import { Girando, tabClass } from "@/modules/conversaciones/ui";

const ModalRespuestas = dynamic(() => import("@/modules/conversaciones/ModalRespuestas").then((m) => m.ModalRespuestas), { ssr: false });
const ModalSimular = dynamic(() => import("@/modules/conversaciones/ModalSimular").then((m) => m.ModalSimular), { ssr: false });

const CLAVE_VISTA = "zentra:conversaciones:vista";
const flecha =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%234FAEB2' stroke-width='2.5'><path stroke-linecap='round' stroke-linejoin='round' d='M6 9l6 6 6-6'/></svg>\")";
const claseSelect =
  "appearance-none rounded-lg border border-slate-200 bg-white bg-[length:13px_13px] bg-[right_0.55rem_center] bg-no-repeat px-2.5 py-2 pr-7 text-xs font-medium text-slate-700 shadow-sm outline-none transition-colors hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 min-w-[8.5rem] max-w-[min(16rem,60vw)] shrink-0";

export function Bandeja() {
  const me = useUsuario();
  const [opciones, setOpciones] = useState<OpcionesBandeja | null>(null);
  const [errorOpciones, setErrorOpciones] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>("mias");
  const [texto, setTexto] = useState("");
  const [q, setQ] = useState("");
  const [canal, setCanal] = useState("");
  const [asesor, setAsesor] = useState("");
  const [modal, setModal] = useState<null | "respuestas" | "simular">(null);
  const [aviso, setAviso] = useState<{ texto: string; tono: "ok" | "error" } | null>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem(CLAVE_VISTA);
      if (esVista(v)) setVista(v);
    } catch {
      /* sin storage */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_VISTA, vista);
    } catch {}
  }, [vista]);

  useEffect(() => {
    pedirOpciones()
      .then(setOpciones)
      .catch((e) => setErrorOpciones((e as Error).message));
  }, []);

  // Búsqueda con debounce (Enter busca ya).
  useEffect(() => {
    const t = window.setTimeout(() => setQ(texto.trim()), 300);
    return () => window.clearTimeout(t);
  }, [texto]);

  const filtros = useMemo(() => ({ vista, q, canal, asesor: vista === "todas" || vista === "cerradas" ? asesor : "" }), [vista, q, canal, asesor]);
  const b = useBandeja({ empresaId: me?.empresaId ?? null, yo: opciones?.yo ?? null, filtros });

  // Enlace directo ?c=<conversación>; la URL sigue al chat abierto (sin navegar).
  const inicial = useRef(false);
  useEffect(() => {
    if (inicial.current || !opciones) return;
    inicial.current = true;
    const c = new URLSearchParams(window.location.search).get("c");
    if (c && /^[0-9a-f-]{36}$/i.test(c)) b.abrir(c);
  }, [opciones, b]);
  const abrir = useCallback(
    (id: string | null) => {
      b.abrir(id);
      const url = new URL(window.location.href);
      if (id) url.searchParams.set("c", id);
      else url.searchParams.delete("c");
      window.history.replaceState(window.history.state, "", url);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [b.abrir],
  );

  const avisar = useCallback((t: string, tono: "ok" | "error" = "ok") => setAviso({ texto: t, tono }), []);
  useEffect(() => {
    if (!aviso) return;
    const t = window.setTimeout(() => setAviso(null), 4000);
    return () => window.clearTimeout(t);
  }, [aviso]);

  const onFila = useCallback(
    (f: FilaBandeja) => {
      b.aplicarFila(f);
      b.refrescarContadores(600);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [b.aplicarFila, b.refrescarContadores],
  );

  const sugeridas = useMemo(() => [...new Set(b.filas.flatMap((f) => f.etiquetas))].sort(), [b.filas]);
  const yoNombre = useMemo(() => opciones?.equipo.find((u) => u.id === opciones.yo)?.nombre ?? me?.email ?? "Vos", [opciones, me]);
  const contador = (v: Vista) =>
    v === "mias" ? b.contadores.mias : v === "sin_asignar" ? b.contadores.sin_asignar : v === "todas" ? b.contadores.abiertas : null;

  if (errorOpciones) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorOpciones}</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      {/* Barra superior: pestañas, búsqueda y filtros */}
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">
        <div className="flex w-fit shrink-0 flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-100/80 p-1">
          {VISTAS.map((v) => {
            const n = contador(v.id);
            return (
              <button key={v.id} type="button" className={tabClass(vista === v.id)} onClick={() => setVista(v.id)}>
                {v.label}
                {n ? (
                  <span className={`rounded-full px-1.5 text-[10px] font-bold tabular-nums ${vista === v.id ? "bg-white/25 text-white" : "bg-slate-200 text-slate-600"}`}>{n}</span>
                ) : null}
                {v.id === "mias" && b.contadores.mias_no_leidas > 0 && vista !== "mias" ? <span className="h-1.5 w-1.5 rounded-full bg-[#4FAEB2]" aria-label="Con no leídos" /> : null}
              </button>
            );
          })}
        </div>
        <div className="relative min-w-[10rem] flex-1">
          <input
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), setQ(texto.trim()))}
            placeholder="Buscar por nombre, número o mensaje"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-24 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
            aria-label="Buscar conversaciones"
          />
          {texto.trim() && (texto.trim() !== q || b.cargando) ? (
            <span className="pointer-events-none absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 text-[11px] font-medium text-[#3F8E91]">
              <Girando /> Buscando…
            </span>
          ) : null}
        </div>
        {opciones && opciones.canales.length > 1 ? (
          <select className={claseSelect} style={{ backgroundImage: flecha }} value={canal} onChange={(e) => setCanal(e.target.value)} aria-label="Filtrar por canal">
            <option value="">Todos los canales</option>
            {opciones.canales.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
        ) : null}
        {opciones && (vista === "todas" || vista === "cerradas") ? (
          <select className={claseSelect} style={{ backgroundImage: flecha }} value={asesor} onChange={(e) => setAsesor(e.target.value)} aria-label="Filtrar por asesor">
            <option value="">Todos los asesores</option>
            {opciones.equipo.map((u) => (
              <option key={u.id} value={u.id}>{u.nombre}</option>
            ))}
          </select>
        ) : null}
        {opciones?.es_admin ? (
          <>
            <button type="button" onClick={() => setModal("respuestas")} title="Respuestas rápidas" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-600 shadow-sm hover:border-[#4FAEB2]/60 hover:text-[#3F8E91]">
              <Zap className="h-3.5 w-3.5" /> Respuestas
            </button>
            {opciones.canales.some((c) => c.proveedor === "simulador" && c.activo) ? (
              <button type="button" onClick={() => setModal("simular")} title="Simular un mensaje entrante (canal simulador)" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-violet-300 bg-violet-50 px-2.5 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-100">
                <FlaskConical className="h-3.5 w-3.5" /> Simular entrante
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      {b.error ? <div className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">{b.error}</div> : null}

      <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {/* Lista */}
        <div className={`min-h-0 w-full shrink-0 flex-col border-r border-slate-200 bg-slate-50/80 lg:flex lg:w-[320px] xl:w-[350px] ${b.selId ? "hidden" : "flex"}`}>
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Chats</span>
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-medium ${b.suscripto ? "text-emerald-600" : "text-amber-600"}`}
              title={b.suscripto ? "Recibiendo cambios en vivo" : "Sin conexión en vivo: se actualiza cada 30 s"}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${b.suscripto ? "bg-emerald-500" : "animate-pulse bg-amber-500"}`} />
              {b.suscripto ? "En vivo" : "Reconectando…"}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <ListaConversaciones
              filas={b.filas}
              seleccionadaId={b.selId}
              detalle={vista === "todas" || vista === "cerradas"}
              cargando={b.cargando || !opciones}
              hayMas={b.hayMas}
              cargandoMas={b.cargandoMas}
              hayBusqueda={!!q}
              onAbrir={abrir}
              onCargarMas={() => void b.cargarMas()}
            />
          </div>
        </div>

        {/* Chat */}
        <div className={`min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex ${b.selId ? "flex" : "hidden"}`}>
          {!b.selId || !opciones ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-2 text-sm text-slate-400">
              <MessagesSquare className="h-10 w-10 text-slate-300" />
              <span>Seleccioná una conversación</span>
            </div>
          ) : !b.sel ? (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
              <Girando className="mr-2 h-4 w-4" /> Abriendo…
            </div>
          ) : (
            <PanelChat
              key={b.sel.id}
              conv={b.sel}
              opciones={opciones}
              yoNombre={yoNombre}
              sugeridas={sugeridas}
              onFila={onFila}
              onVolver={() => abrir(null)}
              onAviso={avisar}
            />
          )}
        </div>
      </div>

      {aviso ? (
        <div
          role="status"
          className={`fixed bottom-5 left-1/2 z-[140] flex -translate-x-1/2 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white shadow-xl ${aviso.tono === "error" ? "bg-red-600" : "bg-slate-900"}`}
          style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}
        >
          {aviso.tono === "ok" ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : null}
          {aviso.texto}
        </div>
      ) : null}

      {modal === "respuestas" ? (
        <ModalRespuestas
          onCerrar={(cambio) => {
            setModal(null);
            if (cambio) {
              olvidarOpciones();
              pedirOpciones(true).then(setOpciones).catch(() => {});
            }
          }}
        />
      ) : null}
      {modal === "simular" ? (
        <ModalSimular
          inicial={b.sel ? { telefono: b.sel.contacto_telefono ?? "595981", nombre: b.sel.contacto_nombre ?? "" } : undefined}
          onCerrar={() => setModal(null)}
          onListo={() => {}}
        />
      ) : null}
    </div>
  );
}
