"use client";

/**
 * Campanita del header (portada del actual, components/layout/NotificacionesBell):
 *   · dos bandejas: General y Soporte (un ticket no se pierde entre otros avisos)
 *   · badge con las no leídas
 *   · tiempo real (Supabase Realtime sobre usuario_notificaciones) + polling de respaldo cada
 *     20 s: si el canal no entrega nada (publicación/RLS), la campanita funciona igual
 *   · SONIDO sólo por avisos NUEVOS después de la primera carga (abrir la app no suena)
 *   · click: abre la URL del aviso y lo marca leído · "Marcar todas como leídas" por bandeja
 *   · recordatorios de reunión de la Agenda (60 y 30 min antes): llegan calculados en vivo
 *     (`derivada`), sin fila en la base: no se marcan leídos, se apagan solos
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CalendarClock, Check, Info, Ticket, Volume2, VolumeX } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { browserClient } from "@/lib/supabase/browser";
import { fechaRelativa } from "@/modules/tipificacion/dominio";
import {
  escribirSonidoActivado, leerSonidoActivado, prepararSonidos, reproducirSonidoNotificacion,
} from "@/modules/notificaciones/sonido";

type Notificacion = {
  id: string;
  tipo: string;
  bandeja: "general" | "soporte" | string;
  titulo: string;
  cuerpo: string | null;
  url: string | null;
  leida_at: string | null;
  created_at: string;
  /** Recordatorio de reunión calculado en vivo (sin fila): no se puede marcar leído. */
  derivada?: boolean;
  cita_id?: string;
};
type Resp = {
  notificaciones: Notificacion[];
  no_leidas: { general: number; soporte: number; total: number };
  usuario_id: string;
  schema: string;
};

const POLL_MS = 20_000;

const ESTILO: Record<string, { icon: typeof Bell; wrap: string; label: string }> = {
  soporte: { icon: Ticket, wrap: "bg-orange-50 text-orange-600", label: "Soporte" },
  agenda: { icon: CalendarClock, wrap: "bg-teal-50 text-teal-700", label: "Agenda" },
  general: { icon: Info, wrap: "bg-sky-50 text-sky-600", label: "Aviso" },
};
const estiloDe = (n: Notificacion) =>
  n.bandeja === "soporte" || n.tipo.startsWith("soporte") ? ESTILO.soporte : n.tipo.startsWith("agenda") ? ESTILO.agenda : ESTILO.general;

export function NotificacionesBell() {
  const [abierto, setAbierto] = useState(false);
  const [items, setItems] = useState<Notificacion[]>([]);
  const [noLeidas, setNoLeidas] = useState({ general: 0, soporte: 0, total: 0 });
  const [bandeja, setBandeja] = useState<"general" | "soporte">("general");
  const [cargando, setCargando] = useState(false);
  const [sonido, setSonido] = useState(true);
  const [sesion, setSesion] = useState<{ usuarioId: string; schema: string } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** Ids no leídos ya vistos. `null` = todavía no cargó nunca: la primera carga no suena. */
  const vistosRef = useRef<Set<string> | null>(null);
  const cargarRef = useRef<() => Promise<void>>(async () => {});

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await apiFetch<Resp>("/api/notificaciones");
      setItems(r.notificaciones);
      setNoLeidas(r.no_leidas);
      setSesion((s) => (s?.usuarioId === r.usuario_id && s.schema === r.schema ? s : { usuarioId: r.usuario_id, schema: r.schema }));
      const noLeidasIds = r.notificaciones.filter((n) => !n.leida_at).map((n) => n.id);
      const previos = vistosRef.current;
      if (previos && noLeidasIds.some((id) => !previos.has(id))) reproducirSonidoNotificacion();
      vistosRef.current = new Set([...(previos ?? []), ...noLeidasIds]);
    } catch {
      // Sin conexión el header sigue funcionando: se reintenta en el próximo poll.
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargarRef.current = cargar; }, [cargar]);
  useEffect(() => {
    prepararSonidos();
    setSonido(leerSonidoActivado());
    void cargar();
  }, [cargar]);

  // Polling de respaldo (también al volver a la pestaña).
  useEffect(() => {
    const t = window.setInterval(() => void cargarRef.current(), POLL_MS);
    const vis = () => document.visibilityState === "visible" && void cargarRef.current();
    document.addEventListener("visibilitychange", vis);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, []);

  // Tiempo real: cualquier cambio en MIS notificaciones recarga la lista.
  useEffect(() => {
    if (!sesion) return;
    const sb = browserClient();
    let vivo = true;
    let canal: ReturnType<typeof sb.channel> | null = null;
    void (async () => {
      try {
        // Sin autenticar el socket, la RLS no deja pasar ni un evento.
        const { data } = await sb.auth.getSession();
        if (data.session?.access_token) sb.realtime.setAuth(data.session.access_token);
        if (!vivo) return;
        canal = sb
          .channel(`usuario-notificaciones:${sesion.usuarioId}`)
          .on(
            "postgres_changes",
            { event: "*", schema: sesion.schema, table: "usuario_notificaciones", filter: `usuario_id=eq.${sesion.usuarioId}` },
            () => void cargarRef.current(),
          )
          .subscribe();
      } catch {
        // Sólo se pierde el tiempo real; el polling cubre igual.
      }
    })();
    return () => {
      vivo = false;
      if (canal) void sb.removeChannel(canal);
    };
  }, [sesion]);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => !panelRef.current?.contains(e.target as Node) && setAbierto(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fuera); document.removeEventListener("keydown", esc); };
  }, [abierto]);

  const marcarLeidas = useCallback(async (payload: { ids?: string[]; todas?: boolean; bandeja?: "general" | "soporte" }) => {
    // Optimista: se apaga al instante y la recarga confirma.
    const ahora = new Date().toISOString();
    const afecta = (n: Notificacion) =>
      n.derivada ? false : payload.ids ? payload.ids.includes(n.id) : payload.bandeja === "soporte" ? n.bandeja === "soporte" : payload.bandeja === "general" ? n.bandeja !== "soporte" : true;
    setItems((prev) => prev.map((n) => (!n.leida_at && afecta(n) ? { ...n, leida_at: ahora } : n)));
    try {
      await apiFetch("/api/notificaciones", { method: "POST", body: JSON.stringify(payload) });
    } catch {
      /* la recarga muestra el estado real */
    } finally {
      void cargarRef.current();
    }
  }, []);

  const alternarSonido = () => {
    setSonido((v) => {
      escribirSonidoActivado(!v);
      if (!v) reproducirSonidoNotificacion(true);
      return !v;
    });
  };

  const esSoporte = (n: Notificacion) => n.bandeja === "soporte";
  const itemsBandeja = items.filter((n) => (bandeja === "soporte" ? esSoporte(n) : !esSoporte(n)));
  const hayNoLeidasBandeja = itemsBandeja.some((n) => !n.leida_at && !n.derivada);
  const total = noLeidas.total;

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => {
          const abrir = !abierto;
          setAbierto(abrir);
          if (abrir) {
            // Si lo único pendiente es de Soporte, se abre directo ahí.
            if (noLeidas.general === 0 && noLeidas.soporte > 0) setBandeja("soporte");
            else if (noLeidas.soporte === 0 && noLeidas.general > 0) setBandeja("general");
            void cargar();
          }
        }}
        aria-label="Notificaciones"
        aria-expanded={abierto}
        className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
      >
        <Bell className="h-5 w-5" />
        {total > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {total > 99 ? "99+" : total}
          </span>
        ) : null}
      </button>

      {abierto ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-3.5 py-2.5">
            <span className="text-sm font-semibold text-slate-900">Notificaciones</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={alternarSonido}
                title={sonido ? "Silenciar sonido de notificaciones" : "Activar sonido de notificaciones"}
                aria-pressed={sonido}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                {sonido ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                {sonido ? "Sonido" : "Silencio"}
              </button>
              {hayNoLeidasBandeja ? (
                <button
                  type="button"
                  onClick={() => void marcarLeidas({ todas: true, bandeja })}
                  className="text-[11px] font-semibold text-[var(--brand)] transition-colors hover:brightness-90"
                >
                  Marcar todas como leídas
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex gap-1 border-b border-slate-100 px-2.5 py-1.5" role="tablist">
            {([
              { id: "general", etiqueta: "General", n: noLeidas.general },
              { id: "soporte", etiqueta: "Soporte", n: noLeidas.soporte },
            ] as const).map((t) => {
              const sel = bandeja === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={sel}
                  onClick={() => setBandeja(t.id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                    sel ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  }`}
                >
                  {t.etiqueta}
                  {t.n > 0 ? (
                    <span className={`min-w-4 rounded-full px-1 text-center text-[10px] font-bold tabular-nums ${sel ? "bg-white/20 text-white" : "bg-rose-500 text-white"}`}>
                      {t.n > 99 ? "99+" : t.n}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <ul className="max-h-[26rem] divide-y divide-slate-100 overflow-y-auto">
            {itemsBandeja.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-slate-400">
                {cargando ? "Cargando…" : bandeja === "soporte" ? "No hay avisos de Soporte." : "Estás al día. No hay notificaciones."}
              </li>
            ) : (
              itemsBandeja.map((n) => {
                const estilo = estiloDe(n);
                const Icono = estilo.icon;
                const noLeida = !n.leida_at;
                // Los recordatorios derivados no tienen fila: su id no es un uuid y no se marcan.
                const marcable = noLeida && !n.derivada;
                const contenido = (
                  <div className={`flex gap-3 px-3.5 py-3 ${noLeida ? "bg-sky-50/40" : ""} ${marcable ? "pr-24" : ""}`}>
                    <span className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${estilo.wrap}`} aria-hidden>
                      <Icono className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <span className={`min-w-0 flex-1 break-words text-[13px] ${noLeida ? "font-semibold text-slate-900" : "font-medium text-slate-600"}`}>{n.titulo}</span>
                        {noLeida ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-rose-500" aria-label="Sin leer" /> : null}
                      </div>
                      {n.cuerpo ? <p className="mt-0.5 break-words text-[12px] leading-snug text-slate-600">{n.cuerpo}</p> : null}
                      <p className="mt-1 text-[11px] text-slate-400">{estilo.label} · {fechaRelativa(n.created_at)}</p>
                    </div>
                  </div>
                );
                return (
                  <li key={n.id} className="relative">
                    {n.url ? (
                      <Link
                        href={n.url}
                        onClick={() => { setAbierto(false); if (marcable) void marcarLeidas({ ids: [n.id] }); }}
                        className="block transition-colors hover:bg-slate-50"
                      >
                        {contenido}
                      </Link>
                    ) : (
                      <button type="button" onClick={() => marcable && void marcarLeidas({ ids: [n.id] })} className="block w-full text-left transition-colors hover:bg-slate-50">
                        {contenido}
                      </button>
                    )}
                    {/* Hermano del Link (no hijo): marcar leída nunca navega por accidente. */}
                    {marcable ? (
                      <button
                        type="button"
                        onClick={() => void marcarLeidas({ ids: [n.id] })}
                        title="Marcar como leída"
                        className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10.5px] font-semibold text-slate-500 shadow-sm ring-1 ring-slate-200 transition-colors hover:text-emerald-600 hover:ring-emerald-300"
                      >
                        <Check className="h-3 w-3" /> Leída
                      </button>
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
