"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import type { Cliente } from "@/modules/caja/lib";

const BRAND = clienteConfig.color;
const INPUT =
  "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";

/** Alta rápida de cliente. Se usa desde la página de Clientes y desde la caja. */
export function NuevoCliente({ onClose, onCreado }: { onClose: () => void; onCreado: (c: Cliente) => void }) {
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<"persona" | "empresa">("persona");
  const [documento, setDocumento] = useState("");
  const [telefono, setTelefono] = useState("");
  const [condicion, setCondicion] = useState<"CONTADO" | "CREDITO">("CONTADO");
  const [limite, setLimite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const c = await apiFetch<Cliente>("/api/clientes", {
        method: "POST",
        body: JSON.stringify({
          nombre: nombre.trim(),
          tipo_cliente: tipo,
          documento: documento.trim() || undefined,
          telefono: telefono.trim() || undefined,
          condicion_pago: condicion,
          limite_credito: condicion === "CREDITO" ? Number(limite) || 0 : 0,
        }),
      });
      onCreado(c);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal titulo="Nuevo cliente" onClose={onClose}>
      <form onSubmit={guardar} className="space-y-4">
        <div className="flex gap-2">
          {(["persona", "empresa"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTipo(t)}
              className="flex-1 rounded-xl border-2 py-2 text-xs font-semibold capitalize transition-colors"
              style={tipo === t ? { borderColor: BRAND, backgroundColor: "var(--brand-50)", color: BRAND } : { borderColor: "#e2e8f0", color: "#64748b" }}
            >
              {t}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">{tipo === "empresa" ? "Razón social / nombre *" : "Nombre *"}</span>
          <input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} className={INPUT} placeholder={tipo === "empresa" ? "Nombre de la empresa" : "Nombre y apellido"} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">{tipo === "empresa" ? "RUC" : "Documento"}</span>
            <input value={documento} onChange={(e) => setDocumento(e.target.value)} className={INPUT} placeholder="Opcional" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Teléfono</span>
            <input value={telefono} onChange={(e) => setTelefono(e.target.value)} className={INPUT} placeholder="Opcional" />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Condición</span>
            <Select value={condicion} onChange={(v) => setCondicion(v as "CONTADO" | "CREDITO")} block options={[["CONTADO", "Contado"], ["CREDITO", "Crédito"]]} />
          </label>
          {condicion === "CREDITO" ? (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Límite de crédito</span>
              <input inputMode="numeric" value={limite} onChange={(e) => setLimite(e.target.value.replace(/\D/g, ""))} className={`${INPUT} text-right tabular-nums`} placeholder="0" />
            </label>
          ) : null}
        </div>

        {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy || !nombre.trim()}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-40"
            style={{ backgroundColor: BRAND }}
          >
            {busy ? "Guardando…" : "Crear cliente"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
