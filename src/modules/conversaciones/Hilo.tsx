"use client";

/**
 * Hilo de mensajes: separadores por día (hora de Paraguay), "ver anteriores" al llegar
 * arriba conservando la posición, y pegado al fondo mientras uno está abajo (un
 * ResizeObserver re-baja cuando una imagen termina de cargar o una burbuja con
 * content-visibility toma su alto real).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { diaPy, etiquetaDia, previewMensaje, type Mensaje } from "@/modules/conversaciones/dominio";
import { BurbujaMensaje, type Cita } from "@/modules/conversaciones/Burbuja";
import { useUrlsMedia } from "@/modules/conversaciones/media";
import { VisorImagen } from "@/modules/conversaciones/VisorImagen";
import { Girando } from "@/modules/conversaciones/ui";

export function Hilo({
  convId,
  mensajes,
  hayMas,
  cargando,
  cargandoAnteriores,
  error,
  ultimoId,
  cargarAnteriores,
  onResponder,
  onReintentar,
  onDescartar,
}: {
  convId: string;
  mensajes: Mensaje[];
  hayMas: boolean;
  cargando: boolean;
  cargandoAnteriores: boolean;
  error: string | null;
  ultimoId: string | null;
  cargarAnteriores: () => void;
  /** Sin onResponder el hilo es de solo lectura (Monitoreo, Finalizadas, Historial). */
  onResponder?: (m: Mensaje) => void;
  onReintentar: (id: string) => void;
  onDescartar: (id: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const contenido = useRef<HTMLDivElement>(null);
  const pegado = useRef(true);
  const ancla = useRef<{ alto: number; top: number } | null>(null);
  const [verBoton, setVerBoton] = useState(false);
  const [visor, setVisor] = useState<{ url: string; nombre: string } | null>(null);
  const urls = useUrlsMedia(convId, mensajes);

  // Chat nuevo → abajo de todo.
  useEffect(() => {
    pegado.current = true;
    ancla.current = null;
    setVerBoton(false);
  }, [convId]);

  const alFondo = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Después de cada cambio: conservar la posición si se agregaron anteriores; si no, bajar
  // cuando llega uno nuevo y uno estaba abajo (o es mío).
  const primeroId = mensajes[0]?.id ?? null;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (ancla.current) {
      // El anclaje nativo del navegador (overflow-anchor) suele compensar solo; si no lo hizo
      // (Safari, o estando en el borde de arriba), se corrige a mano.
      const esperado = el.scrollHeight - ancla.current.alto + ancla.current.top;
      if (Math.abs(el.scrollTop - esperado) > 2) el.scrollTop = esperado;
      ancla.current = null;
      return;
    }
    const ult = mensajes[mensajes.length - 1];
    if (pegado.current || (ult?.from_me && ult.local)) {
      pegado.current = true;
      el.scrollTop = el.scrollHeight;
    } else if (ult && !ult.from_me) {
      setVerBoton(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primeroId, ultimoId, cargando]);

  useEffect(() => {
    const c = contenido.current;
    if (!c) return;
    const ro = new ResizeObserver(() => pegado.current && alFondo());
    ro.observe(c);
    return () => ro.disconnect();
  }, [alFondo, convId]);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const cerca = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    pegado.current = cerca;
    if (cerca) setVerBoton(false);
    if (el.scrollTop < 150 && hayMas && !cargandoAnteriores && !cargando && !ancla.current) {
      ancla.current = { alto: el.scrollHeight, top: el.scrollTop };
      cargarAnteriores();
    }
  }, [hayMas, cargandoAnteriores, cargando, cargarAnteriores]);

  // Si "ver anteriores" no trajo nada nuevo, soltar el ancla.
  useEffect(() => {
    if (!cargandoAnteriores) {
      const t = window.setTimeout(() => (ancla.current = null), 0);
      return () => window.clearTimeout(t);
    }
  }, [cargandoAnteriores]);

  // Citas estables por id (las burbujas memo no se re-dibujan si no cambió la cita).
  const citasCache = useRef(new Map<string, Cita>());
  const porId = useMemo(() => new Map(mensajes.map((m) => [m.id, m])), [mensajes]);
  const citaDe = (m: Mensaje): Cita | null => {
    if (!m.responde_a) return null;
    const o = porId.get(m.responde_a);
    const clave = `${m.responde_a}|${o ? "1" : "0"}`;
    let c = citasCache.current.get(clave);
    if (!c) {
      c = o ? { id: o.id, from_me: o.from_me, preview: previewMensaje(o) } : { id: null, from_me: null, preview: "Mensaje anterior" };
      citasCache.current.set(clave, c);
    }
    return c;
  };

  const irA = useCallback((id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.animate([{ backgroundColor: "rgba(79,174,178,0.25)" }, { backgroundColor: "transparent" }], { duration: 1400 });
  }, []);
  const verImagen = useCallback((url: string, nombre: string) => setVisor({ url, nombre }), []);

  const filas: React.ReactNode[] = [];
  let diaAnterior = "";
  for (const m of mensajes) {
    const d = diaPy(m.created_at);
    if (d !== diaAnterior) {
      diaAnterior = d;
      filas.push(
        <div key={`d-${d}`} className="sticky top-1 z-[5] flex justify-center py-2">
          <span className="rounded-full border border-slate-200 bg-white/95 px-3 py-0.5 text-[11px] font-medium text-slate-500 shadow-sm">{etiquetaDia(m.created_at)}</span>
        </div>,
      );
    }
    filas.push(
      <BurbujaMensaje
        key={m.id}
        m={m}
        url={urls[m.id]}
        cita={citaDe(m)}
        onResponder={onResponder}
        onVerImagen={verImagen}
        onIrA={irA}
        onReintentar={onReintentar}
        onDescartar={onDescartar}
      />,
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="h-full overflow-y-auto overscroll-contain bg-gradient-to-b from-slate-100/90 to-slate-50/40 px-2 py-1 sm:px-3"
      >
        <div ref={contenido}>
          {hayMas || cargandoAnteriores ? (
            <div className="flex justify-center py-2">
              <button
                type="button"
                onClick={() => {
                  const el = scroller.current;
                  if (el) ancla.current = { alto: el.scrollHeight, top: el.scrollTop };
                  cargarAnteriores();
                }}
                disabled={cargandoAnteriores}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-[#3F8E91] shadow-sm hover:bg-slate-50 disabled:opacity-60 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-4 [@media(pointer:coarse)]:text-xs"
              >
                {cargandoAnteriores ? (
                  <>
                    <Girando /> Cargando…
                  </>
                ) : (
                  "Ver anteriores"
                )}
              </button>
            </div>
          ) : null}
          {cargando && !mensajes.length ? (
            <div className="py-8 text-center text-sm text-slate-400">Cargando mensajes…</div>
          ) : !mensajes.length ? (
            <div className="px-3 py-8 text-center text-sm text-slate-500">{error ? "No se pudieron cargar los mensajes." : "No hay mensajes para esta conversación."}</div>
          ) : (
            filas
          )}
        </div>
      </div>
      {verBoton ? (
        <button
          type="button"
          onClick={() => {
            pegado.current = true;
            setVerBoton(false);
            alFondo();
          }}
          className="absolute bottom-3 right-4 z-10 inline-flex items-center gap-1 rounded-full bg-[#4FAEB2] px-3 py-1.5 text-[11px] font-semibold text-white shadow-lg shadow-[#4FAEB2]/30 hover:bg-[#3F8E91] [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-4 [@media(pointer:coarse)]:text-xs"
        >
          <ArrowDown className="h-3.5 w-3.5" /> Mensajes nuevos
        </button>
      ) : null}
      {visor ? <VisorImagen url={visor.url} nombre={visor.nombre} onCerrar={() => setVisor(null)} /> : null}
    </div>
  );
}
