"use client";

/** Modales de Presupuestos: rechazar y ajustes. Todos sobre CapaModal. (El presupuesto se manda como PDF: no hay link ni WhatsApp.) */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Settings2, ThumbsDown } from "lucide-react";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { apiFetch } from "@/lib/api/client-fetch";
import { invalidar } from "@/lib/api/cache-cliente";
import { clienteConfig } from "@/cliente.config";
import { CLASE_ETIQUETA, CLASE_INPUT } from "@/modules/presupuestos/ui";
import type { ConfigPresupuestos } from "@/modules/presupuestos/tipos";

const TEAL = clienteConfig.color;

function Panel({ titulo, subtitulo, icono, children, pie, onClose, ancho = "max-w-lg" }: {
  titulo: string;
  subtitulo?: string;
  icono?: React.ReactNode;
  children: React.ReactNode;
  pie: React.ReactNode;
  onClose?: () => void;
  ancho?: string;
}) {
  return (
    <CapaModal onClose={onClose}>
      <div role="dialog" aria-modal className={`flex w-full ${ancho} ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`}>
        <div className="flex shrink-0 items-start gap-3 px-6 pt-6 pb-3">
          {icono ? <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-50)] text-[var(--brand)]">{icono}</span> : null}
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">{titulo}</h2>
            {subtitulo ? <p className="mt-0.5 text-sm text-slate-500">{subtitulo}</p> : null}
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-2">{children}</div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-6 py-4">{pie}</div>
      </div>
    </CapaModal>
  );
}

const BTN_SEC = "rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50";

export function ModalRechazo({ numero, onClose, onConfirmar }: {
  numero: string;
  onClose: () => void;
  onConfirmar: (motivo: string) => Promise<void>;
}) {
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sugerencias = ["Precio alto", "Compró a la competencia", "Plazo de entrega", "Ya no lo necesita", "Sin respuesta del cliente"];

  async function confirmar() {
    if (!motivo.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirmar(motivo.trim());
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Panel titulo={`Rechazar ${numero}`} subtitulo="El motivo queda en el historial y sirve para ver por qué se pierden ventas."
      icono={<ThumbsDown className="h-5 w-5" />} onClose={busy ? undefined : onClose} ancho="max-w-md"
      pie={<>
        <button type="button" onClick={onClose} disabled={busy} className={BTN_SEC}>Volver</button>
        <button type="button" onClick={() => void confirmar()} disabled={busy || !motivo.trim()}
          className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-40">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Marcar rechazado
        </button>
      </>}>
      <div className="flex flex-wrap gap-1.5">
        {sugerencias.map((s) => (
          <button key={s} type="button" onClick={() => setMotivo(s)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${motivo === s ? "border-rose-300 bg-rose-50 text-rose-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
            {s}
          </button>
        ))}
      </div>
      <textarea autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} maxLength={500} placeholder="Motivo del rechazo"
        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-rose-300 focus:ring-4 focus:ring-rose-100" />
      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
    </Panel>
  );
}

/** Ajustes del módulo (solo administrador): validez por defecto y condiciones. (La respuesta online se quitó de la pantalla:
 * se reenvía el valor guardado tal cual, sin cambiarlo.) */
export function ModalAjustes({ onClose, onGuardado }: { onClose: () => void; onGuardado: () => void }) {
  const [cfg, setCfg] = useState<ConfigPresupuestos | null>(null);
  const [dias, setDias] = useState("15");
  const [condiciones, setCondiciones] = useState("");
  const [online, setOnline] = useState(true); // sin control en pantalla: se conserva lo guardado
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ConfigPresupuestos>("/api/presupuestos/config")
      .then((c) => { setCfg(c); setDias(String(c.validez_dias)); setCondiciones(c.condiciones ?? ""); setOnline(c.respuesta_online); })
      .catch((e) => setError((e as Error).message));
  }, []);
  const diasNum = Number(dias);
  const valido = useMemo(() => Number.isInteger(diasNum) && diasNum >= 1 && diasNum <= 365, [diasNum]);

  async function guardar() {
    if (!valido) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/presupuestos/config", { method: "PUT", body: JSON.stringify({ validez_dias: diasNum, condiciones: condiciones.trim() || null, respuesta_online: online }) });
      invalidar("/api/presupuestos/config");
      onGuardado();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Panel titulo="Ajustes de presupuestos" subtitulo="Se aplican a los presupuestos nuevos." icono={<Settings2 className="h-5 w-5" />}
      onClose={busy ? undefined : onClose}
      pie={<>
        <button type="button" onClick={onClose} disabled={busy} className={BTN_SEC}>Cancelar</button>
        <button type="button" onClick={() => void guardar()} disabled={busy || !cfg || !valido}
          className="inline-flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-40" style={{ backgroundColor: TEAL }}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar
        </button>
      </>}>
      {!cfg && !error ? <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p> : null}
      {cfg ? (
        <>
          <label className="block">
            <span className={CLASE_ETIQUETA}>Validez por defecto</span>
            <div className="flex items-center gap-2">
              <input inputMode="numeric" pattern="[0-9]*" enterKeyHint="done" value={dias} onChange={(e) => setDias(e.target.value.replace(/\D/g, "").slice(0, 3))} className={`${CLASE_INPUT} w-24 text-right tabular-nums`} />
              <span className="text-sm text-slate-500">días</span>
            </div>
            {!valido ? <span className="mt-1 block text-[11px] text-rose-600">Entre 1 y 365 días.</span> : null}
          </label>
          <label className="block">
            <span className={CLASE_ETIQUETA}>Condiciones comerciales por defecto <span className="font-normal text-slate-400">(las ve el cliente)</span></span>
            <textarea value={condiciones} onChange={(e) => setCondiciones(e.target.value)} rows={5} maxLength={4000}
              placeholder={"Ej: Entrega a coordinar dentro de las 48 h.\nForma de pago: transferencia o efectivo."} className={CLASE_INPUT} />
          </label>
        </>
      ) : null}
      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
    </Panel>
  );
}
