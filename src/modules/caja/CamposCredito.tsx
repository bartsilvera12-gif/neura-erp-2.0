"use client";

import { Select } from "@/components/Select";
import { MAX_CUOTAS, OPCIONES_CADA, fechaCorta, planCuotas, type CadaCuota } from "@/modules/caja/cuotas";

const ADJ_CADA: Record<CadaCuota, string> = { mes: "cada mes", quincena: "cada 15 días", semana: "cada 7 días" };

/**
 * Receta 98: crédito en cuotas. Cuotas (1 = un solo vencimiento) · en cuántos días vence la 1ª ·
 * cada cuánto (mensual / quincenal / semanal) y debajo el plan: montos y vencimientos.
 * Con `propuesta` (presupuestos, receta 106) no hay fechas todavía: se cuentan desde la venta.
 * Con `monto` null no se muestra el valor de la cuota (presupuestos en dólares).
 */
export function CamposCredito({ total, cuotas, setCuotas, plazoDias, setPlazoDias, cada, setCada, monto, propuesta = false }: {
  total: number;
  cuotas: string; setCuotas: (v: string) => void;
  plazoDias: string; setPlazoDias: (v: string) => void;
  cada: CadaCuota; setCada: (v: CadaCuota) => void;
  monto: ((v: number) => string) | null;
  propuesta?: boolean;
}) {
  const n = parseInt(cuotas) || 0;
  const dias = parseInt(plazoDias) || 0;
  const nOk = n >= 1 && n <= MAX_CUOTAS;
  const plan = nOk && dias >= 1 ? planCuotas(total, n, dias, cada) : null;
  const campo = (mal: boolean) =>
    `h-9 w-full rounded-lg border px-2.5 text-sm tabular-nums outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-100)] [@media(pointer:coarse)]:h-11 ${mal ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white"}`;
  const etq = "mb-0.5 block text-[11px] font-medium text-slate-500";
  const ultima = plan?.[plan.length - 1];
  const hayMonto = !!monto && total > 0;
  return (
    <div className="mt-2 space-y-1.5">
      <div className={`grid gap-2 ${n > 1 ? "grid-cols-[4rem_1fr_1.25fr]" : "grid-cols-[4rem_1fr]"}`}>
        <label className="min-w-0">
          <span className={etq}>Cuotas</span>
          <input type="number" inputMode="numeric" pattern="[0-9]*" enterKeyHint="next" min={1} max={MAX_CUOTAS} value={cuotas}
            onChange={(e) => setCuotas(e.target.value.replace(/\D/g, "").slice(0, 2))} className={campo(!nOk)} />
        </label>
        <label className="min-w-0">
          <span className={etq}>{n > 1 ? "1ª vence en" : "Vence en"}</span>
          <span className="relative block">
            <input type="number" inputMode="numeric" pattern="[0-9]*" enterKeyHint="done" min={1} value={plazoDias}
              onChange={(e) => setPlazoDias(e.target.value.replace(/\D/g, "").slice(0, 4))} className={`${campo(dias < 1)} pr-10`} />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">días</span>
          </span>
        </label>
        {n > 1 ? (
          // div y no label: un <label> le repite el click al botón del Select (abre y cierra).
          <div className="min-w-0">
            <span className={etq}>Cada</span>
            <Select chico block value={cada} onChange={(v) => setCada(v as CadaCuota)} options={OPCIONES_CADA} etiqueta="Cada cuánto se paga" />
          </div>
        ) : null}
      </div>
      <p className="text-[11px] leading-snug text-slate-500">
        {!nOk ? `Las cuotas van de 1 a ${MAX_CUOTAS}.`
          : !plan ? "Cargá en cuántos días vence."
          : propuesta ? (
            plan.length === 1 ? <>Un solo pago, a <strong className="font-semibold text-slate-700">{dias} {dias === 1 ? "día" : "días"}</strong> de la venta.</> : (
              <>
                <strong className="font-semibold text-slate-700">{plan.length} cuotas{hayMonto ? ` de ${monto!(plan[0].monto)}` : ""}</strong>
                {hayMonto && ultima && ultima.monto !== plan[0].monto ? ` (la última ${monto!(ultima.monto)})` : ""}
                {" "}· la 1ª a {dias} {dias === 1 ? "día" : "días"} de la venta, después {ADJ_CADA[cada]}
              </>
            )
          )
          : plan.length === 1 ? <>Un solo pago: vence el <strong className="font-semibold text-slate-700">{fechaCorta(plan[0].vence)}</strong>.</>
          : (
            <>
              <strong className="font-semibold text-slate-700">{plan.length} cuotas{hayMonto ? ` de ${monto!(plan[0].monto)}` : ""}</strong>
              {hayMonto && ultima && ultima.monto !== plan[0].monto ? ` (la última ${monto!(ultima.monto)})` : ""}
              {" "}· del {fechaCorta(plan[0].vence)} al {fechaCorta(ultima!.vence)}
            </>
          )}
      </p>
    </div>
  );
}
