"use client";

/**
 * Cupo de usuarios del plan (receta 76). Cada empresa tiene un máximo (por defecto 5); cuentan
 * los usuarios activos, incluidas las invitaciones pendientes. Para sumar más se habla con el
 * soporte de Neura, que lo sube por base de datos (no hay pantalla para eso).
 *
 * "Hablar con soporte" abre, en este orden:
 *   1. WhatsApp de Neura (+595 973 989068, o NEXT_PUBLIC_SOPORTE_NEURA_WHATSAPP si está) con el mensaje
 *   2. NEXT_PUBLIC_SOPORTE_NEURA_URL → esa página (se le agrega ?asunto=…)
 *   3. si no, la pantalla de nuevo ticket del módulo Soporte (/soporte/tickets/nuevo?asunto=…)
 */
import { LifeBuoy, Users } from "lucide-react";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ModalDocumento } from "@/modules/inventario/ui";
import { TEAL, type CupoUsuarios } from "@/modules/usuarios/ui/comun";

export const ASUNTO_SOPORTE = "Quiero sumar usuarios a mi plan";
export const RE_LIMITE_USUARIOS = /l[ií]mite de \d+ usuarios/i;

/** WhatsApp del soporte de Neura (se puede cambiar por instalación con NEXT_PUBLIC_SOPORTE_NEURA_WHATSAPP). */
const WHATSAPP_SOPORTE_NEURA = "595973989068";

export function urlSoporteNeura(asunto = ASUNTO_SOPORTE): { href: string; externo: boolean } {
  const wa = (process.env.NEXT_PUBLIC_SOPORTE_NEURA_WHATSAPP || WHATSAPP_SOPORTE_NEURA).replace(/\D/g, "");
  if (wa) return { href: `https://wa.me/${wa}?text=${encodeURIComponent(asunto)}`, externo: true };
  const url = (process.env.NEXT_PUBLIC_SOPORTE_NEURA_URL ?? "").trim();
  if (/^https?:\/\//.test(url)) {
    return { href: `${url}${url.includes("?") ? "&" : "?"}asunto=${encodeURIComponent(asunto)}`, externo: true };
  }
  return { href: `/soporte/tickets/nuevo?asunto=${encodeURIComponent(asunto)}`, externo: false };
}

export type NivelCupo = "ok" | "ultimo" | "lleno" | "excedido";
export function nivelCupo(c: CupoUsuarios): NivelCupo {
  if (c.excedido) return "excedido";
  if (c.disponibles <= 0) return "lleno";
  if (c.disponibles === 1) return "ultimo";
  return "ok";
}
export const cupoLleno = (c: CupoUsuarios | undefined) => !!c && c.disponibles <= 0;

/** Chip discreto "4 de 5 usuarios" con barrita (ámbar si queda 1, rojo lleno / excedido). */
export function IndicadorCupo({ cupo }: { cupo: CupoUsuarios }) {
  const n = nivelCupo(cupo);
  const pct = cupo.limite > 0 ? Math.min(100, Math.round((cupo.usados / cupo.limite) * 100)) : 100;
  const estilo = {
    ok: { chip: "bg-white text-slate-600 ring-slate-200", barra: TEAL, icono: "text-slate-400" },
    ultimo: { chip: "bg-amber-50 text-amber-800 ring-amber-200", barra: "#f59e0b", icono: "text-amber-500" },
    lleno: { chip: "bg-rose-50 text-rose-700 ring-rose-200", barra: "#e11d48", icono: "text-rose-500" },
    excedido: { chip: "bg-rose-50 text-rose-700 ring-rose-200", barra: "#e11d48", icono: "text-rose-500" },
  }[n];
  const titulo = n === "ultimo" ? "Te queda 1 lugar" : n === "lleno" ? "Cupo lleno" : n === "excedido" ? "Superaste el límite de tu plan" : `Te quedan ${cupo.disponibles} lugares`;
  return (
    <span title={`${titulo}. Cuentan los usuarios activos y las invitaciones pendientes; los desactivados no.`}
      className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset max-sm:min-h-10 max-sm:text-[13px] ${estilo.chip}`}>
      <Users className={`h-3.5 w-3.5 ${estilo.icono}`} />
      <span className="tabular-nums">{cupo.usados} de {cupo.limite} usuarios</span>
      <span aria-hidden className="h-1.5 w-10 overflow-hidden rounded-full bg-slate-200/80">
        <span className="block h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, backgroundColor: estilo.barra }} />
      </span>
    </span>
  );
}

export function BotonSoporte({ className = "", primario = false }: { className?: string; primario?: boolean }) {
  const { href, externo } = urlSoporteNeura();
  return (
    <a href={href} {...(externo ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={`${primario ? BOTON_PRIMARIO : BOTON_SECUNDARIO} max-sm:min-h-11 ${className}`}
      style={primario ? { backgroundColor: TEAL } : undefined}>
      <LifeBuoy className="h-4 w-4" /> Hablar con soporte
    </a>
  );
}

/** Aviso amable con el cupo lleno (o excedido) + botón de soporte. */
export function AvisoCupo({ cupo, className = "" }: { cupo: CupoUsuarios; className?: string }) {
  const excedido = cupo.excedido;
  return (
    <div role="status" className={`flex flex-col gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center ${excedido ? "border-rose-200 bg-rose-50/70" : "border-amber-200 bg-amber-50/70"} ${className}`}>
      <span className={`hidden h-9 w-9 shrink-0 place-items-center rounded-full sm:grid ${excedido ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-700"}`}>
        <LifeBuoy className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className={`font-semibold ${excedido ? "text-rose-800" : "text-amber-900"}`}>
          {excedido ? `Superaste el límite de tu plan (${cupo.usados} de ${cupo.limite})` : "Llegaste al máximo de usuarios"}
        </p>
        <p className={`mt-0.5 text-xs leading-relaxed ${excedido ? "text-rose-700" : "text-amber-800"}`}>
          Tu plan incluye {cupo.limite} usuarios. Para agregar más, contactá al soporte de Neura.
          {" "}Si alguien ya no usa el sistema, desactivarlo libera su lugar.
        </p>
      </div>
      <BotonSoporte className="sm:shrink-0 max-sm:w-full" />
    </div>
  );
}

/** Modal con el mismo aviso (al intentar reactivar o crear con el cupo lleno). */
export function ModalCupoLleno({ cupo, onClose }: { cupo: CupoUsuarios; onClose: () => void }) {
  return (
    <ModalDocumento titulo={<><LifeBuoy className="h-5 w-5 text-amber-600" /> Sin lugares en tu plan</>} ancho="max-w-md" onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={`${BOTON_SECUNDARIO} max-sm:order-2 max-sm:basis-full`}>Cerrar</button>
          <BotonSoporte primario className="max-sm:order-1 max-sm:basis-full" />
        </>
      }>
      <div className="space-y-2 text-sm text-slate-700">
        <p>
          Tu plan incluye <b>{cupo.limite} usuarios</b> y ya {cupo.usados === 1 ? "hay 1 activo" : `hay ${cupo.usados} activos`} (las invitaciones pendientes también cuentan).
        </p>
        <p>Para agregar más, contactá al soporte de Neura. También podés desactivar a alguien que ya no use el sistema: eso libera su lugar.</p>
      </div>
    </ModalDocumento>
  );
}
