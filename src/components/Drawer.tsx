"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Panel lateral deslizante (slide-over) de alto completo. Para formularios con
 * varios campos: el título queda fijo arriba, el cuerpo scrollea, y el pie
 * (acciones) queda pegado abajo — nunca se corta como un modal centrado alto.
 * Se monta en <body> (portal): dentro del contenido, la barra superior de la app le
 * tapaba el título.
 */
export function Drawer({
  titulo,
  subtitulo,
  onClose,
  children,
  footer,
}: {
  titulo: string;
  subtitulo?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
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

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex justify-end bg-slate-900/40 backdrop-blur-[2px]"
      style={{ animation: "modal-backdrop 0.15s ease-out" }}
      onClick={onClose}
    >
      <aside
        className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
        style={{ animation: "drawer-in 0.22s cubic-bezier(0.16,1,0.3,1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-900">{titulo}</h2>
            {subtitulo ? <p className="mt-0.5 truncate text-xs text-slate-500">{subtitulo}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>

        {footer ? (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">{footer}</footer>
        ) : null}
      </aside>
    </div>,
    document.body,
  );
}
