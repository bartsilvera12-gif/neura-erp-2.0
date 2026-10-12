"use client";

/**
 * Modales chicos del CRM: motivo de pérdida, transformar a cliente y configurar etapas.
 */
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { apiFetch } from "@/lib/api/client-fetch";
import { COLORES_ETAPA, COLOR_LABEL, tonoEtapa, type Tarjeta } from "@/modules/crm/tipos";
import { BTN_PRIMARIO, BTN_SECUNDARIO, INPUT, LABEL } from "./comun";

/** Marca para que el modal grande de abajo no se cierre con el mismo Escape. */
const Marca = () => <span data-modal-chico hidden />;

// ── Motivo de pérdida ────────────────────────────────────────────────────────
export function MotivoPerdidaModal({ etapaNombre, prospecto, onCancel, onConfirm }: {
  etapaNombre: string; prospecto: string; onCancel: () => void; onConfirm: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const SUGERENCIAS = ["Precio", "Eligió a la competencia", "No responde", "No le interesa", "Sin presupuesto"];
  return (
    <Modal titulo={`Pasar a ${etapaNombre}`} onClose={onCancel}>
      <Marca />
      <form
        onSubmit={(e) => { e.preventDefault(); if (motivo.trim()) onConfirm(motivo.trim()); }}
        className="space-y-4"
      >
        <p className="text-sm text-slate-600">¿Por qué se perdió <strong className="text-slate-800">{prospecto}</strong>?</p>
        <div className="flex flex-wrap gap-1.5">
          {SUGERENCIAS.map((s) => (
            <button key={s} type="button" onClick={() => setMotivo(s)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${motivo === s ? "border-rose-300 bg-rose-50 text-rose-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
              {s}
            </button>
          ))}
        </div>
        <label className="block">
          <span className={LABEL}>Motivo *</span>
          <textarea autoFocus rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} placeholder="Contá brevemente el motivo" className={`${INPUT} resize-none`} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={BTN_SECUNDARIO}>Cancelar</button>
          <button type="submit" disabled={!motivo.trim()} className="rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-40">
            Marcar como perdido
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Transformar a cliente ────────────────────────────────────────────────────
export type Convertido = { cliente_id: string; etapa: string | null; updated_at: string | null; etapa_desde: string | null };

export function ConvertirClienteModal({ prospecto, onClose, onConvertido }: {
  prospecto: Pick<Tarjeta, "id" | "numero_control" | "empresa" | "contacto" | "telefono" | "email">;
  onClose: () => void;
  onConvertido: (r: Convertido) => void;
}) {
  const conEmpresa = !!prospecto.empresa?.trim();
  const [f, setF] = useState({
    tipo_cliente: (conEmpresa ? "empresa" : "persona") as "empresa" | "persona",
    nombre: (prospecto.empresa?.trim() || prospecto.contacto || "").trim(),
    razon_social: "",
    doc: "",
    telefono: prospecto.telefono ?? "",
    email: prospecto.email ?? "",
    ciudad: "",
    direccion: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const empresa = f.tipo_cliente === "empresa";

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.nombre.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const doc = f.doc.trim();
      const esRuc = empresa || /^\d{3,}-\d$/.test(doc);
      const r = await apiFetch<Convertido>(`/api/crm/${prospecto.id}/convertir`, {
        method: "POST",
        body: JSON.stringify({
          nombre: f.nombre.trim(),
          tipo_cliente: f.tipo_cliente,
          razon_social: empresa ? f.razon_social.trim() || f.nombre.trim() : "",
          telefono: f.telefono.trim(),
          email: f.email.trim(),
          documento: doc && !esRuc ? doc : "",
          ruc: doc && esRuc ? doc : "",
          ciudad: f.ciudad.trim(),
          direccion: f.direccion.trim(),
        }),
      });
      onConvertido(r);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal titulo="Transformar a cliente" onClose={onClose} size="lg">
      <Marca />
      <form onSubmit={guardar} className="space-y-4">
        <p className="text-xs text-slate-500">
          Lead <span className="font-mono">{prospecto.numero_control}</span> — {prospecto.contacto || prospecto.empresa}. Se crea el cliente con estos datos y el lead pasa a <strong>Ganado</strong>.
        </p>
        <div className="flex gap-2">
          {(["persona", "empresa"] as const).map((t) => (
            <button key={t} type="button" onClick={() => set("tipo_cliente", t)}
              className={`flex-1 rounded-xl border-2 py-2 text-xs font-semibold capitalize transition-colors ${f.tipo_cliente === t ? "border-[var(--brand)] bg-[var(--brand-50)] text-[var(--brand)]" : "border-slate-200 text-slate-500"}`}>
              {t}
            </button>
          ))}
        </div>
        <label className="block">
          <span className={LABEL}>{empresa ? "Nombre de la empresa *" : "Nombre y apellido *"}</span>
          <input autoFocus value={f.nombre} onChange={(e) => set("nombre", e.target.value)} className={INPUT} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          {empresa ? (
            <label className="block">
              <span className={LABEL}>Razón social</span>
              <input value={f.razon_social} onChange={(e) => set("razon_social", e.target.value)} placeholder="Opcional" className={INPUT} />
            </label>
          ) : null}
          <label className={`block ${empresa ? "" : "col-span-2"}`}>
            <span className={LABEL}>{empresa ? "RUC" : "CI / RUC"}</span>
            <input value={f.doc} onChange={(e) => set("doc", e.target.value)} placeholder="Opcional" className={INPUT} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={LABEL}>Teléfono</span>
            <input value={f.telefono} onChange={(e) => set("telefono", e.target.value)} className={INPUT} />
          </label>
          <label className="block">
            <span className={LABEL}>Email</span>
            <input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} className={INPUT} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={LABEL}>Ciudad</span>
            <input value={f.ciudad} onChange={(e) => set("ciudad", e.target.value)} placeholder="Opcional" className={INPUT} />
          </label>
          <label className="block">
            <span className={LABEL}>Dirección</span>
            <input value={f.direccion} onChange={(e) => set("direccion", e.target.value)} placeholder="Opcional" className={INPUT} />
          </label>
        </div>
        {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={BTN_SECUNDARIO}>Cancelar</button>
          <button type="submit" disabled={busy || !f.nombre.trim()} className={BTN_PRIMARIO}>{busy ? "Creando…" : "Crear cliente"}</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Configurar etapas (ADMIN) ────────────────────────────────────────────────
type EtapaConfig = { id: string; codigo: string; nombre: string; color: string; orden: number; es_ganado: boolean; es_perdido: boolean; activo: boolean; cantidad: number };

export function EtapasModal({ onClose, onGuardado }: { onClose: () => void; onGuardado: () => void }) {
  const [etapas, setEtapas] = useState<EtapaConfig[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<EtapaConfig[]>("/api/crm/etapas").then(setEtapas).catch((e) => setError((e as Error).message));
  }, []);

  const set = (i: number, patch: Partial<EtapaConfig>) => setEtapas((p) => p && p.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const mover = (i: number, d: -1 | 1) =>
    setEtapas((p) => {
      if (!p) return p;
      const j = i + d;
      if (j < 0 || j >= p.length) return p;
      const n = [...p];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  async function guardar() {
    if (!etapas) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/crm/etapas", {
        method: "PUT",
        body: JSON.stringify({ etapas: etapas.map((e, i) => ({ id: e.id, nombre: e.nombre.trim(), color: e.color, orden: i + 1, activo: e.activo })) }),
      });
      onGuardado();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal titulo="Etapas del pipeline" onClose={onClose} size="xl">
      <p className="mb-3 text-xs leading-relaxed text-slate-500">
        Columnas del embudo comercial. Podés cambiar el nombre, el color, el orden y ocultar las que no uses. Los códigos son fijos.
      </p>
      {!etapas ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : (
        <ul className="space-y-2">
          {etapas.map((e, i) => {
            const tono = tonoEtapa(e.color);
            return (
              <li key={e.id} className={`flex flex-wrap items-center gap-2 rounded-xl border border-l-4 border-slate-200 bg-white px-3 py-2 ${tono.borderLeft} ${e.activo ? "" : "opacity-60"}`}>
                <div className="flex flex-col">
                  <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir" className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => mover(i, 1)} disabled={i === etapas.length - 1} aria-label="Bajar" className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                </div>
                <span className="w-28 shrink-0 font-mono text-[11px] text-slate-400">{e.codigo}</span>
                <input value={e.nombre} onChange={(ev) => set(i, { nombre: ev.target.value })} maxLength={60} className="min-w-32 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20" />
                <div className="flex items-center gap-1" role="radiogroup" aria-label="Color">
                  {COLORES_ETAPA.map((c) => (
                    <button key={c} type="button" title={COLOR_LABEL[c]} aria-label={COLOR_LABEL[c]} aria-checked={e.color === c} role="radio" onClick={() => set(i, { color: c })}
                      className={`h-5 w-5 rounded-full ${tonoEtapa(c).dot} ${e.color === c ? "ring-2 ring-slate-700 ring-offset-1" : "opacity-70 hover:opacity-100"}`} />
                  ))}
                </div>
                <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-slate-500">{e.cantidad} prosp.</span>
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" checked={e.activo} onChange={(ev) => set(i, { activo: ev.target.checked })} className="accent-[var(--brand)]" />
                  Activa
                </label>
                {e.es_ganado || e.es_perdido ? (
                  <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${e.es_ganado ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                    {e.es_ganado ? "Ganado" : "Perdido"}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {error ? <p className="mt-3 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BTN_SECUNDARIO}>Cancelar</button>
        <button type="button" onClick={guardar} disabled={busy || !etapas || etapas.some((e) => !e.nombre.trim())} className={BTN_PRIMARIO}>
          {busy ? "Guardando…" : "Guardar etapas"}
        </button>
      </div>
    </Modal>
  );
}
