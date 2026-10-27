"use client";

/**
 * Ticket de Soporte en un modal (desde la tipificación o el registro): número, asunto, estado,
 * prioridad, responsable, SLA y descripción, sin salir de donde estás. "Abrir ticket completo"
 * lleva a la pantalla del ticket (comentarios, archivos, historial) solo si hace falta.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink, Headset, X } from "lucide-react";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { apiFetchSWR } from "@/lib/api/cache-cliente";
import { ChipSla } from "@/modules/soporte/ui";
import { fechaHoraPy, numeroTicket } from "@/modules/tipificacion/dominio";

type TicketResumen = {
  id: string; numero: number; asunto: string; descripcion: string | null; cliente_nombre: string | null;
  tipo_etiqueta: string; clasificacion_nombre: string | null; estado_nombre: string; estado_color: string;
  prioridad_nombre: string; prioridad_color: string; fecha_objetivo: string | null; created_at: string;
  responsable: { nombre: string } | null; creador: { nombre: string } | null; sla: { estado: string };
};
type Respuesta = { ticket: TicketResumen; contadores: { comentarios: number; archivos: number; relaciones: number } };

export function ModalTicketResumen({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const [r, setR] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    apiFetchSWR<Respuesta>(`/api/soporte/tickets/${ticketId}`, (d) => setR(d), { signal: ctrl.signal })
      .catch((e) => { if (!ctrl.signal.aborted) setError((e as Error).message || "No se pudo cargar el ticket"); });
    return () => ctrl.abort();
  }, [ticketId]);

  const t = r?.ticket;
  return (
    <CapaModal onClose={onClose} z="z-[60]">
      <div role="dialog" aria-modal="true" aria-label={t ? `Ticket ${numeroTicket(t.numero)}` : "Ticket"}
        className={`flex w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${ALTO_MAX_MODAL}`}
        style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700"><Headset className="h-[18px] w-[18px]" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Ticket de Soporte</p>
            <h2 className="truncate text-[15px] font-bold text-slate-900">{t ? `${numeroTicket(t.numero)} · ${t.asunto}` : "Cargando…"}</h2>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
          {!t && !error ? (
            <div className="space-y-3" aria-hidden>
              {[56, 80, 64, 100].map((w, i) => <div key={i} className="h-4 animate-pulse rounded bg-slate-200/80" style={{ width: `${w}%` }} />)}
            </div>
          ) : null}
          {t ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-bold" style={{ borderColor: `${t.estado_color}55`, color: t.estado_color, backgroundColor: `${t.estado_color}14` }}>
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.estado_color }} aria-hidden /> {t.estado_nombre}
                </span>
                <span className="rounded-full px-2.5 py-0.5 text-[12px] font-bold" style={{ color: t.prioridad_color, backgroundColor: `${t.prioridad_color}18` }}>Prioridad {t.prioridad_nombre}</span>
                <ChipSla estado={t.sla.estado} compacto />
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
                <Dato k="Tipo">{t.tipo_etiqueta}{t.clasificacion_nombre ? ` · ${t.clasificacion_nombre}` : ""}</Dato>
                <Dato k="Cliente">{t.cliente_nombre ?? "—"}</Dato>
                <Dato k="Responsable">{t.responsable?.nombre ?? <span className="text-slate-400">Sin asignar</span>}</Dato>
                <Dato k="Cargado por">{t.creador?.nombre ?? "—"}</Dato>
                <Dato k="Creado">{fechaHoraPy(t.created_at)}</Dato>
                <Dato k="Entrega (SLA)">{t.fecha_objetivo ? fechaHoraPy(t.fecha_objetivo) : "—"}</Dato>
              </dl>
              {t.descripcion ? (
                <div>
                  <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Descripción</p>
                  <p className="whitespace-pre-line rounded-xl bg-slate-50 px-3 py-2.5 text-[13px] leading-relaxed text-slate-700 [overflow-wrap:anywhere]">{t.descripcion}</p>
                </div>
              ) : null}
              {r ? (
                <p className="text-[12px] text-slate-500">
                  {r.contadores.comentarios} comentario(s) · {r.contadores.archivos} archivo(s) · {r.contadores.relaciones} relación(es)
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-5">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 max-sm:flex-1">Cerrar</button>
          <Link href={`/soporte/tickets/${ticketId}`} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white hover:brightness-95 max-sm:flex-1">
            Abrir ticket completo <ExternalLink className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </CapaModal>
  );
}

function Dato({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">{k}</dt>
      <dd className="mt-0.5 font-medium text-slate-800 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
