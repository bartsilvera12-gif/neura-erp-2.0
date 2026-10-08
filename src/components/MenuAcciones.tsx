"use client";

/**
 * Menú de acciones (⋯ o cualquier disparador): se abre flotando sobre la página (portal),
 * así no lo corta una tabla o tarjeta con overflow. Cierra con Esc, click afuera o scroll.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ItemMenu = {
  etiqueta: string;
  icono?: React.ReactNode;
  onClick: () => void;
  tono?: "normal" | "peligro" | "exito";
};

export function MenuAcciones({
  items,
  children,
  etiqueta,
  className = "",
  style,
}: {
  items: ItemMenu[];
  children: React.ReactNode;
  /** texto para lectores de pantalla */
  etiqueta: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [abierto, setAbierto] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!abierto || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const ancho = 220;
    const alto = items.length * 38 + 10;
    const abajo = r.bottom + 6 + alto < window.innerHeight;
    setPos({
      top: abajo ? r.bottom + 6 : r.top - 6 - alto,
      left: Math.max(8, Math.min(r.right - ancho, window.innerWidth - ancho - 8)),
    });
  }, [abierto, items.length]);

  useEffect(() => {
    if (!abierto) return;
    const cerrar = () => setAbierto(false);
    const fuera = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !panel.current?.contains(t)) cerrar();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") cerrar(); };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", cerrar, true);
    window.addEventListener("resize", cerrar);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", cerrar, true);
      window.removeEventListener("resize", cerrar);
    };
  }, [abierto]);

  const TONO = {
    normal: "text-slate-700 hover:bg-slate-100",
    peligro: "text-amber-700 hover:bg-amber-50",
    exito: "text-emerald-700 hover:bg-emerald-50",
  };

  return (
    <>
      <button ref={btn} type="button" aria-label={etiqueta} aria-haspopup="menu" aria-expanded={abierto} onClick={() => setAbierto((v) => !v)} className={className} style={style}>
        {children}
      </button>
      {abierto && pos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panel}
              role="menu"
              className="fixed z-[130] w-[220px] rounded-xl border border-slate-200 bg-white p-1 shadow-[0_12px_32px_-8px_rgba(2,48,71,0.25)]"
              style={{ top: pos.top, left: pos.left, animation: "rb-pop 0.15s cubic-bezier(0.16,1,0.3,1)" }}
            >
              {items.map((it) => (
                <button
                  key={it.etiqueta}
                  role="menuitem"
                  type="button"
                  onClick={() => { setAbierto(false); it.onClick(); }}
                  className={`flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${TONO[it.tono ?? "normal"]}`}
                >
                  {it.icono ? <span className="flex h-4 w-4 shrink-0 items-center justify-center opacity-70">{it.icono}</span> : null}
                  {it.etiqueta}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
