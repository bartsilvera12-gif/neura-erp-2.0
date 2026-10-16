"use client";

/**
 * Visor de imagen a pantalla completa: rueda para acercar, arrastrar para moverse, Esc cierra.
 * Táctil: botones de 44 px, doble toque alterna el zoom y se arrastra con el dedo (touch-none:
 * el navegador no se lleva el gesto); safe-area arriba y abajo.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";
import { descargar } from "@/modules/conversaciones/media";

export function VisorImagen({ url, nombre, onCerrar }: { url: string; nombre: string; onCerrar: () => void }) {
  const [escala, setEscala] = useState(1);
  const [rot, setRot] = useState(0);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const arrastre = useRef<{ x: number; y: number } | null>(null);
  const ultimoToque = useRef(0);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCerrar]);

  const zoom = (d: number) =>
    setEscala((s) => {
      const n = Math.min(8, Math.max(1, s + d));
      if (n === 1) setPos({ x: 0, y: 0 });
      return n;
    });

  const boton = "grid h-11 w-11 shrink-0 place-items-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white sm:h-9 sm:w-9";
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[130] flex flex-col bg-black/90" role="dialog" aria-modal="true">
      <div className="pt-safe flex shrink-0 items-center justify-between gap-2 px-2 py-1 sm:px-3 sm:py-2">
        <span className="min-w-0 truncate pl-1 text-xs text-white/70">{nombre}</span>
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <button type="button" className={boton} onClick={() => zoom(-0.5)} aria-label="Alejar"><ZoomOut className="h-4 w-4" /></button>
          <button type="button" className={boton} onClick={() => zoom(0.5)} aria-label="Acercar"><ZoomIn className="h-4 w-4" /></button>
          <button type="button" className={boton} onClick={() => setRot((r) => (r + 90) % 360)} aria-label="Rotar"><RotateCw className="h-4 w-4" /></button>
          <button type="button" className={boton} onClick={() => void descargar(url, nombre)} aria-label="Descargar"><Download className="h-4 w-4" /></button>
          <button type="button" className={boton} onClick={onCerrar} aria-label="Cerrar"><X className="h-5 w-5" /></button>
        </div>
      </div>
      <div
        className={`flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden ${escala > 1 ? "cursor-grab" : "cursor-zoom-in"}`}
        onClick={(e) => e.target === e.currentTarget && onCerrar()}
        onWheel={(e) => zoom(e.deltaY < 0 ? 0.25 : -0.25)}
        onDoubleClick={() => (escala > 1 ? (setEscala(1), setPos({ x: 0, y: 0 })) : setEscala(2))}
        onPointerDown={(e) => {
          // Doble toque con el dedo (dblclick no siempre llega en táctil).
          if (e.pointerType === "touch") {
            const ahora = Date.now();
            if (ahora - ultimoToque.current < 300) {
              ultimoToque.current = 0;
              if (escala > 1) {
                setEscala(1);
                setPos({ x: 0, y: 0 });
              } else setEscala(2);
              return;
            }
            ultimoToque.current = ahora;
          }
          if (escala <= 1) return;
          arrastre.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => arrastre.current && setPos({ x: e.clientX - arrastre.current.x, y: e.clientY - arrastre.current.y })}
        onPointerUp={() => (arrastre.current = null)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={nombre}
          draggable={false}
          className="max-h-full max-w-full select-none object-contain"
          style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${escala}) rotate(${rot}deg)`, transition: arrastre.current ? "none" : "transform 120ms ease-out" }}
        />
      </div>
      <p className="shrink-0 bg-black/40 px-3 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] text-center text-[10px] text-white/45">
        <span className="[@media(pointer:coarse)]:hidden">Rueda para acercar · doble clic para alternar · arrastrá para moverte · Esc para cerrar</span>
        <span className="hidden [@media(pointer:coarse)]:inline">Doble toque para acercar · arrastrá para moverte</span>
      </p>
    </div>,
    document.body,
  );
}
