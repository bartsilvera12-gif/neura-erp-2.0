"use client";

/**
 * Una tipificación en un historial: fecha, quién, Estado / Sub-estado, observación y lo que
 * disparó (ticket con su estado en vivo, o la capacitación). "Ver ticket" abre el ticket en un
 * modal (no navega).
 */
import Link from "next/link";
import { ClipboardPen, ExternalLink, GraduationCap, Headset } from "lucide-react";
import { Avatar } from "@/modules/clientes/ui";
import { estadoCita, fechaHoraPy, fechaRelativa, numeroTicket, type Tipificacion } from "@/modules/tipificacion/dominio";

export function ItemTipificacion({ t, resaltada, compacta, puedeSoporte, onVerTicket, cliente }: {
  t: Tipificacion;
  resaltada?: boolean;
  /** columna angosta (panel lateral): todo en una sola columna */
  compacta?: boolean;
  puedeSoporte?: boolean;
  onVerTicket?: (ticketId: string) => void;
  /** nombre del cliente (en el registro general) */
  cliente?: React.ReactNode;
}) {
  const ce = t.cita ? estadoCita(t.cita.estado) : null;
  return (
    <li id={`tip-${t.id}`} className={`px-4 py-3.5 transition-colors ${resaltada ? "bg-teal-50" : ""}`} style={resaltada ? { animation: "modal-backdrop 0.6s ease-out" } : undefined}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-slate-500">
        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700"><Avatar nombre={t.usuario || "?"} /> {t.usuario}</span>
        <span aria-hidden>·</span>
        <time dateTime={t.fecha} title={fechaHoraPy(t.fecha)} className="tabular-nums">{compacta ? fechaRelativa(t.fecha) : fechaHoraPy(t.fecha)}</time>
        {cliente ? <><span aria-hidden>·</span>{cliente}</> : null}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[11.5px] font-bold text-teal-700">
          <ClipboardPen className="h-3 w-3" aria-hidden /> {t.tipo_gestion}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold [overflow-wrap:anywhere] ${t.ticket ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"}`}>{t.resultado}</span>
      </div>
      <p className={`mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-slate-700 [overflow-wrap:anywhere] ${compacta ? "line-clamp-4" : ""}`}>{t.observacion}</p>

      {t.ticket ? (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-teal-200 bg-teal-50/50 px-3 py-2">
          <div className="min-w-0 text-[12px]">
            <p className="font-bold text-slate-800">
              <Headset className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-teal-700" aria-hidden />
              Ticket {numeroTicket(t.ticket.numero)}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: t.ticket.estado_color ?? "#94a3b8" }} aria-hidden />
                {t.ticket.estado_nombre}
              </span>
              <span>Prioridad {t.ticket.prioridad_nombre}</span>
            </p>
          </div>
          {puedeSoporte && onVerTicket ? (
            <button type="button" onClick={() => onVerTicket(t.ticket!.id)}
              className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[12px] font-semibold text-teal-700 shadow-sm ring-1 ring-teal-200 hover:bg-teal-50 max-sm:min-h-11">
              Ver ticket
            </button>
          ) : null}
        </div>
      ) : null}

      {t.cita ? (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-indigo-50/50 px-3 py-2">
          <p className="inline-flex flex-wrap items-center gap-1.5 text-[12px] font-semibold text-indigo-800">
            <GraduationCap className="h-3.5 w-3.5" aria-hidden />
            Capacitación · {fechaHoraPy(t.cita.inicio_at)}
            {t.cita.responsable ? <span className="font-medium text-indigo-600">· {t.cita.responsable}</span> : null}
            {ce ? <span className={`rounded-full px-2 py-px text-[10.5px] font-bold ${ce.color}`}>{ce.nombre}</span> : null}
          </p>
          <Link href={`/clientes/agenda?cita=${t.cita.id}`}
            className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[12px] font-semibold text-indigo-700 shadow-sm ring-1 ring-indigo-200 hover:bg-indigo-50 max-sm:min-h-11">
            Ver en Agenda <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      ) : null}
    </li>
  );
}

/** Esqueleto del historial mientras llega (nunca un spinner de pantalla completa). */
export function HistorialEsqueleto({ filas = 3 }: { filas?: number }) {
  const bar = "animate-pulse rounded-md bg-slate-200/80";
  return (
    <ul className="divide-y divide-slate-100" aria-hidden>
      {Array.from({ length: filas }).map((_, i) => (
        <li key={i} className="space-y-2 px-4 py-4">
          <div className={`h-3 w-40 ${bar}`} />
          <div className="flex gap-1.5"><div className={`h-4 w-20 ${bar}`} /><div className={`h-4 w-44 ${bar}`} /></div>
          <div className={`h-3 w-full ${bar}`} />
          <div className={`h-3 w-2/3 ${bar}`} />
        </li>
      ))}
    </ul>
  );
}
