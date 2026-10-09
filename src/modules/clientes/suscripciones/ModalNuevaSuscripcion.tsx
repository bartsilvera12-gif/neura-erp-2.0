"use client";

/**
 * "Nueva suscripción" (copia del sistema actual): plan, precio (sale del plan, editable),
 * fecha de inicio, duración (vacío = sin fin), día de facturación y de vencimiento,
 * observación. Al crear NO se emite nada solo: si querés la primera cuota ya, se marca
 * a la vista "Emitir también la cuota de <mes>".
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchCache } from "@/lib/api/cache-cliente";
import { hoyPY } from "@/lib/fecha/paraguay";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import MontoInput from "@/components/ui/MontoInput";
import { TEAL } from "@/modules/clientes/ui";
import type { Plan, SuscripcionCliente } from "@/modules/clientes/suscripciones/tipos";
import { IVA_LABEL, monto, nombreMes } from "@/modules/clientes/suscripciones/ui";

const INPUT = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
const LABEL = "mb-1 block text-xs font-medium text-slate-600";

export function ModalNuevaSuscripcion({ clienteId, suscripciones, esAdmin, onClose, onCreada }: {
  clienteId: string;
  suscripciones: SuscripcionCliente[];
  esAdmin: boolean;
  onClose: () => void;
  onCreada: (mensaje: string) => void;
}) {
  const [planes, setPlanes] = useState<Plan[] | null>(null);
  const [planId, setPlanId] = useState("");
  const [precio, setPrecio] = useState<number | "">("");
  const [inicio, setInicio] = useState(hoyPY());
  const [duracion, setDuracion] = useState("");
  const [diaFact, setDiaFact] = useState("1");
  const [diaVenc, setDiaVenc] = useState("10");
  const [observacion, setObservacion] = useState("");
  const [emitirYa, setEmitirYa] = useState(false);
  const [confirmaDuplicado, setConfirmaDuplicado] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetchCache<Plan[]>("/api/planes?activos=1", { fresco: true })
      .then((p) => setPlanes(p.filter((x) => x.activo)))
      .catch((e) => { setPlanes([]); setError((e as Error).message); });
  }, []);

  const plan = useMemo(() => planes?.find((p) => p.id === planId) ?? null, [planes, planId]);
  const duplicado = !!plan && suscripciones.some((s) => s.estado === "activa" && s.plan === plan.nombre);

  function elegirPlan(id: string) {
    setPlanId(id);
    setConfirmaDuplicado(false);
    const p = planes?.find((x) => x.id === id);
    if (p) setPrecio(Number(p.precio));
  }

  function validar(): string | null {
    if (!plan) return "Elegí un plan";
    if (precio === "" || Number(precio) < 0) return "Indicá el precio";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) return "Indicá la fecha de inicio";
    const df = Number(diaFact), dv = Number(diaVenc);
    if (!Number.isInteger(df) || df < 1 || df > 28) return "El día de facturación va del 1 al 28";
    if (!Number.isInteger(dv) || dv < 1 || dv > 31) return "El día de vencimiento va del 1 al 31";
    if (dv < df) return "El día de vencimiento no puede ser antes del día de facturación";
    if (duracion.trim() && (!Number.isInteger(Number(duracion)) || Number(duracion) < 1)) return "La duración es de al menos 1 mes (o dejala vacía: sin fin)";
    return null;
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const v = validar();
    if (v) { setError(v); return; }
    if (duplicado && !confirmaDuplicado) { setConfirmaDuplicado(true); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ id: string }>("/api/suscripciones", {
        method: "POST",
        body: JSON.stringify({
          cliente_id: clienteId,
          plan_id: planId,
          precio: Number(precio),
          fecha_inicio: inicio,
          duracion_meses: duracion.trim() ? Number(duracion) : null,
          dia_facturacion: Number(diaFact),
          dia_vencimiento: Number(diaVenc),
          observacion: observacion.trim() || null,
        }),
      });
      let mensaje = `Suscripción ${plan!.nombre} creada`;
      if (emitirYa) {
        try {
          const c = await apiFetch<{ numero_control: string }>(`/api/suscripciones/${r.id}/emitir`, {
            method: "POST",
            body: JSON.stringify({ periodo: inicio.slice(0, 7) }),
          });
          mensaje += ` · cuota de ${nombreMes(inicio)} emitida (${c.numero_control})`;
        } catch (err) {
          mensaje += ` · la cuota no se emitió: ${(err as Error).message}`;
        }
      }
      onCreada(mensaje);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const sinPlanes = planes !== null && planes.length === 0;

  return (
    <Modal titulo="Nueva suscripción" onClose={() => { if (!busy) onClose(); }} size="lg">
      {planes === null ? (
        <div className="flex items-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando planes…</div>
      ) : sinPlanes ? (
        <div className="space-y-3 py-2">
          <p className="text-sm text-slate-600">Todavía no hay planes activos. Un plan es lo que cobrás todos los meses (cuota, abono, mantenimiento…).</p>
          {esAdmin ? (
            <Link href="/clientes/suscripciones?tab=planes" className="inline-flex rounded-xl px-3.5 py-2 text-sm font-semibold text-white" style={{ backgroundColor: TEAL }}>
              Crear un plan
            </Link>
          ) : (
            <p className="text-xs text-slate-500">Pedile a un administrador que cree los planes.</p>
          )}
        </div>
      ) : (
        <form onSubmit={guardar} className="space-y-4">
          <div>
            <span className={LABEL}>Plan</span>
            <Select block value={planId} onChange={elegirPlan}
              options={[["", "— Elegí un plan —"], ...planes.map((p) => [p.id, `${p.nombre} — ${monto(p.precio, p.moneda)}`] as [string, string])]} />
            {plan ? (
              <p className="mt-1 text-[11px] text-slate-500">
                {plan.moneda === "USD" ? "En dólares" : "En guaraníes"} · {IVA_LABEL[plan.tipo_iva] ?? plan.tipo_iva}
                {plan.descripcion ? ` · ${plan.descripcion}` : ""}
              </p>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className={LABEL}>Precio mensual {plan ? `(${plan.moneda === "USD" ? "US$" : "Gs."})` : ""}</span>
              <MontoInput value={precio} onChange={(n) => setPrecio(n)} decimals={plan?.moneda === "USD"} placeholder="0" className={`${INPUT} tabular-nums`} />
              {plan && Number(precio) !== Number(plan.precio) ? (
                <span className="mt-1 block text-[11px] text-amber-700">Precio especial (el plan sale {monto(plan.precio, plan.moneda)})</span>
              ) : null}
            </label>
            <label>
              <span className={LABEL}>Fecha de inicio</span>
              <input type="date" className={INPUT} value={inicio} onChange={(e) => setInicio(e.target.value)} required />
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <label>
              <span className={LABEL}>Duración (meses)</span>
              <input type="number" min={1} max={600} className={INPUT} value={duracion} onChange={(e) => setDuracion(e.target.value)} placeholder="Sin fin" />
            </label>
            <label>
              <span className={LABEL}>Día de facturación</span>
              <input type="number" min={1} max={28} className={INPUT} value={diaFact} onChange={(e) => setDiaFact(e.target.value)} />
            </label>
            <label>
              <span className={LABEL}>Día de vencimiento</span>
              <input type="number" min={1} max={31} className={INPUT} value={diaVenc} onChange={(e) => setDiaVenc(e.target.value)} />
            </label>
          </div>
          <p className="-mt-2 text-[11px] text-slate-500">
            Cada mes la cuota se emite con el botón "Emitir cuota" y vence el día {Number(diaVenc) || "—"} de ese mes. Duración vacía = sigue hasta que la canceles.
          </p>
          <label className="block">
            <span className={LABEL}>Observación (opcional)</span>
            <textarea rows={2} maxLength={500} className={INPUT} value={observacion} onChange={(e) => setObservacion(e.target.value)} placeholder="Ej: precio acordado por 6 meses" />
          </label>

          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--brand)]" checked={emitirYa} onChange={(e) => setEmitirYa(e.target.checked)} />
            <span className="text-sm text-slate-700">
              Emitir también la cuota de <strong>{nombreMes(inicio) || "este mes"}</strong>
              <span className="block text-[11px] text-slate-500">
                {emitirYa ? "Se genera la venta a crédito y queda en su cuenta a cobrar." : "Solo se crea la suscripción. No se genera ninguna cuota ahora."}
              </span>
            </span>
          </label>

          {duplicado ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Este cliente ya tiene una suscripción <strong>activa</strong> del plan "{plan?.nombre}".
              {confirmaDuplicado ? " Tocá de nuevo para agregar otra igual." : " ¿Querés agregar otra igual?"}
            </p>
          ) : null}
          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Cancelar
            </button>
            <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50" style={{ backgroundColor: TEAL }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? "Guardando…" : duplicado && confirmaDuplicado ? "Agregar igual" : "Crear suscripción"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
