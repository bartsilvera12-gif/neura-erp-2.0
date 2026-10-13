"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Capa ÚNICA para todos los modales del ERP. Resuelve de una vez el "modal cortado":
 *   · se monta en <body> (portal): ningún contenedor con overflow/transform lo recorta
 *   · centrado con margen SIEMPRE (p-4 / sm:p-6): nunca toca los bordes de la ventana
 *   · si el contenido es más alto que la pantalla, la capa scrollea (nunca queda cortado
 *     arriba, el bug de "flex items-center" + contenido alto)
 *   · bloquea el scroll del fondo compensando la barra (la página no salta)
 *   · Escape y click afuera cierran (si se pasa onClose)
 * El panel de cada modal debe usar `max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3rem)]`
 * (clase ALTO_MAX_MODAL) con cabecera y pie fijos y el cuerpo con overflow-y-auto.
 */
export const ALTO_MAX_MODAL = "max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3rem)]";

export function CapaModal({
  onClose,
  children,
  z = "z-50",
  fondo = "bg-slate-900/45 backdrop-blur-[2px]",
  cerrarConEscape = true,
}: {
  onClose?: () => void;
  children: React.ReactNode;
  z?: string;
  fondo?: string;
  cerrarConEscape?: boolean;
}) {
  const [montado, setMontado] = useState(false);
  const capa = useRef<HTMLDivElement>(null);
  useEffect(() => setMontado(true), []);

  useEffect(() => {
    if (!montado) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !cerrarConEscape || !onClose) return;
      // Con modales apilados (ej. un modal dentro de la ficha), Escape cierra solo el de arriba.
      const capas = document.querySelectorAll("[data-capa-modal]");
      if (capas.length && capas[capas.length - 1] !== capa.current) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPad = body.style.paddingRight;
    const barra = window.innerWidth - document.documentElement.clientWidth;
    if (barra > 0) body.style.paddingRight = `${barra}px`;
    body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPad;
    };
  }, [montado, onClose, cerrarConEscape]);

  if (!montado) return null;
  const afuera = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && onClose) onClose();
  };
  return createPortal(
    <div
      ref={capa}
      data-capa-modal=""
      className={`fixed inset-0 ${z} overflow-y-auto overscroll-contain ${fondo}`}
      style={{ animation: "modal-backdrop 0.15s ease-out" }}
      onMouseDown={afuera}
    >
      <div className="flex min-h-full items-center justify-center p-4 sm:p-6" onMouseDown={afuera}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
