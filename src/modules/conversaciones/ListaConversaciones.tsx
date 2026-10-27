"use client";

/**
 * Lista de chats: tarjetas memo de alto fijo (content-visibility) + "cargar más" por cursor
 * con IntersectionObserver (el centinela del final pide la página siguiente sola; el botón
 * queda por si el observer no dispara).
 */
import { useEffect, useRef } from "react";
import type { FilaBandeja } from "@/modules/conversaciones/dominio";
import { TarjetaConversacion } from "@/modules/conversaciones/TarjetaConversacion";
import { Girando } from "@/modules/conversaciones/ui";

export function ListaConversaciones({
  filas,
  seleccionadaId,
  detalle,
  cargando,
  hayMas,
  cargandoMas,
  hayBusqueda,
  busqueda,
  onAbrir,
  onCargarMas,
}: {
  filas: FilaBandeja[];
  seleccionadaId: string | null;
  detalle: boolean;
  cargando: boolean;
  hayMas: boolean;
  cargandoMas: boolean;
  hayBusqueda: boolean;
  /** Lo buscado (resalta el fragmento del mensaje que coincidió). */
  busqueda?: string;
  onAbrir: (id: string) => void;
  onCargarMas: () => void;
}) {
  const centinela = useRef<HTMLDivElement>(null);
  const pedir = useRef(onCargarMas);
  pedir.current = onCargarMas;

  useEffect(() => {
    const el = centinela.current;
    if (!el || !hayMas) return;
    const io = new IntersectionObserver((ents) => ents.some((e) => e.isIntersecting) && pedir.current(), { rootMargin: "400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hayMas, filas.length]);

  if (cargando && !filas.length) {
    return (
      <div className="space-y-px" aria-hidden>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex gap-2.5 border-b border-slate-100 px-3 py-3">
            <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-slate-200" />
            <div className="flex-1 space-y-1.5">
              <span className="block h-3 w-2/3 animate-pulse rounded bg-slate-200" />
              <span className="block h-2.5 w-1/3 animate-pulse rounded bg-slate-100" />
              <span className="block h-2.5 w-5/6 animate-pulse rounded bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (!filas.length) {
    return <div className="p-4 text-center text-xs text-slate-500">{hayBusqueda ? "Ningún chat coincide con la búsqueda" : "No hay conversaciones acá"}</div>;
  }
  return (
    <>
      {filas.map((c) => (
        <TarjetaConversacion key={c.id} c={c} seleccionada={c.id === seleccionadaId} detalle={detalle} busqueda={busqueda} onAbrir={onAbrir} />
      ))}
      {hayMas ? (
        <div ref={centinela}>
          <button
            type="button"
            onClick={onCargarMas}
            disabled={cargandoMas}
            className="flex w-full items-center justify-center gap-1.5 border-b border-slate-100 px-3 py-2.5 text-center text-xs font-semibold text-[#3F8E91] transition-colors hover:bg-white disabled:opacity-60"
          >
            {cargandoMas ? (
              <>
                <Girando /> Cargando…
              </>
            ) : (
              "Cargar más"
            )}
          </button>
        </div>
      ) : null}
    </>
  );
}
