"use client";

/**
 * Bandeja omnicanal (Conversaciones). Lista a la izquierda con pestañas (Mías / Sin asignar /
 * Todas / Cerradas), búsqueda y filtros (canal, cola, asesor); chat al centro; ficha del
 * contacto superpuesta.
 * Todo en vivo por Realtime (broadcast privado) con respaldo por sondeo si se cae.
 * Arriba, el estado del asesor (Disponible / Ocupado / En pausa): la bandeja late cada 30 s
 * con la pestaña visible (presencia para la asignación automática y el Monitoreo).
 * ?c=<conversación> abre ese chat (también si se llega desde un aviso estando acá).
 *
 * RESPONSIVE: celular (< 768 px) navega por pasos como WhatsApp: la lista ocupa la pantalla
 * y el chat se abre ENCIMA a pantalla completa (capa fija que sigue al viewport visible: el
 * compositor queda sobre el teclado), con "volver" (también el botón atrás del teléfono).
 * Tablet (≥ 768): lista + chat lado a lado; la ficha del contacto se abre en hoja (< 1024).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { CheckCircle2, FlaskConical, MessagesSquare, MoreHorizontal, Zap } from "lucide-react";
import { BarraFiltros } from "@/components/EncabezadoPagina";
import { MenuAcciones } from "@/components/MenuAcciones";
import { Select } from "@/components/Select";
import { ScrollHorizontal } from "@/components/ScrollHorizontal";
import { useMediaQuery, useViewportVisible } from "@/lib/ui/responsive";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { olvidarOpciones, pedirOpciones } from "@/modules/conversaciones/api";
import { VISTAS, esVista, type FilaBandeja, type OpcionesBandeja, type Vista } from "@/modules/conversaciones/dominio";
import { useBandeja } from "@/modules/conversaciones/useBandeja";
import { ListaConversaciones } from "@/modules/conversaciones/ListaConversaciones";
import { PanelChat } from "@/modules/conversaciones/PanelChat";
import { Girando, tabClass } from "@/modules/conversaciones/ui";
import { usePresencia } from "@/modules/conversaciones/presencia";
import { SelectorEstado, VolverOmnicanal } from "@/modules/conversaciones/ui-supervision";

const ModalRespuestas = dynamic(() => import("@/modules/conversaciones/ModalRespuestas").then((m) => m.ModalRespuestas), { ssr: false });
const ModalSimular = dynamic(() => import("@/modules/conversaciones/ModalSimular").then((m) => m.ModalSimular), { ssr: false });

const CLAVE_VISTA = "zentra:conversaciones:vista";
/** Filtros de la barra: en ≥ 768 px van en línea (sin achicarse); en celular, en la hoja de filtros a todo el ancho. */
const claseSelect = "shrink-0 md:max-w-[16rem] max-md:w-full max-md:!min-w-0";

/** Debajo de este ancho el chat se abre a pantalla completa sobre la lista. */
const MQ_CHAT_ENCIMA = "(max-width: 767.98px)";

export function Bandeja() {
  const me = useUsuario();
  const chatEncima = useMediaQuery(MQ_CHAT_ENCIMA);
  const capaChat = useRef<HTMLDivElement>(null);
  const presencia = usePresencia();
  const [opciones, setOpciones] = useState<OpcionesBandeja | null>(null);
  const [errorOpciones, setErrorOpciones] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>("mias");
  const [texto, setTexto] = useState("");
  const [q, setQ] = useState("");
  const [canal, setCanal] = useState("");
  const [asesor, setAsesor] = useState("");
  const [cola, setCola] = useState("");
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

  const filtros = useMemo(() => ({ vista, q, canal, cola, asesor: vista === "todas" || vista === "cerradas" ? asesor : "" }), [vista, q, canal, cola, asesor]);
  const b = useBandeja({ empresaId: me?.empresaId ?? null, yo: opciones?.yo ?? null, filtros });

  // Enlace directo ?c=<conversación> (al entrar o desde la campanita estando acá); la URL
  // sigue al chat abierto (sin navegar). ultimoC evita reabrir lo que la propia pantalla
  // escribió en la URL.
  const sp = useSearchParams();
  const cUrl = sp.get("c");
  const ultimoC = useRef<string | null>(null);
  useEffect(() => {
    if (!opciones || cUrl === ultimoC.current) return;
    ultimoC.current = cUrl;
    if (cUrl && /^[0-9a-f-]{36}$/i.test(cUrl)) b.abrir(cUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opciones, cUrl, b.abrir]);
  // En celular, abrir un chat desde la lista suma una entrada al historial: el botón "atrás"
  // del teléfono vuelve a la lista (y "volver" hace history.back() para no dejarla colgada).
  const empujado = useRef(false);
  const abrir = useCallback(
    (id: string | null) => {
      if (!id && empujado.current) {
        empujado.current = false;
        window.history.back();
        return;
      }
      const empujar = !!id && !b.selId && window.matchMedia(MQ_CHAT_ENCIMA).matches;
      ultimoC.current = id;
      b.abrir(id);
      const url = new URL(window.location.href);
      if (id) url.searchParams.set("c", id);
      else url.searchParams.delete("c");
      if (empujar) {
        empujado.current = true;
        window.history.pushState(window.history.state, "", url);
      } else window.history.replaceState(window.history.state, "", url);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [b.abrir, b.selId],
  );
  // "Atrás" del navegador/teléfono sobre un chat abierto con pushState → vuelve a la lista.
  useEffect(() => {
    const alVolver = () => {
      if (new URL(window.location.href).searchParams.get("c")) return;
      empujado.current = false;
      ultimoC.current = null;
      b.abrir(null);
    };
    window.addEventListener("popstate", alVolver);
    return () => window.removeEventListener("popstate", alVolver);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.abrir]);
  // Celular: el chat va en una capa fija que sigue al viewport visible (teclado de iOS).
  const encima = chatEncima && !!b.selId;
  // Encima va en un portal a <body>: el contenido de la página tiene su propio contexto de
  // apilado (animación de entrada) y la cabecera de la app quedaría por arriba.
  const conPortal = (n: React.ReactNode) => (encima && typeof document !== "undefined" ? createPortal(n, document.body) : n);
  useViewportVisible(capaChat, encima);
  useEffect(() => {
    // El hook deja top/alto en línea: al dejar de estar encima (cerrar, girar a tablet) se limpian.
    const el = capaChat.current;
    if (encima || !el) return;
    for (const p of ["top", "height", "bottom", "--capa-alto"]) el.style.removeProperty(p);
  }, [encima]);

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
  const variasColas = (opciones?.colas?.length ?? 0) > 1;
  const hayFiltros = !!opciones && (opciones.canales.length > 1 || variasColas || vista === "todas" || vista === "cerradas");
  const contador = (v: Vista) =>
    v === "mias" ? b.contadores.mias : v === "sin_asignar" ? b.contadores.sin_asignar : v === "todas" ? b.contadores.abiertas : null;

  if (errorOpciones) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorOpciones}</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      {/* Vuelve al panel de tarjetas de Omnicanal (la bandeja no tiene título propio). */}
      <VolverOmnicanal className="-mb-1 shrink-0 self-start lg:min-h-7" />
      {/* Barra superior: pestañas, búsqueda y filtros (en celular: pestañas con scroll,
          búsqueda a lo ancho y canal/asesor en "Filtros"; el estado y el resto a la derecha). */}
      <div className="flex min-w-0 shrink-0 flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        <ScrollHorizontal
          role="tablist"
          ariaLabel="Vistas de la bandeja"
          dependencias={[vista]}
          className="shrink-0 rounded-xl border border-slate-200 bg-slate-100/80 p-1 md:w-fit"
        >
          {VISTAS.map((v) => {
            const n = contador(v.id);
            return (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={vista === v.id}
                className={`${tabClass(vista === v.id)} shrink-0 whitespace-nowrap max-md:min-h-10 max-md:flex-1 max-md:justify-center`}
                onClick={() => setVista(v.id)}
              >
                {v.label}
                {n ? (
                  <span className={`rounded-full px-1.5 text-[10px] font-bold tabular-nums ${vista === v.id ? "bg-white/25 text-white" : "bg-slate-200 text-slate-600"}`}>{n}</span>
                ) : null}
                {v.id === "mias" && b.contadores.mias_no_leidas > 0 && vista !== "mias" ? <span className="h-1.5 w-1.5 rounded-full bg-[#4FAEB2]" aria-label="Con no leídos" /> : null}
              </button>
            );
          })}
        </ScrollHorizontal>
        <BarraFiltros
          plano
          className="min-w-0 md:min-w-[18rem] md:flex-1"
          activos={(canal ? 1 : 0) + (cola ? 1 : 0) + ((vista === "todas" || vista === "cerradas") && asesor ? 1 : 0)}
          onLimpiar={() => {
            setCanal("");
            setCola("");
            setAsesor("");
          }}
          busqueda={
            <div className="relative min-w-0">
              <input
                type="search"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), setQ(texto.trim()))}
                placeholder="Buscar por nombre, número o mensaje"
                enterKeyHint="search"
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-10 text-xs md:pr-24 text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 md:h-auto"
                aria-label="Buscar conversaciones"
              />
              {texto.trim() && (texto.trim() !== q || b.cargando) ? (
                <span className="pointer-events-none absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 text-[11px] font-medium text-[#3F8E91]">
                  <Girando /> <span className="max-sm:sr-only">Buscando…</span>
                </span>
              ) : null}
            </div>
          }
          extra={
            <>
              <SelectorEstado estado={presencia.estado} error={presencia.error} onCambiar={(e) => void presencia.cambiar(e)} compacto={chatEncima} />
              {opciones?.es_admin ? (
                chatEncima ? (
                  <MenuAcciones
                    etiqueta="Más opciones de la bandeja"
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm"
                    items={[
                      { etiqueta: "Respuestas rápidas", icono: <Zap className="h-4 w-4" />, onClick: () => setModal("respuestas") },
                      ...(opciones.canales.some((c) => c.proveedor === "simulador" && c.activo)
                        ? [{ etiqueta: "Simular entrante", icono: <FlaskConical className="h-4 w-4" />, onClick: () => setModal("simular") }]
                        : []),
                    ]}
                  >
                    <MoreHorizontal className="h-5 w-5" aria-hidden />
                  </MenuAcciones>
                ) : (
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
                )
              ) : null}
            </>
          }
        >
          {hayFiltros ? (
            <>
              {opciones && opciones.canales.length > 1 ? (
                <Select
                  compacto
                  minWidth={160}
                  className={claseSelect}
                  etiqueta="Filtrar por canal"
                  value={canal}
                  onChange={setCanal}
                  options={[["", "Todos los canales"], ...opciones.canales.map((c): [string, string] => [c.id, c.nombre])]}
                />
              ) : null}
              {opciones && variasColas ? (
                <Select
                  compacto
                  minWidth={150}
                  className={claseSelect}
                  etiqueta="Filtrar por cola"
                  value={cola}
                  onChange={setCola}
                  options={[["", "Todas las colas"], ...opciones.colas.map((c): [string, string] => [c.id, c.nombre])]}
                />
              ) : null}
              {opciones && (vista === "todas" || vista === "cerradas") ? (
                <Select
                  compacto
                  minWidth={170}
                  className={claseSelect}
                  etiqueta="Filtrar por asesor"
                  value={asesor}
                  onChange={setAsesor}
                  options={[["", "Todos los asesores"], ...opciones.equipo.map((u): [string, string] => [u.id, u.nombre])]}
                />
              ) : null}
            </>
          ) : null}
        </BarraFiltros>
      </div>

      {b.error ? <div className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">{b.error}</div> : null}

      <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {/* Lista (en celular queda montada debajo del chat: al volver conserva el scroll) */}
        <div className="flex min-h-0 w-full shrink-0 flex-col border-slate-200 bg-slate-50/80 md:w-[280px] md:border-r lg:w-[320px] xl:w-[350px]">
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

        {/* Chat: al lado de la lista (≥ 768) o encima, a pantalla completa (celular) */}
        {conPortal(
        <div
          ref={capaChat}
          role={encima ? "dialog" : undefined}
          aria-modal={encima || undefined}
          aria-label={encima ? "Chat" : undefined}
          className={
            encima
              ? "pt-safe fixed inset-0 z-[45] flex min-h-0 min-w-0 flex-col overflow-hidden bg-white"
              : "hidden min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:flex"
          }
          style={encima ? { animation: "drawer-in 0.22s cubic-bezier(0.16,1,0.3,1)" } : undefined}
        >
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
        </div>,
        )}
      </div>

      {aviso ? (
        <div
          role="status"
          className={`fixed left-1/2 z-[140] flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white shadow-xl ${encima ? "bottom-[calc(5.5rem+env(safe-area-inset-bottom))]" : "bottom-[calc(1.25rem+env(safe-area-inset-bottom))]"} ${aviso.tono === "error" ? "bg-red-600" : "bg-slate-900"}`}
          style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}
        >
          {aviso.tono === "ok" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" /> : null}
          <span className="min-w-0 [overflow-wrap:anywhere]">{aviso.texto}</span>
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
