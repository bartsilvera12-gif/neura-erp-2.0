"use client";

/**
 * Dar de baja (panel ámbar bajo el encabezado, como el sistema actual) y Eliminar (modal con
 * el resumen de lo que tiene el cliente; si tiene ventas o deuda no se puede: se da de baja).
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { Modal } from "@/components/Modal";
import { gs } from "@/modules/clientes/ui";

export function PanelBaja({ clienteId, onCancel, onHecho }: { clienteId: string; onCancel: () => void; onHecho: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    if (motivo.trim().length < 3) { setError("El motivo es obligatorio"); return; }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/clientes/${clienteId}/baja`, { method: "POST", body: JSON.stringify({ motivo: motivo.trim() }) });
      onHecho();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm font-medium text-amber-800">
        Dar de baja: el cliente pasa a inactivo y deja de aparecer en la lista de activos. Se conserva con todo su historial
        (ventas, cobros y deuda) y se puede reactivar cuando quieras.
      </p>
      <div>
        <label htmlFor="baja-motivo" className="mb-1 block text-xs font-medium text-amber-800">Motivo obligatorio</label>
        <textarea id="baja-motivo" autoFocus value={motivo} onChange={(e) => { setMotivo(e.target.value); setError(null); }} rows={2} maxLength={500}
          placeholder="Ej: dejó de comprar, cerró el negocio, pidió la baja…"
          className="min-h-[60px] w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400" />
        {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={confirmar} disabled={busy} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50">
          {busy ? "Procesando…" : "Confirmar baja"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-100 disabled:opacity-50">
          Cancelar
        </button>
      </div>
    </div>
  );
}

type Preview = { ventas: number; deuda: number; cobros: number; saldo_favor: number; contactos: number; notas: number; puede_eliminar: boolean };

export function ModalEliminar({ clienteId, onClose, onEliminado, onDarDeBaja }: {
  clienteId: string; onClose: () => void; onEliminado: () => void; onDarDeBaja?: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [cargando, setCargando] = useState(true);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Preview>(`/api/clientes/${clienteId}/eliminar-preview`)
      .then(setPreview)
      .catch(() => setError("No se pudo cargar el resumen. Revisá que tengas permiso de administrador."))
      .finally(() => setCargando(false));
  }, [clienteId]);

  async function confirmar() {
    if (motivo.trim().length < 3) { setError("El motivo es obligatorio"); return; }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/clientes/${clienteId}`, { method: "DELETE", body: JSON.stringify({ motivo: motivo.trim() }) });
      onEliminado();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const bloqueos = preview
    ? [Number(preview.ventas) > 0 ? `${preview.ventas} venta${Number(preview.ventas) === 1 ? "" : "s"}` : null, Number(preview.deuda) > 0 ? `deuda de ${gs(preview.deuda)}` : null].filter(Boolean)
    : [];

  return (
    <Modal titulo="Eliminar cliente" onClose={() => { if (!busy) onClose(); }} size="lg">
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Deja de aparecer en el sistema, pero el registro se conserva (no es un borrado definitivo). Queda anotado quién lo eliminó y por qué.
        </p>
        {cargando ? (
          <div className="space-y-2" aria-busy="true">
            <div className="h-3 w-40 animate-pulse rounded bg-slate-200" />
            <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-full max-w-xs animate-pulse rounded bg-slate-100" />
          </div>
        ) : preview ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-sm text-slate-800">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Resumen del cliente</p>
            <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
              <li>Ventas: <span className="font-semibold">{preview.ventas}</span></li>
              <li>Deuda pendiente: <span className="font-semibold">{gs(preview.deuda)}</span></li>
              <li>Cobros registrados: <span className="font-semibold">{preview.cobros}</span></li>
              <li>Saldo a favor: <span className="font-semibold">{gs(preview.saldo_favor)}</span></li>
              <li>Contactos: <span className="font-semibold">{preview.contactos}</span></li>
              <li>Notas: <span className="font-semibold">{preview.notas}</span></li>
            </ul>
          </div>
        ) : null}

        {preview && !preview.puede_eliminar ? (
          <div className="rounded-lg border border-rose-300 bg-rose-100/60 p-3 text-sm text-rose-900">
            <p className="mb-1 font-medium">No se puede eliminar este cliente</p>
            <p className="text-xs">
              Tiene {bloqueos.join(" y ")}. Para que deje de ser cliente sin perder su historial, dalo de baja.
            </p>
            {onDarDeBaja ? (
              <button type="button" onClick={onDarDeBaja} className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100">
                Dar de baja
              </button>
            ) : null}
          </div>
        ) : null}

        {preview?.puede_eliminar ? (
          <div>
            <label htmlFor="eliminar-motivo" className="mb-1 block text-xs font-medium text-slate-700">Motivo obligatorio</label>
            <textarea id="eliminar-motivo" value={motivo} onChange={(e) => { setMotivo(e.target.value); setError(null); }} rows={2} maxLength={500}
              placeholder="Ej: cliente duplicado, cargado por error…"
              className="min-h-[60px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-rose-300" />
          </div>
        ) : null}
        {error ? <p className="text-xs text-rose-600">{error}</p> : null}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={confirmar} disabled={busy || cargando || !preview?.puede_eliminar}
            className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {busy ? "Eliminando…" : "Confirmar eliminación"}
          </button>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Cancelar
          </button>
        </div>
      </div>
    </Modal>
  );
}
