"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

/**
 * Modal centrado con backdrop. Cierra con Escape o click afuera.
 * Bloquea el scroll del fondo COMPENSANDO el ancho de la scrollbar, para que la
 * página no "salte" al abrirse (el bug clásico de los modales).
 */
export function Modal({
  titulo,
  onClose,
  children,
  size = "md",
}: {
  titulo: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: "md" | "lg" | "xl";
}) {
  const maxW = size === "xl" ? "max-w-2xl" : size === "lg" ? "max-w-lg" : "max-w-md";
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);

    // Bloquear scroll del body sin desplazar el contenido.
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPad = body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPad;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/30 p-4 backdrop-blur-[2px]"
      style={{ animation: "modal-backdrop 0.15s ease-out" }}
      onClick={onClose}
    >
      <div
        className={`my-auto w-full ${maxW} rounded-2xl border border-slate-200 bg-white shadow-2xl`}
        style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-900">{titulo}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
