"use client";

/** Piezas visuales chicas de Conversaciones (copiadas del sistema actual). */
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { useEffect, useState, type ReactNode } from "react";
import { Globe, MessageCircle, Send, X, type LucideIcon } from "lucide-react";
import { ventanaAbierta, type EstadoEntrega } from "@/modules/conversaciones/dominio";

export const TURQUESA = "#4FAEB2";
export const TURQUESA_OSCURO = "#3F8E91";

export function tabClass(activo: boolean) {
  return `px-3.5 py-1.5 text-xs font-semibold rounded-xl transition-all inline-flex items-center gap-1.5 ${
    activo ? "bg-[#4FAEB2] text-white shadow-sm shadow-[#4FAEB2]/25" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
  }`;
}

export const claseCampo =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 transition-colors placeholder:text-slate-400 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20";
export const claseEtiqueta = "mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#2F6E71]";
export const botonPrimario =
  "rounded-xl bg-[#4FAEB2] px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91] disabled:opacity-50 max-sm:min-h-11";
export const botonSecundario =
  "rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 max-sm:min-h-11";

// ── Tildes de entrega (estilo WhatsApp) ──────────────────────────────────────
const TICK_LABEL: Record<string, string> = {
  pendiente: "Enviando…",
  enviado: "Enviado. Todavía no se confirmó la entrega.",
  entregado: "Entregado al teléfono del cliente.",
  leido: "Leído por el cliente.",
};

/** Regla: nunca doble tilde sin dato. "pendiente" = reloj; "fallido" lo explica el chip rojo. */
export function Ticks({ estado, claro = true, className = "" }: { estado: EstadoEntrega; claro?: boolean; className?: string }) {
  if (estado === "fallido" || estado === "recibido") return null;
  const tono = claro
    ? estado === "leido" ? "text-[#7FE7FF]" : estado === "entregado" ? "text-white/90" : "text-white/55"
    : estado === "leido" ? "text-sky-500" : "text-slate-400";
  if (estado === "pendiente") {
    return (
      <span title={TICK_LABEL.pendiente} className={`ml-1 inline-flex align-middle ${tono} ${className}`}>
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
          <circle cx="6" cy="6" r="4.6" stroke="currentColor" strokeWidth="1.3" />
          <path d="M6 3.4V6l1.7 1.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  const doble = estado === "entregado" || estado === "leido";
  const s = { stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <span title={TICK_LABEL[estado]} aria-label={TICK_LABEL[estado]} role="img" className={`ml-1 inline-flex shrink-0 align-middle transition-colors duration-300 ${tono} ${className}`}>
      <svg width="15" height="11" viewBox="0 0 16 11" fill="none" aria-hidden focusable="false">
        <path d={doble ? "M1 6.2L4.2 9.3L10 1.9" : "M3.1 6.2L6.3 9.3L12.1 1.9"} {...s} />
        {doble ? <path d="M6.2 6.2L9.4 9.3L15.2 1.9" {...s} /> : null}
      </svg>
    </span>
  );
}

// ── Canal ────────────────────────────────────────────────────────────────────
const CANAL_ICONO: Record<string, LucideIcon> = { whatsapp: MessageCircle, instagram: Send, messenger: Send, web: Globe };
const CANAL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger", web: "Web" };

export function IconoCanal({ tipo, className = "h-3.5 w-3.5" }: { tipo: string; className?: string }) {
  const I = CANAL_ICONO[tipo] ?? MessageCircle;
  return <I className={className} aria-hidden />;
}

export function CanalBadge({ tipo, nombre }: { tipo: string; nombre?: string | null }) {
  const label = nombre?.trim() || CANAL_LABEL[tipo] || "Canal";
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600"
      title={label}
    >
      <IconoCanal tipo={tipo} className="h-3.5 w-3.5 shrink-0 opacity-90" />
      <span className="truncate">{label}</span>
    </span>
  );
}

// ── Avatar ───────────────────────────────────────────────────────────────────
export function Avatar({ letra, conNombre, grande }: { letra: string; conNombre: boolean; grande?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${grande ? "h-10 w-10 text-sm ring-2 ring-white shadow-sm" : "h-9 w-9 text-[12px]"} ${
        conNombre ? "border border-[#4FAEB2]/30 bg-[#4FAEB2]/12 text-[#3F8E91]" : "border border-slate-200 bg-slate-100 text-slate-500"
      }`}
    >
      {letra}
    </span>
  );
}

// ── Ventana de 24 h ──────────────────────────────────────────────────────────
/** Un solo reloj compartido por minuto (no un setInterval por tarjeta). */
const suscriptores = new Set<() => void>();
let reloj: number | null = null;
export function useMinuto(): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const fn = () => setT(Date.now());
    suscriptores.add(fn);
    if (reloj == null) reloj = window.setInterval(() => suscriptores.forEach((f) => f()), 30_000);
    return () => {
      suscriptores.delete(fn);
      if (!suscriptores.size && reloj != null) {
        window.clearInterval(reloj);
        reloj = null;
      }
    };
  }, []);
  return t;
}

/**
 * Ventana de 24 h de WhatsApp: cuenta desde el último mensaje del CLIENTE (la base lo
 * guarda en ventana_expira_at). Fuera de la ventana solo se aceptan plantillas.
 */
export function VentanaWhatsApp({ canalTipo, expira, compacta }: { canalTipo: string; expira: string | null; compacta?: boolean }) {
  const ahora = useMinuto();
  if (canalTipo !== "whatsapp" || !expira) return null;
  const restante = Date.parse(expira) - ahora;
  if (!ventanaAbierta({ canal_tipo: canalTipo, ventana_expira_at: expira }, ahora)) {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700"
        title="El cliente escribió hace más de 24 h. WhatsApp solo acepta plantillas hasta que vuelva a escribir."
      >
        {compacta ? "24 h cerrada" : "Ventana 24 h cerrada"}
      </span>
    );
  }
  if (compacta) return null;
  const h = Math.floor(restante / 3_600_000);
  const min = Math.floor((restante % 3_600_000) / 60_000);
  const poco = restante < 2 * 3_600_000;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
        poco ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
      title="Tiempo que queda para escribirle libremente. Cuenta desde el último mensaje del CLIENTE, no desde el tuyo."
    >
      Ventana: quedan {h > 0 ? `${h} h ` : ""}
      {min} min
    </span>
  );
}

// ── Ventana modal con la cabecera de marca (igual que el sistema actual) ─────
export function Ventana({
  titulo,
  detalle,
  icono: Icono,
  onCerrar,
  children,
  ancho = "max-w-md",
  z = "z-[110]",
}: {
  titulo: string;
  detalle?: string;
  icono: LucideIcon;
  onCerrar: () => void;
  children: ReactNode;
  ancho?: string;
  z?: string;
}) {
  return (
    <CapaModal onClose={onCerrar} z={z}>
      <div
        role="dialog"
        aria-modal="true"
        className={`flex ${ALTO_MAX_MODAL} w-full ${ancho} flex-col overflow-hidden rounded-2xl border border-[#4FAEB2]/25 bg-white shadow-2xl shadow-[#2F6E71]/15`}
        style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-[#4FAEB2]/20 bg-gradient-to-r from-[#4FAEB2]/14 via-[#4FAEB2]/6 to-transparent px-4 py-3 sm:px-5 sm:py-4">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#4FAEB2]/15 text-[#2F6E71]">
            <Icono className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-semibold text-slate-900">{titulo}</h2>
            {detalle ? <p className="mt-0.5 text-[13px] leading-relaxed text-slate-600">{detalle}</p> : null}
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/70 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5 pt-4 sm:px-5">{children}</div>
      </div>
    </CapaModal>
  );
}

export function AvisoError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-2 py-1.5 text-sm text-red-700">{children}</p>;
}

export function Girando({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
