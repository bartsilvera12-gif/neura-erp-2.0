"use client";

/**
 * Piezas compartidas del CRM: estilos de formulario, título de sección, avatar con
 * iniciales, modal grande (el de "Crear prospecto" / "Editar" del sistema actual),
 * avisos (toast) y el selector de planes.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Search, X } from "lucide-react";
import { apiFetchCache } from "@/lib/api/cache-cliente";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";

export const INPUT =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm outline-none transition-colors hover:border-[var(--brand)]/60 focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20";
export const LABEL = "mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500";
export const BTN_PRIMARIO =
  "rounded-xl bg-[var(--brand)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--brand-600)] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none";
export const BTN_SECUNDARIO =
  "rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-[var(--brand)]/60 hover:text-[var(--brand)]";

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <span aria-hidden className="block h-5 w-1 rounded-full bg-[var(--brand)]" />
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">{children}</p>
    </div>
  );
}

// ── Avatar con iniciales (como las tarjetas del sistema actual) ─────────────
const AVATAR_COLORS = [
  "bg-[var(--brand)] text-white",
  "bg-violet-500 text-white",
  "bg-amber-500 text-white",
  "bg-emerald-600 text-white",
  "bg-rose-500 text-white",
  "bg-sky-600 text-white",
];

function iniciales(nombre: string) {
  const p = nombre.trim().split(/\s+/);
  if (p.length >= 2) return `${p[0][0]}${p[1][0]}`.toUpperCase();
  return nombre.slice(0, 2).toUpperCase() || "?";
}

export const AvatarIni = memo(function AvatarIni({ nombre, size = "xs" }: { nombre: string; size?: "xs" | "sm" }) {
  let hash = 0;
  for (let i = 0; i < nombre.length; i++) hash += nombre.charCodeAt(i);
  const cls = size === "xs" ? "h-5 w-5 text-[9px]" : "h-6 w-6 text-[10px]";
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ring-2 ring-white ${cls} ${AVATAR_COLORS[hash % AVATAR_COLORS.length]}`}>
      {iniciales(nombre)}
    </span>
  );
});

// ── Modal grande (encabezado con franja de acento + "Cerrar") ───────────────
export function ModalGrande({
  eyebrow, titulo, subtitulo, onClose, children, extra,
}: {
  eyebrow: string; titulo: React.ReactNode; subtitulo?: React.ReactNode; onClose: () => void; children: React.ReactNode; extra?: React.ReactNode;
}) {
  // Si hay un modal chico encima (motivo, transformar), el Escape lo cierra a él primero.
  const cerrar = useCallback(() => {
    if (!document.querySelector("[data-modal-chico]")) onClose();
  }, [onClose]);

  return (
    <CapaModal onClose={cerrar} z="z-[45]" fondo="bg-slate-900/55 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className={`relative flex h-[min(88dvh,920px)] ${ALTO_MAX_MODAL} w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ring-1 ring-[var(--brand)]/15`}
        style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}
      >
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[var(--brand)] via-[var(--brand)]/80 to-[var(--brand)]/40" />
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-br from-white via-white to-[var(--brand)]/5 px-6 pb-5 pt-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--brand)] shadow-[0_0_0_3px_var(--brand-100)]" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--brand)]">{eyebrow}</p>
            </div>
            <h2 className="mt-1 truncate text-2xl font-semibold tracking-tight text-slate-900">{titulo}</h2>
            {subtitulo ? <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">{subtitulo}</div> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {extra}
            <button type="button" className={BTN_SECUNDARIO} onClick={onClose}>Cerrar</button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </CapaModal>
  );
}

// ── Avisos (toast) ───────────────────────────────────────────────────────────
export type Aviso = { texto: string; tipo?: "ok" | "error"; link?: { href: string; texto: string } };

export function useAvisos() {
  const [aviso, setAviso] = useState<(Aviso & { k: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avisar = useCallback((a: Aviso) => {
    if (timer.current) clearTimeout(timer.current);
    setAviso({ ...a, k: Date.now() });
    timer.current = setTimeout(() => setAviso(null), a.link ? 7000 : 4000);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const nodo = aviso ? (
    <div
      key={aviso.k}
      role="status"
      className={`fixed bottom-5 right-5 z-[80] flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${
        aviso.tipo === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-white text-slate-800"
      }`}
      style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}
    >
      <span className="min-w-0 flex-1">
        {aviso.texto}
        {aviso.link ? (
          <Link href={aviso.link.href} className="ml-1.5 font-semibold text-[var(--brand)] hover:underline">{aviso.link.texto}</Link>
        ) : null}
      </span>
      <button type="button" onClick={() => setAviso(null)} aria-label="Cerrar aviso" className="shrink-0 text-slate-400 hover:text-slate-600">
        <X className="h-4 w-4" />
      </button>
    </div>
  ) : null;
  return { nodo, avisar };
}

// ── Planes (servicios / productos de interés) ────────────────────────────────
export type Plan = { id: string; nombre: string; precio: number; moneda: string; activo: boolean };

export function usePlanes() {
  const [planes, setPlanes] = useState<Plan[] | null>(null);
  useEffect(() => {
    let vivo = true;
    apiFetchCache<Plan[]>("/api/planes?activos=1", { ttlMs: 5 * 60_000 })
      .then((p) => vivo && setPlanes(p.map((x) => ({ ...x, precio: Number(x.precio) || 0 }))))
      .catch(() => vivo && setPlanes([]));
    return () => { vivo = false; };
  }, []);
  return planes;
}

/** Multi-selección de planes con buscador (como el PlanSelector del sistema actual). */
export function PlanSelector({ planes, seleccion, onToggle }: { planes: Plan[]; seleccion: string[]; onToggle: (id: string) => void }) {
  const [q, setQ] = useState("");
  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? planes.filter((p) => p.nombre.toLowerCase().includes(t)) : planes;
  }, [planes, q]);
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="relative border-b border-slate-100">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar plan por nombre…" className="w-full rounded-t-xl bg-transparent py-2.5 pl-9 pr-3 text-sm outline-none" />
      </div>
      <ul className="max-h-48 overflow-y-auto p-1">
        {visibles.length === 0 ? <li className="px-3 py-2 text-sm italic text-slate-400">Sin resultados</li> : null}
        {visibles.map((p) => {
          const sel = seleccion.includes(p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onToggle(p.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${sel ? "bg-[var(--brand-50)] text-[var(--brand-700)]" : "text-slate-700 hover:bg-slate-50"}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${sel ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-slate-300 bg-white"}`}>
                    {sel ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span className="truncate font-medium">{p.nombre}</span>
                </span>
                <span className="shrink-0 tabular-nums text-xs text-slate-500">
                  {p.moneda === "USD" ? `US$ ${p.precio.toLocaleString("es-PY")}` : `Gs. ${Math.round(p.precio).toLocaleString("es-PY")}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Usuarios (responsables) ──────────────────────────────────────────────────
export type UsuarioMin = { id: string; nombre: string; rol: string };

export function useUsuarios() {
  const [us, setUs] = useState<UsuarioMin[]>([]);
  useEffect(() => {
    let vivo = true;
    apiFetchCache<UsuarioMin[]>("/api/usuarios?min=1", { ttlMs: 5 * 60_000 }).then((u) => vivo && setUs(u)).catch(() => {});
    return () => { vivo = false; };
  }, []);
  return us;
}
