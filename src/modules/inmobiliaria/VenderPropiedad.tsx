"use client";

/**
 * Vender una propiedad (receta 131): comprador, contado o en cuotas (con un plan de la empresa o a
 * mano), entrega inicial y cómo la paga, y el documento. Se cobra en la caja abierta del usuario:
 * la venta, la entrega y la propiedad "vendida" quedan en un solo paso.
 */
import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, X } from "lucide-react";
import { Drawer } from "@/components/Drawer";
import { Select } from "@/components/Select";
import { apiFetch } from "@/lib/api/client-fetch";
import { BuscadorCliente } from "@/modules/clientes/gestion/BuscadorCliente";
import { OPCIONES_CADA, fechaCorta, planCuotas, type CadaCuota } from "@/modules/caja/cuotas";
import { usePlanesCuota } from "@/modules/caja/usePlanesCuota";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT } from "@/modules/inventario/ui";
import type { Propiedad } from "@/modules/inmobiliaria/tipos";

const gs = (n: number) => `Gs. ${Math.round(n || 0).toLocaleString("es-PY")}`;
const MEDIOS: [string, string][] = [["efectivo", "Efectivo"], ["transferencia", "Transferencia"], ["tarjeta", "Tarjeta"], ["cheque", "Cheque"]];

type Resultado = { numero_control: string; total?: number; entrega?: number; cuotas_detalle?: { cuota: number; vencimiento: string; monto: number }[] };

export function VenderPropiedad({ propiedad, onCerrar, onVendida }: { propiedad: Propiedad; onCerrar: () => void; onVendida: () => void }) {
  const total = Number(propiedad.precio_venta) || 0;
  const { max_cuotas, planes } = usePlanesCuota();
  const activos = planes.filter((p) => p.activo);
  const [cliente, setCliente] = useState<{ id: string; nombre: string } | null>(null);
  const [contado, setContado] = useState(false);
  const [planId, setPlanId] = useState("");
  const [cuotas, setCuotas] = useState("120");
  const [cada, setCada] = useState<CadaCuota>("mes");
  const [plazo, setPlazo] = useState("30");
  const [entrega, setEntrega] = useState(0);
  const [medio, setMedio] = useState("transferencia");
  const [referencia, setReferencia] = useState("");
  const [documento, setDocumento] = useState<"ticket" | "factura">("ticket");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<Resultado | null>(null);
  const [clave] = useState(() => `prop-${propiedad.id}-${Date.now()}`);

  const plan = activos.find((p) => p.id === planId) ?? null;
  const n = plan ? plan.cuotas : parseInt(cuotas) || 0;
  const cadaReal = plan ? plan.cada : cada;
  const dias = plan ? plan.primera_dias : parseInt(plazo) || 0;
  const entregaMin = plan ? Math.round(total * Number(plan.entrega_pct) / 100) : 0;
  const financiado = Math.max(total - entrega, 0);
  const cronograma = useMemo(() => (!contado && n >= 1 && dias >= 1 ? planCuotas(financiado, n, dias, cadaReal) : []), [contado, n, dias, cadaReal, financiado]);

  const falta = !cliente ? "Elegí el comprador."
    : total <= 0 ? "La propiedad no tiene precio de venta."
    : contado ? null
    : n < 1 || n > max_cuotas ? `Las cuotas van de 1 a ${max_cuotas}.`
    : dias < 1 ? "Poné en cuántos días vence la primera cuota."
    : entrega >= total ? "La entrega tiene que ser menor que el precio."
    : entrega < entregaMin ? `El plan pide una entrega de al menos ${gs(entregaMin)}.`
    : null;

  async function vender() {
    if (falta || !cliente) return;
    setEnviando(true);
    setError(null);
    try {
      const pagoMonto = contado ? total : entrega;
      const r = await apiFetch<Resultado>(`/api/inmobiliaria/propiedades/${propiedad.id}/vender`, {
        method: "POST",
        body: JSON.stringify({
          cliente_id: cliente.id, contado, tipo_documento: documento, idempotency_key: clave,
          pagos: pagoMonto > 0 ? [{ metodo_pago: medio, monto: pagoMonto, referencia: referencia.trim() || null }] : [],
          ...(contado ? {} : { plan_id: plan?.id ?? null, cuotas: plan ? null : n, cuotas_cada: plan ? null : cada, plazo_dias: plan ? null : dias, entrega }),
        }),
      });
      setHecho(r);
      onVendida();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  if (hecho) {
    return (
      <Drawer titulo="Propiedad vendida" subtitulo={propiedad.titulo} onClose={onCerrar}
        footer={<button type="button" onClick={onCerrar} className={`${BOTON_PRIMARIO} bg-[var(--brand)] max-sm:min-h-11 max-sm:w-full`}>Listo</button>}>
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Venta {hecho.numero_control}</p>
              <p>{contado ? `Contado, ${gs(total)}.` : `${n} cuotas${entrega ? ` y entrega de ${gs(entrega)} ya cobrada` : ""}. Las cuotas quedaron en Cuentas a cobrar.`}</p>
            </div>
          </div>
          {hecho.cuotas_detalle?.length ? (
            <div className="rounded-xl border border-slate-200">
              <p className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-500">Cronograma</p>
              <ul className="m-0 max-h-72 list-none divide-y divide-slate-100 overflow-y-auto p-0 text-sm">
                {hecho.cuotas_detalle.map((c) => (
                  <li key={c.cuota} className="flex justify-between gap-3 px-3 py-2">
                    <span className="text-slate-600">{c.cuota === 0 ? "Entrega" : `Cuota ${c.cuota}`} · {fechaCorta(new Date(`${c.vencimiento}T12:00:00`))}</span>
                    <span className="font-medium tabular-nums text-slate-900">{gs(Number(c.monto))}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </Drawer>
    );
  }

  const pagaAhora = contado ? total : entrega;
  return (
    <Drawer
      titulo="Vender la propiedad"
      subtitulo={`${propiedad.codigo} · ${propiedad.titulo} · ${gs(total)}`}
      onClose={onCerrar}
      footer={
        <div className="flex w-full gap-2 sm:justify-end max-sm:[&>*]:min-h-11 max-sm:[&>*]:flex-1">
          <button type="button" onClick={onCerrar} disabled={enviando} className={BOTON_SECUNDARIO}>Cancelar</button>
          <button type="button" onClick={() => void vender()} disabled={enviando || !!falta} className={`${BOTON_PRIMARIO} bg-[var(--brand)]`}>
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Vender
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

        <div>
          <span className={ET}>Comprador</span>
          {cliente ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
              <span className="min-w-0 truncate font-medium text-slate-800">{cliente.nombre}</span>
              <button type="button" aria-label="Cambiar comprador" onClick={() => setCliente(null)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-600"><X className="h-4 w-4" /></button>
            </div>
          ) : <BuscadorCliente variant="toolbar" onSelect={(c) => setCliente({ id: c.id, nombre: c.nombre })} />}
        </div>

        <div role="radiogroup" aria-label="Forma de venta" className="grid grid-cols-2 gap-2">
          {[[false, "En cuotas"], [true, "Contado"]].map(([v, l]) => (
            <button key={String(v)} type="button" role="radio" aria-checked={contado === v} onClick={() => setContado(v as boolean)}
              className={`min-h-11 rounded-xl border px-3 text-sm font-medium transition ${contado === v ? "border-[var(--brand)] bg-[var(--brand-50,#eef7f7)] text-slate-900 ring-2 ring-[var(--brand-100)]" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
              {l as string}
            </button>
          ))}
        </div>

        {!contado ? (
          <div className="space-y-3">
            {activos.length ? (
              <div>
                <span className={ET}>Plan</span>
                <Select block value={planId} onChange={(v) => { setPlanId(v); const p = activos.find((x) => x.id === v); if (p) setEntrega(Math.max(entrega, Math.round(total * Number(p.entrega_pct) / 100))); }}
                  options={[["", "Sin plan (cuotas a mano)"], ...activos.map((p) => [p.id, p.nombre] as [string, string])]} etiqueta="Plan de cuotas" />
              </div>
            ) : null}
            {!plan ? (
              <div className="grid grid-cols-3 gap-2">
                <label className="block min-w-0"><span className={ET}>Cuotas</span>
                  <input inputMode="numeric" className={`${INPUT} text-right tabular-nums`} value={cuotas} onChange={(e) => setCuotas(e.target.value.replace(/\D/g, "").slice(0, 3))} /></label>
                <div className="min-w-0"><span className={ET}>Cada</span>
                  <Select block value={cada} onChange={(v) => setCada(v as CadaCuota)} options={OPCIONES_CADA} etiqueta="Cada cuánto se paga" /></div>
                <label className="block min-w-0"><span className={ET}>1ª a (días)</span>
                  <input inputMode="numeric" className={`${INPUT} text-right tabular-nums`} value={plazo} onChange={(e) => setPlazo(e.target.value.replace(/\D/g, "").slice(0, 4))} /></label>
              </div>
            ) : (
              <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">{plan.cuotas} cuotas {OPCIONES_CADA.find(([k]) => k === plan.cada)?.[1].toLowerCase()}, la 1ª a {plan.primera_dias} días{Number(plan.entrega_pct) ? ` · entrega mínima ${Number(plan.entrega_pct)} % (${gs(entregaMin)})` : ""}.</p>
            )}
            <label className="block">
              <span className={ET}>Entrega inicial</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">Gs.</span>
                <input inputMode="numeric" className={`${INPUT} pl-10 text-right tabular-nums`} value={entrega ? entrega.toLocaleString("es-PY") : ""} placeholder="0"
                  onChange={(e) => setEntrega(Number(e.target.value.replace(/\D/g, "")) || 0)} />
              </div>
            </label>
            {cronograma.length ? (
              <p className="text-xs leading-relaxed text-slate-600">
                Financiado <strong className="text-slate-800">{gs(financiado)}</strong> en <strong className="text-slate-800">{cronograma.length} cuotas de {gs(cronograma[0].monto)}</strong>
                {cronograma[cronograma.length - 1].monto !== cronograma[0].monto ? ` (la última ${gs(cronograma[cronograma.length - 1].monto)})` : ""}, del {fechaCorta(cronograma[0].vence)} al {fechaCorta(cronograma[cronograma.length - 1].vence)}.
              </p>
            ) : null}
          </div>
        ) : null}

        {pagaAhora > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0"><span className={ET}>{contado ? "Cómo paga" : "Cómo paga la entrega"} ({gs(pagaAhora)})</span>
              <Select block value={medio} onChange={setMedio} options={MEDIOS} etiqueta="Medio de pago" /></div>
            <label className="block min-w-0"><span className={ET}>Referencia</span>
              <input className={INPUT} value={referencia} maxLength={120} placeholder="Nº de transferencia o cheque" onChange={(e) => setReferencia(e.target.value)} /></label>
          </div>
        ) : null}

        <div className="max-w-xs"><span className={ET}>Documento</span>
          <Select block value={documento} onChange={(v) => setDocumento(v as "ticket" | "factura")} options={[["ticket", "Ticket"], ["factura", "Factura (el comprador necesita RUC)"]]} etiqueta="Documento" /></div>

        {falta ? <p className="text-xs text-slate-500">{falta}</p> : null}
        <p className="text-xs text-slate-400">Se cobra en tu caja abierta. Si la venta se anula, la propiedad vuelve a estar disponible.</p>
      </div>
    </Drawer>
  );
}
