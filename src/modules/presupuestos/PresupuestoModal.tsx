"use client";

/**
 * Modal "Detalle del presupuesto": el detalle completo sobre la lista, con el mismo marco que
 * la ficha del cliente (franja de color, rótulo y botón Cerrar; el contenido scrollea y en
 * celular el pie con el total y la acción principal queda pegado abajo del modal).
 */
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { PresupuestoDetalle } from "@/modules/presupuestos/PresupuestoDetalle";

export function PresupuestoModal({ id, onCerrar, onCambio }: { id: string; onCerrar: () => void; onCambio?: () => void }) {
  return (
    <CapaModal onClose={onCerrar} fondo="bg-slate-900/55 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Detalle del presupuesto"
        className={`relative flex h-[100dvh] w-full max-w-6xl sm:h-[92dvh] ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-[#4FAEB2]/10 ring-1 ring-[#4FAEB2]/15`}
        style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}
      >
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-10 h-1 bg-gradient-to-r from-[#4FAEB2] via-[#4FAEB2]/80 to-[#4FAEB2]/40" />
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 bg-white py-1.5 pl-4 pr-2 sm:px-5 sm:py-3">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Detalle del presupuesto</p>
          </div>
          <button type="button" onClick={onCerrar}
            className="min-h-11 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2] sm:min-h-0">
            Cerrar
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-50/50 px-3 pt-3 sm:px-5 sm:py-5">
          {/* key: al pasar a otro presupuesto se arranca de cero (sin datos ni avisos del anterior). */}
          <PresupuestoDetalle key={id} id={id} onCerrar={onCerrar} onCambio={onCambio} />
        </div>
      </div>
    </CapaModal>
  );
}
