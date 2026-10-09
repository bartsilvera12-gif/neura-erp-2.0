"use client";

/**
 * Modales chicos de Gestión del Cliente:
 *  - ModalElegirSuscripcion: cuando el cliente tiene varias suscripciones, elegir sobre cuál
 *    actuar (Facturación, Cambio de plan); sin ninguna, "Sin suscripciones" con el atajo a la ficha.
 *  - ModalCambioVencimiento: nuevo día de vencimiento (≥ día de facturación) y, opcional,
 *    mover también la cuota de este mes si no tiene cobros.
 *  - ModalHistorial: la misma línea de tiempo que la pestaña Actividad de la ficha.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarClock, ChevronRight, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { TEAL } from "@/modules/clientes/ui";
import { TabActividad } from "@/modules/clientes/ficha/TabActividad";
import type { SuscripcionCliente } from "@/modules/clientes/suscripciones/tipos";
import { BadgeSuscripcion, mesActual, monto, nombreMes } from "@/modules/clientes/suscripciones/ui";

export function ModalElegirSuscripcion({ titulo, clienteId, suscripciones, onElegir, onClose }: {
  titulo: string;
  clienteId: string;
  suscripciones: SuscripcionCliente[];
  onElegir: (s: SuscripcionCliente) => void;
  onClose: () => void;
}) {
  return (
    <Modal titulo={titulo} onClose={onClose} size="lg">
      {suscripciones.length === 0 ? (
        <div className="space-y-3 py-4 text-center">
          <p className="text-sm font-semibold text-slate-700">Sin suscripciones</p>
          <p className="text-xs text-slate-500">Este cliente no tiene suscripciones. Se crean desde su ficha.</p>
          <Link href={`/clientes/${clienteId}`}
            className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95"
            style={{ backgroundColor: TEAL }}>
            Nueva suscripción
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">Este cliente tiene más de una suscripción. Elegí sobre cuál trabajar.</p>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
            {suscripciones.map((s) => (
              <li key={s.suscripcion_id}>
                <button type="button" onClick={() => onElegir(s)}
                  className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{s.plan}</p>
                    <p className="text-xs text-slate-500">
                      {monto(s.precio, s.moneda)} · factura el día {s.dia_facturacion} · vence el día {s.dia_vencimiento}
                    </p>
                  </div>
                  <BadgeSuscripcion estado={s.estado} />
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

export function ModalCambioVencimiento({ suscripciones, onClose, onHecho }: {
  /** suscripciones no canceladas del cliente (al menos una) */
  suscripciones: SuscripcionCliente[];
  onClose: () => void;
  onHecho: (mensaje: string) => void;
}) {
  const [subId, setSubId] = useState(suscripciones[0]?.suscripcion_id ?? "");
  const s = useMemo(() => suscripciones.find((x) => x.suscripcion_id === subId) ?? null, [suscripciones, subId]);
  const [dia, setDia] = useState<string>(String(suscripciones[0]?.dia_vencimiento ?? ""));
  const [moverCuota, setMoverCuota] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actual = mesActual();
  const cuotaMes = s?.meses.find((m) => m.periodo.slice(0, 7) === actual) ?? null;
  const emitida = !!cuotaMes?.venta_id;
  const conCobros = emitida && (cuotaMes!.estado === "pagada" || (cuotaMes!.saldo != null && Number(cuotaMes!.saldo) < Number(cuotaMes!.monto)));
  const bloqueoMover = !emitida
    ? `La cuota de ${nombreMes(actual)} todavía no se emitió: cuando se emita ya sale con el día nuevo.`
    : conCobros ? `La cuota ${cuotaMes!.numero} ya tiene cobros: queda con su vencimiento.` : null;

  const diaNum = Number(dia);
  const diaValido = Number.isInteger(diaNum) && diaNum >= 1 && diaNum <= 31;
  const antesDeFacturar = !!s && diaValido && diaNum < s.dia_facturacion;

  function elegirSub(id: string) {
    setSubId(id);
    const x = suscripciones.find((y) => y.suscripcion_id === id);
    if (x) setDia(String(x.dia_vencimiento));
    setMoverCuota(false);
    setError(null);
  }

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    if (!s) { setError("Elegí la suscripción"); return; }
    if (!diaValido) { setError("El día de vencimiento va de 1 a 31"); return; }
    if (antesDeFacturar) { setError(`El vencimiento no puede ser antes del día de facturación (${s.dia_facturacion})`); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ ok: boolean; cuota_movida: boolean }>(`/api/suscripciones/${s.suscripcion_id}/vencimiento`, {
        method: "POST",
        body: JSON.stringify({ dia: diaNum, mover_cuota_mes: moverCuota && !bloqueoMover }),
      });
      onHecho(`Vencimiento de ${s.plan}: ahora vence el día ${diaNum}${r?.cuota_movida ? ` (también la cuota de ${nombreMes(actual)})` : ""}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal titulo="Cambio de fecha de vencimiento" onClose={() => { if (!busy) onClose(); }} size="lg">
      <form onSubmit={confirmar} className="space-y-4">
        {suscripciones.length > 1 ? (
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-600">Suscripción</span>
            <Select block value={subId} onChange={elegirSub}
              options={suscripciones.map((x) => [x.suscripcion_id, `${x.plan} — ${monto(x.precio, x.moneda)}`] as [string, string])} />
          </div>
        ) : null}

        {s ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-sm text-slate-800">
            <p><span className="font-medium text-slate-500">Suscripción:</span> {s.plan} — {monto(s.precio, s.moneda)}</p>
            <p className="mt-1 text-xs text-slate-500">
              Factura el día <strong className="text-slate-700">{s.dia_facturacion}</strong> · hoy vence el día <strong className="text-slate-700">{s.dia_vencimiento}</strong>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Cuota de {nombreMes(actual)}: {emitida ? `emitida ${cuotaMes!.numero}${conCobros ? " (con cobros)" : ""}` : "todavía no emitida"}
            </p>
          </div>
        ) : null}

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Nuevo día de vencimiento</span>
          <input type="number" min={s?.dia_facturacion ?? 1} max={31} step={1} value={dia} onChange={(e) => setDia(e.target.value)}
            className={`w-32 rounded-xl border px-3 py-2.5 text-sm tabular-nums outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)] ${antesDeFacturar || (dia !== "" && !diaValido) ? "border-rose-300 bg-rose-50" : "border-slate-200"}`} />
          <span className="mt-1 block text-[11px] text-slate-400">
            Del {s?.dia_facturacion ?? 1} al 31 (no puede ser antes del día de facturación). En meses más cortos vence el último día.
          </span>
        </label>

        <label className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm ${bloqueoMover ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-400" : "cursor-pointer border-slate-200 hover:bg-slate-50"}`}>
          <input type="checkbox" className="mt-0.5 accent-[var(--brand)]" checked={moverCuota && !bloqueoMover} disabled={!!bloqueoMover}
            onChange={(e) => setMoverCuota(e.target.checked)} />
          <span>
            <span className={`block font-semibold ${bloqueoMover ? "" : "text-slate-800"}`}>Mover también la cuota de este mes (si no tiene cobros)</span>
            <span className="block text-xs">{bloqueoMover ?? `La cuota ${cuotaMes?.numero ?? ""} pasa a vencer el día nuevo de ${nombreMes(actual)}.`}</span>
          </span>
        </label>

        <p className="flex items-start gap-1.5 text-xs text-slate-500">
          <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> El día nuevo rige para las cuotas que se emitan desde ahora. Queda en el historial del cliente.
        </p>

        {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
          <button type="submit" disabled={busy || !s || !diaValido || antesDeFacturar}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50" style={{ backgroundColor: TEAL }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? "Guardando…" : "Cambiar vencimiento"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ModalHistorial({ clienteId, clienteNombre, onClose }: { clienteId: string; clienteNombre: string; onClose: () => void }) {
  return (
    <Modal titulo={`Historial del cliente · ${clienteNombre}`} onClose={onClose} size="xl">
      <div className="max-h-[70vh] overflow-y-auto pr-1">
        <TabActividad clienteId={clienteId} recarga={0} />
      </div>
    </Modal>
  );
}
