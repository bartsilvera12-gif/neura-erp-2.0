"use client";

/**
 * Tipificación en un modal, encima de donde estás (Gestión del Cliente, la ficha, el registro).
 * Sin cliente elegido, primero pide uno (el mismo buscador de Gestión). Al guardar se cierra y
 * quien lo abrió muestra el aviso (useAvisoTipificacion) con "Ver ticket" si se creó uno.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ClipboardPen, X } from "lucide-react";
import { CapaModal } from "@/components/CapaModal";
import { BuscadorCliente } from "@/modules/clientes/gestion/BuscadorCliente";
import { numeroTicket } from "@/modules/tipificacion/dominio";
import { precargarTipificacion } from "@/modules/tipificacion/datos";
import { PanelTipificacion, type ResultadoGuardado } from "@/modules/tipificacion/PanelTipificacion";
import { ModalTicketResumen } from "@/modules/tipificacion/ModalTicketResumen";

export function ModalTipificacion({ clienteId, clienteNombre, onClose, onGuardada }: {
  clienteId?: string | null;
  clienteNombre?: string;
  onClose: () => void;
  onGuardada?: (r: ResultadoGuardado & { clienteId: string }) => void;
}) {
  const [cliente, setCliente] = useState<{ id: string; nombre: string } | null>(clienteId ? { id: clienteId, nombre: clienteNombre ?? "" } : null);
  useEffect(() => { precargarTipificacion(clienteId); }, [clienteId]);

  return (
    <CapaModal onClose={onClose}>
      {cliente ? (
        <PanelTipificacion key={cliente.id} clienteId={cliente.id} clienteNombre={cliente.nombre} modo="modal" onCerrar={onClose}
          onGuardada={(r) => { onGuardada?.({ ...r, clienteId: cliente.id }); onClose(); }} />
      ) : (
        <div role="dialog" aria-modal="true" aria-label="Nueva tipificación: elegí el cliente"
          className="flex w-full max-w-2xl flex-col overflow-visible rounded-2xl bg-white shadow-2xl max-sm:min-h-[70dvh]"
          style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
          <div className="flex shrink-0 items-center gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700"><ClipboardPen className="h-[18px] w-[18px]" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--brand)]">Nueva tipificación</p>
              <h2 className="text-[15px] font-bold text-slate-900">¿Con qué cliente?</h2>
            </div>
            <button type="button" aria-label="Cerrar" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="px-4 pb-6 pt-5 sm:px-6">
            <BuscadorCliente variant="landing" onSelect={(c) => { precargarTipificacion(c.id); setCliente({ id: c.id, nombre: c.nombre }); }} />
          </div>
        </div>
      )}
    </CapaModal>
  );
}

/**
 * Aviso "Tipificación guardada" (abajo, unos segundos) con "Ver ticket #0001" que abre el
 * ticket en un modal. Uso: const aviso = useAvisoTipificacion(); … aviso.mostrar(r); {aviso.nodo}
 */
export function useAvisoTipificacion() {
  const [r, setR] = useState<ResultadoGuardado | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  useEffect(() => {
    if (!r) return;
    const t = window.setTimeout(() => setR(null), r.alta.ticket || r.aviso ? 9000 : 4500);
    return () => window.clearTimeout(t);
  }, [r]);
  const mostrar = useCallback((x: ResultadoGuardado) => setR(x), []);
  const nodo = (
    <>
      {r ? (
        <div role="status" aria-live="polite"
          className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[70] mx-auto flex max-w-lg items-start gap-3 rounded-2xl border border-emerald-200 bg-white px-4 py-3 shadow-[0_12px_32px_-8px_rgba(2,48,71,0.3)] sm:inset-x-auto sm:left-1/2 sm:w-[min(32rem,calc(100vw-2rem))] sm:-translate-x-1/2"
          style={{ animation: "modal-pop 0.2s cubic-bezier(0.16,1,0.3,1)" }}>
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
          <div className="min-w-0 flex-1 text-[13.5px]">
            <p className="font-semibold text-slate-800">{r.mensaje}</p>
            {r.aviso ? <p className="mt-0.5 text-[12px] font-medium text-amber-700">{r.aviso}</p> : null}
          </div>
          {r.alta.ticket ? (
            <button type="button" onClick={() => { setTicket(r.alta.ticket!.id); setR(null); }}
              className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-emerald-700 max-sm:min-h-11">
              Ver ticket {numeroTicket(r.alta.ticket.numero)}
            </button>
          ) : null}
          <button type="button" aria-label="Cerrar aviso" onClick={() => setR(null)} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {ticket ? <ModalTicketResumen ticketId={ticket} onClose={() => setTicket(null)} /> : null}
    </>
  );
  return { mostrar, nodo };
}
