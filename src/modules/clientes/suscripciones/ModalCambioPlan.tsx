"use client";

/**
 * Cambio de plan (como ModalCambioPlanGestion del sistema actual): plan nuevo, precio y
 * desde cuándo rige, con cada opción explicada y deshabilitada (con el porqué) cuando la
 * cuota de este mes no lo permite.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchCache } from "@/lib/api/cache-cliente";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import MontoInput from "@/components/ui/MontoInput";
import { TEAL } from "@/modules/clientes/ui";
import type { ModoCambioPlan, Plan, SuscripcionCliente } from "@/modules/clientes/suscripciones/tipos";
import { mesActual, monto, nombreMes, sumarMes } from "@/modules/clientes/suscripciones/ui";

export function ModalCambioPlan({ suscripcion: s, onClose, onHecho }: {
  suscripcion: SuscripcionCliente;
  onClose: () => void;
  onHecho: (mensaje: string) => void;
}) {
  const [planes, setPlanes] = useState<Plan[] | null>(null);
  const [planId, setPlanId] = useState("");
  const [precio, setPrecio] = useState<number | "">("");
  const [modo, setModo] = useState<ModoCambioPlan>("proximo_mes");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetchCache<Plan[]>("/api/planes?activos=1", { fresco: true })
      .then((p) => setPlanes(p.filter((x) => x.activo)))
      .catch((e) => { setPlanes([]); setError((e as Error).message); });
  }, []);

  const actual = mesActual();
  const siguiente = sumarMes(actual, 1);
  const cuotaMes = s.meses.find((m) => m.periodo.slice(0, 7) === actual) ?? null;
  const emitida = !!cuotaMes?.venta_id;
  const conCobros = emitida && (cuotaMes!.estado === "pagada" || (cuotaMes!.saldo != null && Number(cuotaMes!.saldo) < Number(cuotaMes!.monto)));
  const plan = useMemo(() => planes?.find((p) => p.id === planId) ?? null, [planes, planId]);

  const modos: { id: ModoCambioPlan; titulo: string; detalle: string; bloqueo: string | null }[] = [
    {
      id: "proximo_mes",
      titulo: "Desde el mes que viene",
      detalle: `La cuota de ${nombreMes(actual)} queda como está; desde ${nombreMes(siguiente)} se cobra el plan nuevo.`,
      bloqueo: null,
    },
    {
      id: "inmediato",
      titulo: "Ya, desde este mes",
      detalle: `La cuota de ${nombreMes(actual)} se emite con el plan nuevo (todavía no se emitió).`,
      bloqueo: emitida ? `La cuota de ${nombreMes(actual)} ya está emitida (${cuotaMes!.numero}).` : null,
    },
    {
      id: "actualizar_cuota_pendiente",
      titulo: "Ya, y rehacer la cuota de este mes",
      detalle: `Se anula la cuota de ${nombreMes(actual)} y se vuelve a emitir con el precio nuevo (solo si todavía no tiene cobros).`,
      bloqueo: !emitida ? `La cuota de ${nombreMes(actual)} todavía no se emitió: usá "Ya, desde este mes".` : conCobros ? `La cuota ${cuotaMes!.numero} ya tiene cobros: no se puede rehacer.` : null,
    },
  ];

  // Si la opción elegida queda bloqueada, pasar a la primera disponible.
  useEffect(() => {
    const elegido = modos.find((m) => m.id === modo);
    if (elegido?.bloqueo) {
      const libre = modos.find((m) => !m.bloqueo);
      if (libre) setModo(libre.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emitida, conCobros]);

  function elegirPlan(id: string) {
    setPlanId(id);
    const p = planes?.find((x) => x.id === id);
    if (p) setPrecio(Number(p.precio));
  }

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    if (!plan) { setError("Elegí el plan nuevo"); return; }
    if (precio === "" || Number(precio) < 0) { setError("Indicá el precio"); return; }
    if (modos.find((m) => m.id === modo)?.bloqueo) { setError("Elegí una opción disponible"); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ numero_control?: string }>(`/api/suscripciones/${s.suscripcion_id}/plan`, {
        method: "POST",
        body: JSON.stringify({ plan_id: plan.id, modo, precio: Number(precio) }),
      });
      const cuando = modo === "proximo_mes" ? `desde ${nombreMes(siguiente)}` : "desde este mes";
      onHecho(`Cambio de plan: ${s.plan} → ${plan.nombre} ${cuando}${r?.numero_control ? ` · nueva cuota ${r.numero_control}` : ""}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal titulo="Cambiar plan" onClose={() => { if (!busy) onClose(); }} size="lg">
      <form onSubmit={confirmar} className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-sm text-slate-800">
          <p><span className="font-medium text-slate-500">Plan actual:</span> {s.plan} — {monto(s.precio, s.moneda)}</p>
          {s.plan_pendiente && s.pendiente_desde ? (
            <p className="mt-1 text-amber-800">
              <span className="font-medium">Cambio programado:</span> {s.plan_pendiente} desde {nombreMes(s.pendiente_desde)} (se reemplaza si confirmás otro)
            </p>
          ) : null}
          <p className="mt-1 text-xs text-slate-500">
            Cuota de {nombreMes(actual)}: {emitida ? `emitida ${cuotaMes!.numero}${conCobros ? " (con cobros)" : ""}` : "todavía no emitida"}
          </p>
        </div>

        {planes === null ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando planes…</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span className="mb-1 block text-xs font-medium text-slate-600">Plan nuevo</span>
              <Select block value={planId} onChange={elegirPlan}
                options={[["", "— Elegí un plan —"], ...planes.map((p) => [p.id, `${p.nombre} — ${monto(p.precio, p.moneda)}`] as [string, string])]} />
            </div>
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-600">Precio mensual</span>
              <MontoInput value={precio} onChange={(n) => setPrecio(n)} decimals={plan?.moneda === "USD"} placeholder="0"
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm tabular-nums outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]" />
            </label>
          </div>
        )}

        <div>
          <p className="mb-1.5 text-xs font-medium text-slate-600">¿Desde cuándo?</p>
          <div className="space-y-2">
            {modos.map((m) => {
              const sel = modo === m.id;
              return (
                <label key={m.id}
                  className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors ${m.bloqueo ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-400" : sel ? "cursor-pointer bg-[var(--brand-50)]" : "cursor-pointer border-slate-200 hover:bg-slate-50"}`}
                  style={sel && !m.bloqueo ? { borderColor: TEAL } : undefined}>
                  <input type="radio" name="modo-cambio" className="mt-0.5 accent-[var(--brand)]" checked={sel} disabled={!!m.bloqueo} onChange={() => setModo(m.id)} />
                  <span>
                    <span className={`block font-semibold ${m.bloqueo ? "" : "text-slate-800"}`}>
                      {m.titulo}{m.id === "proximo_mes" ? <span className="ml-1.5 text-[10px] font-semibold uppercase text-slate-400">recomendado</span> : null}
                    </span>
                    <span className="block text-xs">{m.bloqueo ?? m.detalle}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
          <button type="submit" disabled={busy || !plan} className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50" style={{ backgroundColor: TEAL }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? "Aplicando…" : "Confirmar cambio"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
