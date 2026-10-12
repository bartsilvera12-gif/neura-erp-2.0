"use client";

/**
 * Tarjeta de la lista. memo: al llegar un aviso solo se re-dibuja la tarjeta que cambió
 * (las demás reciben el mismo objeto y el mismo onAbrir estable).
 * Alto fijo + content-visibility:auto → el navegador no pinta las que están fuera de vista.
 */
import { memo } from "react";
import { Check, StickyNote } from "lucide-react";
import { ESTADO_CLASE, ESTADO_LABEL, horaLista, inicial, nombreContacto, telefonoLegible, type FilaBandeja } from "@/modules/conversaciones/dominio";
import { Avatar, IconoCanal, VentanaWhatsApp } from "@/modules/conversaciones/ui";

export const ALTO_TARJETA = 96;

function Tarjeta({
  c,
  seleccionada,
  detalle,
  onAbrir,
}: {
  c: FilaBandeja;
  seleccionada: boolean;
  /** Vistas "Todas" / "Cerradas": se muestra el estado y el agente. */
  detalle: boolean;
  onAbrir: (id: string) => void;
}) {
  const nombre = nombreContacto(c);
  const conNombre = nombre !== "Sin nombre";
  return (
    <button
      type="button"
      onClick={() => onAbrir(c.id)}
      style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${ALTO_TARJETA}px`, minHeight: ALTO_TARJETA }}
      className={`w-full border-b border-slate-100 px-3 py-2 text-left transition-colors ${
        seleccionada ? "border-l-[3px] border-l-[#4FAEB2] bg-white" : "hover:bg-white"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <Avatar letra={inicial(nombre)} conNombre={conNombre} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">{nombre}</div>
              <div className="flex items-center gap-1 truncate font-mono text-[11px] tabular-nums text-slate-500">
                <IconoCanal tipo={c.canal_tipo} className="h-3 w-3 shrink-0 text-[#4FAEB2]" />
                {telefonoLegible(c.contacto_telefono)}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className={`text-[10.5px] tabular-nums ${c.no_leidos > 0 ? "font-semibold text-[#3F8E91]" : "text-slate-400"}`}>{horaLista(c.ultimo_mensaje_at)}</span>
              {c.no_leidos > 0 ? (
                <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-[#4FAEB2] px-1.5 py-0.5 text-[11px] font-bold leading-none text-white">
                  {c.no_leidos > 99 ? "99+" : c.no_leidos}
                </span>
              ) : null}
            </div>
          </div>
          <p className="mt-1 truncate text-[12px] leading-snug text-slate-500">
            {c.ultimo_from_me ? <Check className="mr-0.5 inline-block h-3.5 w-3.5 align-[-3px] text-slate-400" aria-label="Enviado por vos" /> : null}
            {c.ultimo_tipo === "nota" ? <StickyNote className="mr-0.5 inline-block h-3 w-3 text-amber-500" /> : null}
            {c.ultimo_preview || "—"}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1 overflow-hidden" style={{ maxHeight: 20 }}>
            {detalle ? (
              <span className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${ESTADO_CLASE[c.estado]}`}>{ESTADO_LABEL[c.estado]}</span>
            ) : null}
            {c.asignado_nombre ? (
              detalle ? (
                <span className="max-w-[9rem] truncate rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-900" title={`Agente asignado: ${c.asignado_nombre}`}>
                  Agente · {c.asignado_nombre}
                </span>
              ) : null
            ) : c.estado !== "cerrada" ? (
              <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800">Sin asignar</span>
            ) : null}
            <VentanaWhatsApp canalTipo={c.canal_tipo} expira={c.estado === "cerrada" ? null : c.ventana_expira_at} compacta />
            {c.etiquetas.slice(0, 2).map((e) => (
              <span key={e} className="max-w-[6rem] truncate rounded-full border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[9px] font-medium text-indigo-700">
                {e}
              </span>
            ))}
            {c.etiquetas.length > 2 ? <span className="text-[9px] text-slate-400">+{c.etiquetas.length - 2}</span> : null}
          </div>
        </div>
      </div>
    </button>
  );
}

export const TarjetaConversacion = memo(Tarjeta);
