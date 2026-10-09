"use client";

/**
 * Pausar / reactivar / cancelar una suscripción, con la explicación de qué pasa.
 * Cancelar pide motivo y no tiene vuelta atrás (para retomar se crea una nueva).
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { Modal } from "@/components/Modal";
import type { EstadoSuscripcion } from "@/modules/clientes/suscripciones/tipos";

const TEXTO: Record<EstadoSuscripcion, { titulo: string; explicacion: string; boton: string; cls: string }> = {
  pausada: {
    titulo: "Pausar suscripción",
    explicacion: "Mientras esté pausada no se emiten cuotas. Las cuotas ya emitidas siguen en su cuenta a cobrar. La podés reactivar cuando quieras.",
    boton: "Pausar",
    cls: "bg-amber-600 hover:bg-amber-700",
  },
  activa: {
    titulo: "Reactivar suscripción",
    explicacion: "Vuelve a estar activa: los meses sin emitir se pueden emitir de nuevo desde \"Estado de facturación\" o desde Suscripciones.",
    boton: "Reactivar",
    cls: "bg-emerald-600 hover:bg-emerald-700",
  },
  cancelada: {
    titulo: "Cancelar suscripción",
    explicacion: "Se terminan las cuotas a partir de ahora. Lo ya emitido y cobrado se conserva. Una suscripción cancelada no se reactiva: si vuelve, se crea una nueva.",
    boton: "Cancelar suscripción",
    cls: "bg-rose-600 hover:bg-rose-700",
  },
};

export function ModalEstado({ suscripcionId, plan, estado, onClose, onHecho }: {
  suscripcionId: string;
  plan: string;
  estado: EstadoSuscripcion;
  onClose: () => void;
  onHecho: (mensaje: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = TEXTO[estado];
  const pideMotivo = estado === "cancelada";

  async function confirmar() {
    if (pideMotivo && motivo.trim().length < 3) { setError("Indicá el motivo de la cancelación"); return; }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/suscripciones/${suscripcionId}/estado`, {
        method: "POST",
        body: JSON.stringify({ estado, motivo: motivo.trim() || null }),
      });
      onHecho(`Suscripción ${plan}: ${estado === "activa" ? "reactivada" : estado}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal titulo={t.titulo} onClose={() => { if (!busy) onClose(); }}>
      <div className="space-y-3">
        <p className="text-sm font-semibold text-slate-800">{plan}</p>
        <p className="text-sm text-slate-600">{t.explicacion}</p>
        {pideMotivo ? (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Motivo obligatorio</span>
            <textarea autoFocus rows={2} maxLength={500} value={motivo} onChange={(e) => { setMotivo(e.target.value); setError(null); }}
              placeholder="Ej: el cliente pidió la baja, cerró el local…"
              className="min-h-[60px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-rose-300" />
          </label>
        ) : null}
        {error ? <p className="text-xs text-rose-600">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Volver
          </button>
          <button type="button" onClick={confirmar} disabled={busy} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-50 ${t.cls}`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t.boton}
          </button>
        </div>
      </div>
    </Modal>
  );
}
