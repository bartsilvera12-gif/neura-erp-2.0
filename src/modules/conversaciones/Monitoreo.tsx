"use client";

/**
 * Monitoreo (centro de control del omnicanal), como el del sistema actual: resumen,
 * chats sin asignar (asignar a un asesor o automáticamente), chats esperando respuesta por
 * asesor, agentes y carga con "leads del día", y lectura de cualquier chat.
 *
 * Datos: UNA consulta (chat_monitoreo). Se refresca cada 20 s con la pestaña visible (se
 * pausa oculta) y al toque —agrupado en 2 s— cuando llega un aviso "conversacion" del
 * tópico chat:<empresa>. Los relojes relativos laten cada 15 s sin red. Quien mira el
 * Monitoreo también late (presencia).
 */
import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HojaInferior } from "@/components/HojaInferior";
import { TablaScroll, TablaTarjetas } from "@/components/TablaResponsive";
import { useEsMovil } from "@/lib/ui/responsive";
import {
  ArrowLeftRight, Check, CheckCircle2, ChevronDown, Clock, Copy, Eye, Flame, MessageSquare, RefreshCw, Settings2,
  Timer, UserX, Users, WifiOff, X, Zap,
} from "lucide-react";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { hoyPY } from "@/lib/fecha/paraguay";
import { accionConversacion } from "@/modules/conversaciones/api";
import { asignarAutomatico, pedirLeads, pedirMonitoreo } from "@/modules/conversaciones/api-supervision";
import { nombreContacto, telefonoLegible } from "@/modules/conversaciones/dominio";
import { useBroadcast } from "@/modules/conversaciones/realtime";
import { usePresencia } from "@/modules/conversaciones/presencia";
import {
  ESTADO_AGENTE_LABEL, duracionCorta, motivoEspera,
  type AgenteMonitoreo, type DatosMonitoreo, type Esperando, type LeadDia,
} from "@/modules/conversaciones/supervision";
import {
  AvatarTono, Cargando, Desde, Encabezado, Metrica, PillEstado, PuntoOnline, Seccion, SelectorEstado, SlaBadge, Vacio,
  VOLVER_OMNICANAL, btnIcono, btnPrimario, btnSecundario, thClase,
} from "@/modules/conversaciones/ui-supervision";
import { Girando } from "@/modules/conversaciones/ui";
import { SelectorFecha } from "@/components/SelectorFecha";

const VisorChat = dynamic(() => import("@/modules/conversaciones/VisorChat").then((m) => m.VisorChat), { ssr: false });

const REFRESCO_MS = 20_000;
const AGRUPAR_AVISOS_MS = 2_000;

type Visor = { id: string; nombre: string | null; telefono: string | null };
type Aviso = { texto: string; tono: "ok" | "error" };

const nombreDe = (n: string | null | undefined, tel: string | null | undefined) =>
  nombreContacto({ contacto_nombre: n ?? null, contacto_telefono: tel ?? null });

const MOTIVO_AUTO: Record<string, string> = {
  sin_agente: "No hay asesores disponibles con lugar en la cola: quedó esperando.",
  cola_manual: "La cola es de asignación manual: elegí un asesor.",
  sin_cola: "No hay una cola activa para ese canal.",
  ya_asignada: "Ya estaba asignada.",
};

export function Monitoreo() {
  const me = useUsuario();
  const presencia = usePresencia();
  const [datos, setDatos] = useState<DatosMonitoreo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sinPermiso, setSinPermiso] = useState(false);
  const [refrescando, setRefrescando] = useState(false);
  const [actualizado, setActualizado] = useState<string | null>(null);
  const [fecha, setFecha] = useState(() => hoyPY());
  const [abiertas, setAbiertas] = useState({ sin: true, esperando: true, agentes: true });
  const [grupoAbierto, setGrupoAbierto] = useState<string | null>(null);
  const [visor, setVisor] = useState<Visor | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const fechaRef = useRef(fecha);
  fechaRef.current = fecha;
  const abortRef = useRef<AbortController | null>(null);

  const cargar = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setRefrescando(true);
    try {
      const d = await pedirMonitoreo(fechaRef.current === hoyPY() ? undefined : fechaRef.current, ac.signal);
      if (ac.signal.aborted) return;
      setDatos(d);
      setError(null);
      setActualizado(new Date().toISOString());
    } catch (e) {
      if (ac.signal.aborted) return;
      const m = (e as Error).message;
      if (/permiso/i.test(m)) setSinPermiso(true);
      setError(m || "Error al cargar");
    } finally {
      if (!ac.signal.aborted) setRefrescando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar, fecha]);

  // Cada 20 s con la pestaña visible; al volver a la pestaña, al toque.
  useEffect(() => {
    let t: number | null = null;
    const arrancar = () => {
      if (t == null) t = window.setInterval(() => void cargar(), REFRESCO_MS);
    };
    const parar = () => {
      if (t != null) window.clearInterval(t);
      t = null;
    };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void cargar();
        arrancar();
      } else parar();
    };
    if (document.visibilityState === "visible") arrancar();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      parar();
      document.removeEventListener("visibilitychange", onVis);
      abortRef.current?.abort();
    };
  }, [cargar]);

  // Aviso Realtime de cualquier conversación → refresco agrupado (2 s).
  const timerAviso = useRef<number | null>(null);
  const onConversacion = useCallback(() => {
    if (timerAviso.current != null || document.visibilityState !== "visible") return;
    timerAviso.current = window.setTimeout(() => {
      timerAviso.current = null;
      void cargar();
    }, AGRUPAR_AVISOS_MS);
  }, [cargar]);
  useEffect(() => () => {
    if (timerAviso.current != null) window.clearTimeout(timerAviso.current);
  }, []);
  const suscripto = useBroadcast(me?.empresaId ? `chat:${me.empresaId}` : null, useMemo(() => ({ conversacion: onConversacion }), [onConversacion]));

  useEffect(() => {
    if (!aviso) return;
    const t = window.setTimeout(() => setAviso(null), 4500);
    return () => window.clearTimeout(t);
  }, [aviso]);

  const agentes = useMemo(() => datos?.agentes ?? [], [datos]);
  const porId = useMemo(() => new Map(agentes.map((a) => [a.id, a])), [agentes]);

  const asignar = useCallback(
    async (convId: string, destino: string | "auto") => {
      setOcupado(convId);
      try {
        if (destino === "auto") {
          const r = await asignarAutomatico(convId);
          if (r.asignada) setAviso({ texto: `Asignada a ${porId.get(r.usuario_id ?? "")?.nombre ?? r.fila?.asignado_nombre ?? "un asesor"}`, tono: "ok" });
          else setAviso({ texto: MOTIVO_AUTO[r.motivo ?? ""] ?? "No se pudo asignar automáticamente.", tono: "error" });
        } else {
          const f = await accionConversacion(convId, { accion: "transferir", asignado_id: destino });
          setAviso({ texto: `Asignada a ${f.asignado_nombre ?? porId.get(destino)?.nombre ?? "el asesor"}`, tono: "ok" });
        }
        await cargar();
      } catch (e) {
        setAviso({ texto: (e as Error).message, tono: "error" });
      } finally {
        setOcupado(null);
      }
    },
    [cargar, porId],
  );

  // Esperando respuesta, agrupado por asesor (más pendientes primero).
  const grupos = useMemo(() => {
    const m = new Map<string, Esperando[]>();
    for (const e of datos?.esperando ?? []) {
      if (!m.has(e.asignado_id)) m.set(e.asignado_id, []);
      m.get(e.asignado_id)!.push(e);
    }
    return [...m.entries()]
      .map(([id, items]) => ({ id, nombre: porId.get(id)?.nombre ?? "Asesor", items }))
      .sort((a, b) => b.items.length - a.items.length || a.nombre.localeCompare(b.nombre));
  }, [datos, porId]);

  const esAdmin = datos?.es_admin ?? me?.rol === "ADMIN";
  const r = datos?.resumen;
  const hoy = hoyPY();
  const etiquetaLeads = fecha === hoy ? "Leads hoy" : `Leads ${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
  const totalLeads = agentes.reduce((s, a) => s + a.leads, 0);

  if (sinPermiso) {
    return (
      <div className="flex flex-col gap-6 pb-10">
        <Encabezado volver={VOLVER_OMNICANAL} eyebrow="Centro de control" titulo="Monitoreo" />
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          El Monitoreo es para administradores y supervisores de una cola. Pedile a un administrador que te marque como supervisor en la configuración de colas.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-10">
      <Encabezado
        volver={VOLVER_OMNICANAL}
        eyebrow="Centro de control"
        titulo="Monitoreo"
        detalle={
          datos?.equipo_limitado
            ? "Tu equipo: los asesores que tenés a cargo y los chats que esperan respuesta de ellos (los sin asignar se ven todos)."
            : "Colas, canales, carga de agentes y conversaciones que requieren atención."
        }
      >
        <span
          className={`inline-flex items-center gap-1 text-[11px] font-medium ${suscripto ? "text-emerald-600" : "text-amber-600"}`}
          title={suscripto ? "Recibiendo cambios en vivo (y refresco cada 20 s)" : "Sin conexión en vivo: se actualiza cada 20 s"}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${suscripto ? "bg-emerald-500" : "animate-pulse bg-amber-500"}`} />
          {suscripto ? "En vivo" : "Reconectando…"}
          {actualizado ? (
            <span className="text-slate-400">
              {" "}· hace <Desde iso={actualizado} />
            </span>
          ) : null}
        </span>
        <SelectorEstado estado={presencia.estado} error={presencia.error} onCambiar={(e) => void presencia.cambiar(e)} />
        {esAdmin ? (
          <Link href="/conversaciones/monitoreo/colas" className={`${btnSecundario} py-2`}>
            <Settings2 className="h-3.5 w-3.5" aria-hidden /> Configurar colas
          </Link>
        ) : null}
        <Link href="/conversaciones" className={btnPrimario}>
          Ir a la bandeja →
        </Link>
      </Encabezado>

      {error && datos ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}

      {/* Resumen */}
      <Seccion
        titulo="Resumen general"
        destacada
        acciones={
          <button type="button" onClick={() => void cargar()} disabled={refrescando} className={btnSecundario}>
            {refrescando ? <Girando className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />} Actualizar
          </button>
        }
      >
        {!r ? (
          error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : <Cargando texto="Cargando métricas…" />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
            <Metrica label={etiquetaLeads} valor={totalLeads} icono={<Flame className="h-4 w-4" />} tono="success" />
            <Metrica label="Chats abiertos" valor={r.abiertas} icono={<MessageSquare className="h-4 w-4" />} tono="featured" pie={`${r.nuevos_hoy} nuevos hoy`} />
            <Metrica label="Sin asignar" valor={r.sin_asignar} icono={<UserX className="h-4 w-4" />} tono="warning" />
            <Metrica label="Esperando respuesta" valor={r.esperando_respuesta} icono={<Clock className="h-4 w-4" />} tono="warning" />
            <Metrica label="SLA vencidos" valor={r.sla_vencidos} icono={<Timer className="h-4 w-4" />} tono={r.sla_vencidos > 0 ? "danger" : "neutral"} />
            <Metrica label="Fuera de 24 h" valor={r.fuera_de_ventana} icono={<WifiOff className="h-4 w-4" />} tono="neutral" pie="Solo plantillas" />
            <Metrica label="Agentes en línea" valor={r.agentes_online} icono={<Users className="h-4 w-4" />} tono="success" pie={`de ${agentes.length}`} />
            <Metrica label="Cerradas hoy" valor={r.cerradas_hoy} icono={<CheckCircle2 className="h-4 w-4" />} tono="neutral" />
          </div>
        )}
      </Seccion>

      {/* Sin asignar */}
      <Seccion
        titulo="Chats sin asignar"
        contador={datos?.sin_asignar.length}
        tonoContador="amber"
        ayuda={
          <>
            Motivo: cola manual, sin agentes en estado <strong>Disponible</strong> con lugar para autoasignar, u otra espera en cola. Asignalos a mano o probá
            la asignación automática.
          </>
        }
        acciones={<Plegar abierto={abiertas.sin} onClick={() => setAbiertas((v) => ({ ...v, sin: !v.sin }))} />}
      >
        {!abiertas.sin ? null : !datos ? (
          <Cargando />
        ) : !datos.sin_asignar.length ? (
          <Vacio ok>No hay conversaciones abiertas sin agente en este momento.</Vacio>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <TablaTarjetas
              filas={datos.sin_asignar}
              claveFila={(c) => c.id}
              minAncho={760}
              thBase={thClase}
              tdBase="px-4 py-3"
              claseFila={() => "hover:bg-[#4FAEB2]/[0.04]"}
              columnas={[
                {
                  key: "espera",
                  titulo: "Espera",
                  movil: "valor",
                  celda: (c) => (
                    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                      <Clock className="h-3 w-3" aria-hidden /> <Desde iso={c.ultimo_mensaje_at} />
                    </span>
                  ),
                },
                {
                  key: "contacto",
                  titulo: "Contacto",
                  movil: "titulo",
                  celda: (c) => {
                    const nombre = nombreDe(c.contacto, c.telefono);
                    return (
                      <div className="flex min-w-0 items-center gap-2.5">
                        <AvatarTono nombre={nombre} />
                        <div className="min-w-0">
                          <button type="button" onClick={() => setVisor({ id: c.id, nombre: c.contacto, telefono: c.telefono })} className="block max-w-[14rem] truncate text-left text-sm font-semibold text-slate-900 hover:text-[#3F8E91] hover:underline">
                            {nombre}
                          </button>
                          <p className="font-mono text-[11px] text-slate-500">{telefonoLegible(c.telefono)}</p>
                          {c.preview ? <p className="max-w-[18rem] truncate text-[11px] text-slate-400">{c.preview}</p> : null}
                        </div>
                      </div>
                    );
                  },
                  celdaMovil: (c) => (
                    <button type="button" onClick={() => setVisor({ id: c.id, nombre: c.contacto, telefono: c.telefono })} className="min-h-11 text-left">
                      {nombreDe(c.contacto, c.telefono)}
                      <span className="block font-mono text-[12px] font-normal text-slate-500">{telefonoLegible(c.telefono)}</span>
                    </button>
                  ),
                },
                { key: "canal", titulo: "Canal", movil: "dato", claseTd: "text-slate-700", celda: (c) => c.canal ?? "—" },
                { key: "cola", titulo: "Cola", movil: "dato", claseTd: "text-slate-700", celda: (c) => c.cola ?? "—" },
                {
                  key: "motivo",
                  titulo: "Motivo",
                  movil: "chip",
                  celda: (c) => {
                    const mot = motivoEspera(c.motivo, c.cola);
                    return (
                      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${mot.clase}`}>
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                        {mot.label}
                      </span>
                    );
                  },
                },
                { key: "preview", titulo: "Último mensaje", movil: "detalle", claseTh: "hidden", claseTd: "hidden", celda: (c) => c.preview || "—" },
                {
                  key: "acciones",
                  titulo: "Acciones",
                  movil: "acciones",
                  claseTh: "text-right",
                  celda: (c) => (
                    <div className="flex items-center justify-end gap-1.5">
                      <button type="button" className={btnIcono} title="Leer el chat" aria-label="Leer el chat" onClick={() => setVisor({ id: c.id, nombre: c.contacto, telefono: c.telefono })}>
                        <Eye className="h-4 w-4" />
                      </button>
                      <MenuAsignar agentes={agentes} ocupado={ocupado === c.id} onElegir={(d) => void asignar(c.id, d)} />
                    </div>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Seccion>

      {/* Esperando respuesta, por asesor */}
      <Seccion
        titulo="Chats esperando respuesta"
        contador={grupos.length}
        tonoContador="orange"
        ayuda="Por asesor: el último mensaje es del cliente. Desplegá para ver contacto, canal, SLA y tiempo de espera."
        acciones={<Plegar abierto={abiertas.esperando} onClick={() => setAbiertas((v) => ({ ...v, esperando: !v.esperando }))} />}
      >
        {!abiertas.esperando ? null : !datos ? (
          <Cargando />
        ) : !grupos.length ? (
          <p className="text-sm text-slate-500">No hay conversaciones esperando respuesta.</p>
        ) : (
          <div className="space-y-2">
            {grupos.map((g) => {
              const abierto = grupoAbierto === g.id;
              const a = porId.get(g.id);
              return (
                <div key={g.id} className={`overflow-hidden rounded-xl border bg-white ${abierto ? "border-[#4FAEB2]/40 shadow-sm" : "border-slate-200"}`}>
                  <button type="button" onClick={() => setGrupoAbierto(abierto ? null : g.id)} aria-expanded={abierto} className="flex min-h-14 w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-[#4FAEB2]/[0.04] sm:px-4">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <AvatarTono nombre={g.nombre} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                          {g.nombre} {a ? <PuntoOnline online={a.online} /> : null}
                        </span>
                        {a ? <span className="text-[11px] text-slate-500">{ESTADO_AGENTE_LABEL[a.estado]} · {a.carga} chats activos</span> : null}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-[11px] font-bold text-orange-700">
                        <Flame className="h-3 w-3" aria-hidden /> {g.items.length}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500 max-sm:hidden">{abierto ? "Ocultar" : "Ver"}</span>
                      <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${abierto ? "rotate-180" : ""}`} aria-hidden />
                    </span>
                  </button>
                  {abierto ? (
                    <div className="space-y-2 border-t border-slate-100 bg-slate-50/40 px-2.5 py-3 sm:px-4">
                      {g.items.map((e) => (
                        <div key={e.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
                          <div className="min-w-0 max-sm:basis-full">
                            <button type="button" onClick={() => setVisor({ id: e.id, nombre: e.contacto, telefono: e.telefono })} className="text-sm font-semibold text-[#3F8E91] hover:underline">
                              {e.contacto?.trim() || telefonoLegible(e.telefono) || "Contacto sin datos"}
                            </button>
                            <p className="text-[11px] text-slate-500">
                              {e.contacto?.trim() ? <span className="font-mono">{telefonoLegible(e.telefono)}</span> : null}
                              {e.canal ? ` · ${e.canal}` : ""}
                            </p>
                          </div>
                          <div className="flex min-w-0 items-center gap-2 max-sm:w-full max-sm:justify-between">
                            <div className="flex min-w-0 flex-col items-end gap-1 max-sm:items-start">
                              <div className="flex items-center gap-1">
                                <SlaBadge vence={e.sla_vence_at} primera={null} />
                                <span className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-700">
                                  <Clock className="h-3 w-3" aria-hidden /> <Desde iso={e.desde} />
                                </span>
                              </div>
                              {e.preview ? <p className="line-clamp-1 max-w-[18rem] text-[11px] text-slate-400 [overflow-wrap:anywhere]">{e.preview}</p> : null}
                            </div>
                            <button type="button" className={`${btnIcono} h-7 w-7 shrink-0`} title="Leer el chat" aria-label="Leer el chat" onClick={() => setVisor({ id: e.id, nombre: e.contacto, telefono: e.telefono })}>
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Seccion>

      {/* Agentes y carga */}
      <Seccion
        titulo="Agentes y carga"
        contador={agentes.length}
        acciones={
          <>
            <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-600" title="La columna Leads es por esta fecha; el resto es estado en vivo.">
              Leads del día
              <SelectorFecha
                compacto
                etiqueta="Leads del día"
                value={fecha}
                max={hoy}
                onChange={(v) => v && setFecha(v)}
                claseBoton="rounded-lg px-2 py-1 text-xs font-normal text-slate-700"
              />
            </div>
            {fecha !== hoy ? (
              <button type="button" className={btnSecundario} onClick={() => setFecha(hoy)}>
                Hoy
              </button>
            ) : null}
            <Plegar abierto={abiertas.agentes} onClick={() => setAbiertas((v) => ({ ...v, agentes: !v.agentes }))} />
          </>
        }
      >
        {!abiertas.agentes ? null : !datos ? (
          <Cargando />
        ) : !agentes.length ? (
          <Vacio>
            No hay asesores en ninguna cola.{" "}
            {esAdmin ? (
              <Link href="/conversaciones/monitoreo/colas" className="font-semibold text-[#3F8E91] hover:underline">
                Configurá las colas
              </Link>
            ) : null}
          </Vacio>
        ) : (
          <TablaAgentes agentes={agentes} fecha={fecha} etiquetaLeads={etiquetaLeads} onLeer={setVisor} />
        )}
      </Seccion>

      {visor ? <VisorChat convId={visor.id} nombre={visor.nombre} telefono={visor.telefono} onCerrar={() => setVisor(null)} /> : null}

      {aviso ? (
        <div
          role="status"
          className={`fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-1/2 z-[140] flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white shadow-xl ${aviso.tono === "error" ? "bg-red-600" : "bg-slate-900"}`}
          style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}
        >
          {aviso.tono === "ok" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" /> : null}
          <span className="min-w-0 [overflow-wrap:anywhere]">{aviso.texto}</span>
        </div>
      ) : null}
    </div>
  );
}

function Plegar({ abierto, onClick }: { abierto: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={btnSecundario} title={abierto ? "Ocultar listado" : "Mostrar listado"} aria-expanded={abierto}>
      {abierto ? "Ocultar" : "Mostrar"}
      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${abierto ? "rotate-180" : ""}`} aria-hidden />
    </button>
  );
}

// ── Asignar (a un asesor o automático) ───────────────────────────────────────
/** Menú en posición fija (la tabla tiene overflow y lo recortaría). */
function MenuAsignar({ agentes, ocupado, onElegir }: { agentes: AgenteMonitoreo[]; ocupado: boolean; onElegir: (destino: string | "auto") => void }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // Celular: la lista va en una hoja inferior (el menú fijo no entra y se cerraría al scrollear).
  const esMovil = useEsMovil();
  useEffect(() => {
    if (!pos || esMovil) return;
    const cerrar = () => setPos(null);
    const fuera = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !boton.current?.contains(e.target as Node)) cerrar();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && cerrar();
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", cerrar);
    window.addEventListener("scroll", cerrar, true);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", cerrar);
      window.removeEventListener("scroll", cerrar, true);
    };
  }, [pos, esMovil]);
  const lista = useMemo(
    () => [...agentes].sort((a, b) => Number(b.online) - Number(a.online) || a.carga - b.carga || a.nombre.localeCompare(b.nombre)),
    [agentes],
  );
  const abrir = () => {
    if (esMovil) return setPos({ top: 0, right: 0 });
    const r = boton.current?.getBoundingClientRect();
    if (!r) return;
    const alto = Math.min(360, 56 + lista.length * 46);
    const top = r.bottom + 4 + alto > window.innerHeight ? Math.max(8, r.top - 4 - alto) : r.bottom + 4;
    setPos({ top, right: Math.max(8, window.innerWidth - r.right) });
  };
  return (
    <>
      <button
        ref={boton}
        type="button"
        disabled={ocupado}
        onClick={() => (pos ? setPos(null) : abrir())}
        className={`${btnIcono} w-auto gap-1 px-2.5 text-xs font-semibold`}
        title="Asignar a un asesor"
        aria-haspopup="menu"
        aria-expanded={!!pos}
      >
        {ocupado ? <Girando className="h-3.5 w-3.5" /> : <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />} Asignar
      </button>
      {pos && esMovil ? (
        <HojaInferior titulo="Asignar a…" onClose={() => setPos(null)} sinPadding>
          <div role="menu" className="p-2">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setPos(null);
                onElegir("auto");
              }}
              className="flex min-h-12 w-full items-center gap-2.5 rounded-xl bg-[#4FAEB2]/8 px-3.5 text-left text-[15px] font-semibold text-[#3F8E91]"
            >
              <Zap className="h-4 w-4" aria-hidden /> Asignar automáticamente
              <span className="ml-auto text-[11px] font-normal text-slate-400">regla de la cola</span>
            </button>
            {!lista.length ? <p className="px-3 py-3 text-sm text-slate-500">No hay asesores en las colas.</p> : null}
            {lista.map((a) => (
              <button
                key={a.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setPos(null);
                  onElegir(a.id);
                }}
                className="mt-0.5 flex min-h-12 w-full items-center gap-3 rounded-xl px-3.5 text-left active:bg-slate-100"
              >
                <PuntoOnline online={a.online} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-slate-800">{a.nombre}</span>
                  <span className="block text-xs text-slate-500">
                    {ESTADO_AGENTE_LABEL[a.estado]} · {a.carga} {a.carga === 1 ? "chat" : "chats"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </HojaInferior>
      ) : null}
      {pos && !esMovil
        ? createPortal(
            <div
              ref={menu}
              role="menu"
              style={{ position: "fixed", top: pos.top, right: pos.right, animation: "modal-pop 0.15s cubic-bezier(0.16,1,0.3,1)" }}
              className="z-[130] w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setPos(null);
                  onElegir("auto");
                }}
                className="flex w-full items-center gap-2 border-b border-slate-100 bg-[#4FAEB2]/5 px-3 py-2.5 text-left text-xs font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/10"
              >
                <Zap className="h-3.5 w-3.5" aria-hidden /> Asignar automáticamente
                <span className="ml-auto text-[10px] font-normal text-slate-400">regla de la cola</span>
              </button>
              <div className="max-h-[300px] overflow-y-auto overscroll-contain py-1">
                {!lista.length ? <p className="px-3 py-3 text-xs text-slate-500">No hay asesores en las colas.</p> : null}
                {lista.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setPos(null);
                      onElegir(a.id);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <PuntoOnline online={a.online} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-slate-800">{a.nombre}</span>
                      <span className="block text-[10.5px] text-slate-500">
                        {ESTADO_AGENTE_LABEL[a.estado]} · {a.carga} {a.carga === 1 ? "chat" : "chats"}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

// ── Agentes y carga + leads del día ──────────────────────────────────────────
function TablaAgentes({
  agentes,
  fecha,
  etiquetaLeads,
  onLeer,
}: {
  agentes: AgenteMonitoreo[];
  fecha: string;
  etiquetaLeads: string;
  onLeer: (v: Visor) => void;
}) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const [leads, setLeads] = useState<Record<string, LeadDia[] | "cargando" | { error: string }>>({});

  // Cambia la fecha → se limpia el detalle.
  useEffect(() => {
    setAbierto(null);
    setLeads({});
  }, [fecha]);

  const cargarLeads = useCallback(
    (id: string) => {
      setLeads((v) => ({ ...v, [id]: "cargando" }));
      pedirLeads(id, fecha)
        .then((l) => setLeads((v) => ({ ...v, [id]: l })))
        .catch((e) => setLeads((v) => ({ ...v, [id]: { error: (e as Error).message } })));
    },
    [fecha],
  );
  const alternar = (id: string) => {
    if (abierto === id) return setAbierto(null);
    setAbierto(id);
    if (!leads[id] || typeof leads[id] === "object" && "error" in (leads[id] as object)) cargarLeads(id);
  };
  const sel = abierto ? agentes.find((a) => a.id === abierto) : null;
  const det = abierto ? leads[abierto] : undefined;

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-slate-200 [--tabla-fondo-cabecera:#f8fafc]">
        <TablaScroll primeraFija>
        <table className="w-full min-w-[920px] text-sm">
          <thead className="bg-slate-50/80">
            <tr>
              <th className={thClase}>Agente</th>
              <th className={thClase}>En línea</th>
              <th className={thClase}>Estado</th>
              <th className={thClase}>Último latido</th>
              <th className={thClase}>{etiquetaLeads}</th>
              <th className={thClase}>Chats activos</th>
              <th className={thClase}>Esperando resp.</th>
              <th className={thClase}>SLA vencidos</th>
              <th className={thClase}>Cerradas hoy</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {agentes.map((a) => (
              <tr key={a.id} className={abierto === a.id ? "bg-[#4FAEB2]/[0.06]" : "hover:bg-[#4FAEB2]/[0.03]"}>
                <td className="px-4 py-3 max-sm:px-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <AvatarTono nombre={a.nombre} />
                    <div className="min-w-0">
                      <p className="max-w-[200px] truncate text-sm font-semibold text-slate-900 max-sm:max-w-[120px]">{a.nombre}</p>
                      <p className="max-w-[200px] truncate text-[11px] text-slate-500 max-sm:max-w-[120px]" title={(a.colas ?? []).join(", ")}>
                        {a.colas?.length ? a.colas.join(" · ") : "Sin cola"}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                      a.online ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"
                    }`}
                  >
                    <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${a.online ? "bg-emerald-500" : "bg-slate-400"}`} />
                    {a.online ? "Sí" : "No"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <PillEstado estado={a.estado} />
                </td>
                <td className="px-4 py-3 text-xs text-slate-600">{a.ultimo_latido_at ? <Desde iso={a.ultimo_latido_at} /> : "—"}</td>
                <td className="px-4 py-3">
                  {a.leads > 0 ? (
                    <button
                      type="button"
                      onClick={() => alternar(a.id)}
                      aria-expanded={abierto === a.id}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-sm font-semibold tabular-nums text-[#3F8E91] [@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:px-3 ${
                        abierto === a.id ? "border-[#4FAEB2] bg-[#4FAEB2]/12" : "border-transparent hover:bg-[#4FAEB2]/8"
                      }`}
                    >
                      {a.leads}
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${abierto === a.id ? "rotate-180" : ""}`} aria-hidden />
                    </button>
                  ) : (
                    <span className="tabular-nums text-slate-400">0</span>
                  )}
                </td>
                <td className="px-4 py-3 font-semibold tabular-nums text-slate-900">{a.carga}</td>
                <td className={`px-4 py-3 font-semibold tabular-nums ${a.esperando_respuesta > 0 ? "text-amber-700" : "text-slate-500"}`}>{a.esperando_respuesta}</td>
                <td className={`px-4 py-3 font-semibold tabular-nums ${a.sla_vencidos > 0 ? "text-rose-700" : "text-slate-500"}`}>{a.sla_vencidos}</td>
                <td className="px-4 py-3 tabular-nums text-slate-700">{a.cerradas_hoy}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </TablaScroll>
      </div>

      {sel ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-[#4FAEB2]/30 bg-slate-50/40">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 sm:px-4 sm:py-2.5">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              Chats de {sel.nombre}
              {Array.isArray(det) ? <span className="rounded-full border border-[#4FAEB2]/30 bg-[#4FAEB2]/10 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-[#3F8E91]">{det.length}</span> : null}
            </p>
            <button type="button" onClick={() => setAbierto(null)} className="inline-flex items-center justify-center rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" aria-label="Cerrar">
              <X className="h-4 w-4" />
            </button>
          </div>
          {det === "cargando" || det === undefined ? (
            <div className="px-4"><Cargando texto={`Cargando chats de ${sel.nombre}…`} /></div>
          ) : !Array.isArray(det) ? (
            <div className="m-4 flex items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {det.error}
              <button type="button" className={btnSecundario} onClick={() => cargarLeads(sel.id)}>Reintentar</button>
            </div>
          ) : !det.length ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">
              No hay chats asignados a {sel.nombre} {fecha === hoyPY() ? "el día de hoy" : "en esa fecha"}.
            </p>
          ) : (
            <div className="bg-white">
              <TablaTarjetas
                filas={det}
                claveFila={(l) => l.id}
                minAncho={760}
                claseTabla="w-full table-fixed text-sm"
                claseThead=""
                thBase={thClase}
                tdBase="px-4 py-2.5"
                columnas={[
                  {
                    key: "contacto",
                    titulo: "Contacto",
                    movil: "titulo",
                    claseTh: "w-[30%]",
                    celda: (l) => <ContactoLead l={l} />,
                    celdaMovil: (l) => nombreDe(l.contacto, l.telefono),
                  },
                  { key: "tel", titulo: "Teléfono", movil: "subtitulo", claseTh: "hidden", claseTd: "hidden", celda: (l) => <TelefonoLead l={l} /> },
                  { key: "canal", titulo: "Canal", movil: "dato", claseTh: "w-[14%]", claseTd: "truncate text-slate-700", celda: (l) => l.canal ?? "—" },
                  {
                    key: "ultimo",
                    titulo: "Último mensaje",
                    movil: "detalle",
                    claseTh: "w-[28%]",
                    celda: (l) => (
                      <>
                        <p className="truncate text-xs text-slate-600 max-md:whitespace-normal" title={l.ultimo_preview ?? ""}>{l.ultimo_preview || "—"}</p>
                        <p className="text-[11px] text-slate-400">
                          hace <Desde iso={l.ultimo_mensaje_at} />
                        </p>
                      </>
                    ),
                  },
                  {
                    key: "primera",
                    titulo: "1ª respuesta",
                    movil: "dato",
                    claseTh: "w-[12%]",
                    claseTd: "text-xs",
                    celda: (l) =>
                      l.sin_respuesta ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Sin responder</span>
                      ) : (
                        <span className="tabular-nums text-slate-700">{duracionCorta(l.primera_respuesta_seg)}</span>
                      ),
                  },
                  {
                    key: "estado",
                    titulo: "Estado",
                    movil: "chip",
                    claseTh: "w-[8%]",
                    celda: (l) => (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                          l.estado === "cerrada" ? "border-slate-200 bg-slate-100 text-slate-600" : "border-emerald-200 bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {l.estado === "cerrada" ? "Cerrada" : "Abierta"}
                      </span>
                    ),
                  },
                  {
                    key: "acciones",
                    titulo: "Acciones",
                    movil: "acciones",
                    claseTh: "w-[8%] text-right",
                    claseTd: "text-right",
                    celda: (l) => (
                      <button
                        type="button"
                        onClick={() => onLeer({ id: l.id, nombre: l.contacto, telefono: l.telefono })}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#4FAEB2]/50 bg-[#4FAEB2]/8 px-3 py-1.5 text-xs font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/15"
                      >
                        <Eye className="h-3.5 w-3.5" /> Leer
                      </button>
                    ),
                  },
                ]}
              />
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}

/** Contacto de un lead (celda de escritorio): avatar, nombre, teléfono y copiar. */
function ContactoLead({ l }: { l: LeadDia }) {
  const nombre = nombreDe(l.contacto, l.telefono);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <AvatarTono nombre={nombre} chico />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900">{nombre}</p>
        <TelefonoLead l={l} />
      </div>
    </div>
  );
}

function TelefonoLead({ l }: { l: LeadDia }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = () => {
    if (!l.telefono) return;
    void navigator.clipboard?.writeText(l.telefono).then(() => {
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1500);
    });
  };
  return (
    <span className="flex items-center gap-1 font-mono text-[11px] text-slate-500 max-md:text-[12px]">
      {telefonoLegible(l.telefono)}
      {l.telefono ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            copiar();
          }}
          title={copiado ? "¡Copiado!" : "Copiar número"}
          aria-label="Copiar número"
          className="inline-flex items-center justify-center rounded p-0.5 text-slate-400 hover:text-[#3F8E91] [@media(pointer:coarse)]:-my-2 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
        >
          {copiado ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
        </button>
      ) : null}
    </span>
  );
}
