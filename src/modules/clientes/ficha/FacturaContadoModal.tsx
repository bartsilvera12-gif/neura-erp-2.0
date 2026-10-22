"use client";

/**
 * Modal "Factura al contado" (igual que el sistema actual): monto, descripción y tipo de
 * IVA. Emite un servicio puntual sin productos ni caja; queda como factura pendiente que
 * vence hoy en el Estado de cuenta y se cobra con "Registrar pago".
 */
import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { Select } from "@/components/Select";
import { AVISO_SIN_RUC } from "@/modules/empresa/tipos";
import MontoInput from "@/components/ui/MontoInput";

const INPUT = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm outline-none transition-colors hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";
const LABEL = "mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500";

export function FacturaContadoModal({ clienteId, clienteNombre, ruc, moneda, onClose, onEmitida, onEditarCliente }: {
  clienteId: string;
  clienteNombre: string;
  /** RUC para facturar (rucParaFactura). Sin RUC no hay factura (receta 66). */
  ruc: string | null;
  moneda: "GS" | "USD";
  /** Abre la edición del cliente (Datos para facturación), si la pantalla la tiene. */
  onEditarCliente?: () => void;
  onClose: () => void;
  onEmitida: (mensaje: string) => void;
}) {
  const [monto, setMonto] = useState(0);
  const [descripcion, setDescripcion] = useState("Venta al contado");
  const [iva, setIva] = useState<"10%" | "5%" | "exenta">("10%");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usd = moneda === "USD";

  async function emitir(e: React.FormEvent) {
    e.preventDefault();
    if (!ruc) { setError(AVISO_SIN_RUC); return; }
    if (!(monto > 0)) { setError("El monto debe ser mayor a 0."); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ numero_control: string }>(`/api/clientes/${clienteId}/factura-contado`, {
        method: "POST",
        body: JSON.stringify({ monto, descripcion: descripcion.trim() || null, tipo_iva: iva }),
      });
      onEmitida(`Factura ${r.numero_control} emitida. Queda pendiente de cobro en el Estado de cuenta.`);
    } catch (err) {
      setError((err as Error).message || "No se pudo emitir la factura.");
      setBusy(false);
    }
  }

  return (
    <CapaModal onClose={busy ? undefined : onClose} z="z-[120]">
      <form onSubmit={emitir}
        className={`flex w-full max-w-md ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-xl`}
        style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-slate-800">Factura al contado</h3>
            <p className="mt-0.5 truncate text-xs text-slate-500">{clienteNombre}{ruc ? ` · RUC ${ruc}` : ""} · un servicio puntual, sin productos ni caja.</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Cerrar" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {!ruc ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
              <p className="font-medium">{AVISO_SIN_RUC}</p>
              <p className="mt-0.5">Con la CI sola no se puede facturar.</p>
              {onEditarCliente ? (
                <button type="button" onClick={onEditarCliente} className="mt-1.5 min-h-11 font-semibold text-amber-900 underline underline-offset-2 sm:min-h-0">
                  Editar datos del cliente
                </button>
              ) : null}
            </div>
          ) : null}
          <label className="block">
            <span className={LABEL}>Monto ({usd ? "US$" : "Gs."}) *</span>
            <MontoInput autoFocus value={monto || ""} onChange={setMonto} decimals={usd} placeholder="0" className={`${INPUT} text-right tabular-nums`} />
          </label>
          <label className="block">
            <span className={LABEL}>Descripción</span>
            <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={200} placeholder="Venta al contado" className={INPUT} />
          </label>
          <div>
            <span className={LABEL}>IVA</span>
            <Select value={iva} onChange={(v) => setIva(v as typeof iva)} block etiqueta="IVA"
              options={[["10%", "IVA 10%"], ["5%", "IVA 5%"], ["exenta", "Exenta"]]} />
          </div>
          {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3.5 max-sm:[&>button]:flex-1 max-sm:[&>button]:justify-center">
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2] disabled:opacity-50">
            Cancelar
          </button>
          <button type="submit" disabled={busy || !ruc || !(monto > 0)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#4FAEB2] px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {busy ? "Emitiendo…" : "Emitir factura"}
          </button>
        </div>
      </form>
    </CapaModal>
  );
}
