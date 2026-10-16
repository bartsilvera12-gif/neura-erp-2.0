"use client";

/**
 * Alta / edición de una plantilla de gasto recurrente (alquiler, internet, sueldos…): proveedor,
 * con o sin comprobante, sucursal, condición y medio, moneda, día de vencimiento, vigencia y
 * líneas (monto 0 = "monto variable": se completa cuando llega la factura, ej. la luz).
 * Una plantilla NUNCA genera gastos sola: se usa "Generar gastos del mes".
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchCache } from "@/lib/api/cache-cliente";
import { hoyPY } from "@/lib/fecha/paraguay";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { Select } from "@/components/Select";
import MontoInput from "@/components/ui/MontoInput";
import { SelectorProveedor } from "@/modules/proveedores/SelectorProveedor";
import {
  MEDIOS_PAGO_GASTO, TIPOS_COMPROBANTE, URL_CATALOGOS, indiceCategorias, monto, nombreCuenta, usaCuentaBancaria,
  type Catalogos, type IvaTipo, type MedioPagoGasto, type Moneda, type Plantilla, type TipoPago,
} from "@/modules/gastos/tipos";

const INPUT = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 max-sm:py-2.5 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";
const LABEL = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500";

type Linea = { key: string; categoria_id: string | null; descripcion: string; monto: number; iva_tipo: IvaTipo; sucursal_id: string | null; empleado_id: string | null };
let seq = 0;
const linea = (): Linea => ({ key: `r${++seq}`, categoria_id: null, descripcion: "", monto: 0, iva_tipo: "10%", sucursal_id: null, empleado_id: null });

export function FormRecurrente({ plantilla, onClose, onGuardado }: { plantilla: Plantilla | null; onClose: () => void; onGuardado: () => void }) {
  const [cat, setCat] = useState<Catalogos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const p = plantilla;
  const [nombre, setNombre] = useState(p?.nombre ?? "");
  const [proveedor, setProveedor] = useState<string | null>(p?.proveedor_id ?? null);
  const [conComp, setConComp] = useState(p?.con_comprobante ?? true);
  const [tipoComp, setTipoComp] = useState(p?.tipo_comprobante ?? "Factura");
  const [sucursal, setSucursal] = useState(p?.sucursal_id ?? "");
  const [tipoPago, setTipoPago] = useState<TipoPago>(p?.tipo_pago ?? "contado");
  const [plazo, setPlazo] = useState(p?.plazo_dias != null ? String(p.plazo_dias) : "");
  const [medio, setMedio] = useState<MedioPagoGasto>(p?.medio_pago ?? "transferencia");
  const [cuenta, setCuenta] = useState(p?.cuenta_bancaria_id ?? "");
  const [moneda, setMoneda] = useState<Moneda>(p?.moneda ?? "GS");
  const [tc, setTc] = useState<number>(p?.moneda === "USD" ? Number(p.tipo_cambio) : 0);
  const [dia, setDia] = useState(String(p?.dia_vencimiento ?? 10));
  const [desde, setDesde] = useState((p?.vigente_desde ?? hoyPY()).slice(0, 7));
  const [hasta, setHasta] = useState(p?.vigente_hasta ? p.vigente_hasta.slice(0, 7) : "");
  const [descripcion, setDescripcion] = useState(p?.descripcion ?? "");
  const [activo, setActivo] = useState(p?.activo ?? true);
  const [items, setItems] = useState<Linea[]>(() => p?.items.length
    ? p.items.map((i) => ({ key: `r${++seq}`, categoria_id: i.categoria_id, descripcion: i.descripcion, monto: Number(i.monto), iva_tipo: i.iva_tipo, sucursal_id: i.sucursal_id, empleado_id: i.empleado_id }))
    : [linea()]);

  useEffect(() => {
    apiFetchCache<Catalogos>(URL_CATALOGOS).then((c) => {
      setCat(c);
      setSucursal((s) => s || c.mi_sucursal_id || c.sucursales[0]?.id || "");
    }).catch((e) => setError((e as Error).message));
  }, []);

  const indice = useMemo(() => indiceCategorias(cat?.rubros ?? []), [cat]);
  const opcionesCat = useMemo<[string, string][]>(() => [["", "(Elegir subcategoría)"],
    ...(cat?.rubros ?? []).flatMap((r) => r.subcategorias.map((s): [string, string] => [s.id, `${r.nombre} › ${s.nombre}`]))], [cat]);
  const usd = moneda === "USD";
  const total = items.reduce((a, i) => a + (Number(i.monto) || 0), 0);
  const setItem = (i: number, patch: Partial<Linea>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const cuentas = (cat?.cuentas_bancarias ?? []).filter((c) => c.activa);
  const empleados = (cat?.empleados ?? []).filter((e) => e.activo);
  const sucursales = cat?.sucursales ?? [];

  const faltante = !nombre.trim() ? "Escribí un nombre"
    : (conComp || tipoPago === "credito") && !proveedor ? "Elegí el proveedor"
    : usd && !(tc > 0) ? "Cargá el tipo de cambio de referencia"
    : !items.every((i) => i.categoria_id) ? "Cada línea necesita su subcategoría"
    : null;

  async function guardar() {
    if (busy || faltante) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/gastos/recurrentes", {
        method: "POST",
        body: JSON.stringify({
          id: p?.id ?? null, nombre: nombre.trim(), proveedor_id: proveedor, sucursal_id: sucursal || null, con_comprobante: conComp,
          tipo_comprobante: conComp ? tipoComp : null, tipo_pago: tipoPago, plazo_dias: tipoPago === "credito" && plazo ? Number(plazo) : null,
          medio_pago: tipoPago === "contado" ? medio : null, cuenta_bancaria_id: tipoPago === "contado" && usaCuentaBancaria(medio) ? cuenta || null : null,
          moneda, tipo_cambio: usd ? tc : null, dia_vencimiento: Number(dia) || 10, descripcion: descripcion.trim() || null, activo,
          vigente_desde: `${desde}-01`, vigente_hasta: hasta ? `${hasta}-01` : null,
          items: items.map((i) => ({
            categoria_id: i.categoria_id, descripcion: i.descripcion.trim(), monto: Number(i.monto) || 0, iva_tipo: conComp ? i.iva_tipo : "exenta",
            sucursal_id: i.sucursal_id || null, empleado_id: i.categoria_id && indice.get(i.categoria_id)?.es_personal ? i.empleado_id : null,
          })),
        }),
      });
      onGuardado();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <CapaModal onClose={busy ? undefined : onClose}>
      <div className={`flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${ALTO_MAX_MODAL}`} style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-800">{p ? "Editar plantilla" : "Nueva plantilla recurrente"}</h2>
            <p className="text-xs text-slate-500">Se usa con "Generar gastos del mes": crea un borrador por mes que revisás y confirmás.</p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Cerrar" className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
          {!cat ? <p className="py-10 text-center text-sm text-slate-400">Cargando…</p> : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
                <div className="sm:col-span-4"><label className={LABEL}>Nombre *</label>
                  <input autoFocus className={INPUT} maxLength={120} enterKeyHint="next" placeholder="Ej. Alquiler Casa central" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
                <div className="sm:col-span-2"><label className={LABEL}>Vence el día</label>
                  <input type="number" inputMode="numeric" enterKeyHint="next" min={1} max={31} className={INPUT} value={dia} onChange={(e) => setDia(e.target.value)} />
                  <p className="mt-0.5 text-[10px] text-slate-400">31 = último día del mes</p></div>
                <div className="sm:col-span-6">
                  <div className="flex rounded-xl bg-slate-100 p-1 sm:inline-flex" role="radiogroup" aria-label="Comprobante">
                    {([[true, "Con comprobante", " fiscal"], [false, "Sin comprobante", " (sueldos, viáticos…)"]] as const).map(([v, l, extra]) => (
                      <button key={l} type="button" role="radio" aria-checked={conComp === v} onClick={() => setConComp(v)}
                        className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold max-sm:min-h-11 ${conComp === v ? "bg-white text-[#3F8E91] shadow-sm" : "text-slate-500"}`}>{l}<span className="max-sm:hidden">{extra}</span></button>
                    ))}
                  </div>
                </div>
                <div className="sm:col-span-4"><label className={LABEL}>Proveedor{conComp || tipoPago === "credito" ? " *" : " (opcional)"}</label>
                  <SelectorProveedor value={proveedor} onChange={(id) => setProveedor(id)} /></div>
                {conComp ? <div className="sm:col-span-2"><label className={LABEL}>Comprobante</label>
                  <Select value={tipoComp} onChange={setTipoComp} block options={TIPOS_COMPROBANTE.map((t): [string, string] => [t, t])} /></div> : <div className="hidden sm:col-span-2 sm:block" />}
                <div className="sm:col-span-2"><label className={LABEL}>Sucursal</label>
                  <Select value={sucursal} onChange={setSucursal} block options={sucursales.map((s): [string, string] => [s.id, s.nombre])} /></div>
                <div className="sm:col-span-2"><label className={LABEL}>Condición</label>
                  <Select value={tipoPago} onChange={(v) => setTipoPago(v as TipoPago)} block options={[["contado", "Contado"], ["credito", "Crédito"]]} /></div>
                {tipoPago === "contado" ? (
                  <div className="sm:col-span-2"><label className={LABEL}>Medio</label>
                    <Select value={medio} onChange={(v) => setMedio(v as MedioPagoGasto)} block options={MEDIOS_PAGO_GASTO.filter((m) => !(usd && m.v === "efectivo")).map((m): [string, string] => [m.v, m.l])} /></div>
                ) : (
                  <div className="sm:col-span-2"><label className={LABEL}>Plazo (días)</label>
                    <input type="number" inputMode="numeric" enterKeyHint="next" min={0} className={INPUT} placeholder="0 = vence el día" value={plazo} onChange={(e) => setPlazo(e.target.value)} /></div>
                )}
                {tipoPago === "contado" && usaCuentaBancaria(medio) && cuentas.length ? (
                  <div className="sm:col-span-3"><label className={LABEL}>Cuenta de origen</label>
                    <Select value={cuenta} onChange={setCuenta} block options={[["", "(Elegir al confirmar)"], ...cuentas.map((c): [string, string] => [c.id, nombreCuenta(c)])]} /></div>
                ) : null}
                <div className="sm:col-span-3"><label className={LABEL}>Moneda</label>
                  <div className="flex gap-2">
                    <Select value={moneda} onChange={(v) => setMoneda(v as Moneda)} etiqueta="Moneda" options={[["GS", "Gs."], ["USD", "USD"]]} />
                    {usd ? <MontoInput value={tc || ""} onChange={setTc} placeholder="Tipo de cambio ref." aria-label="Tipo de cambio de referencia" className={`${INPUT} min-w-0 text-right`} /> : null}
                  </div></div>
                <div className="sm:col-span-3"><label className={LABEL}>Desde (mes)</label>
                  <input type="month" className={INPUT} value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
                <div className="sm:col-span-3"><label className={LABEL}>Hasta (opcional)</label>
                  <input type="month" className={INPUT} value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} /></div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Líneas</h3>
                  <button type="button" onClick={() => setItems((xs) => [...xs, linea()])} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-[#3F8E91] hover:bg-slate-50 max-sm:min-h-11 max-sm:px-3"><Plus className="h-3.5 w-3.5" /> Línea</button>
                </div>
                <div className="space-y-2">
                  {items.map((it, i) => {
                    const c = it.categoria_id ? indice.get(it.categoria_id) : undefined;
                    const quitar = () => setItems((xs) => xs.filter((_, j) => j !== i));
                    // Celular: tarjeta con "Línea N" + quitar (44 px) arriba; subcategoría y descripción a
                    // todo el ancho; monto e IVA lado a lado; empleado / sucursal a todo el ancho.
                    return (
                      <div key={it.key} className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 p-2.5 sm:grid-cols-12">
                        {items.length > 1 ? (
                          <div className="col-span-2 -mr-1 -mt-1 flex items-center justify-between sm:hidden">
                            <span className="pl-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Línea {i + 1}</span>
                            <button type="button" onClick={quitar} aria-label={`Quitar la línea ${i + 1}`}
                              className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 active:bg-rose-50 active:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                          </div>
                        ) : null}
                        <div className="col-span-2 sm:col-span-5"><Select value={it.categoria_id ?? ""} onChange={(v) => setItem(i, { categoria_id: v || null, descripcion: it.descripcion || indice.get(v)?.nombre || "" })} options={opcionesCat} block etiqueta="Subcategoría" /></div>
                        <div className="col-span-2 sm:col-span-4"><input className={INPUT} placeholder="Descripción" enterKeyHint="next" value={it.descripcion} onChange={(e) => setItem(i, { descripcion: e.target.value })} /></div>
                        <div className={conComp ? "min-w-0 sm:col-span-3" : "col-span-2 sm:col-span-3"}><MontoInput value={it.monto || ""} onChange={(n) => setItem(i, { monto: n })} decimals={usd} placeholder="0 = variable" enterKeyHint="done" aria-label={`Monto de la línea ${i + 1}`} className={`${INPUT} text-right tabular-nums`} /></div>
                        {conComp ? <div className="min-w-0 sm:col-span-2"><Select value={it.iva_tipo} onChange={(v) => setItem(i, { iva_tipo: v as IvaTipo })} block etiqueta="IVA de la línea" options={[["10%", "10 %"], ["5%", "5 %"], ["exenta", "Exenta"]]} /></div> : null}
                        {c?.es_personal ? <div className="col-span-2 sm:col-span-4"><Select value={it.empleado_id ?? ""} onChange={(v) => setItem(i, { empleado_id: v || null })} block etiqueta="Empleado"
                          options={[["", "(Empleado)"], ...empleados.map((e): [string, string] => [e.id, e.nombre])]} /></div> : null}
                        {sucursales.length > 1 ? <div className="col-span-2 sm:col-span-4"><Select value={it.sucursal_id ?? ""} onChange={(v) => setItem(i, { sucursal_id: v || null })} block etiqueta="Sucursal de la línea"
                          options={[["", "(Sucursal de la plantilla)"], ...sucursales.map((s): [string, string] => [s.id, s.nombre])]} /></div> : null}
                        <div className="hidden items-center justify-end sm:col-span-2 sm:ml-auto sm:flex">
                          {items.length > 1 ? <button type="button" onClick={quitar} aria-label="Eliminar línea" className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button type="button" onClick={() => setItems((xs) => [...xs, linea()])}
                  className="mt-2 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 text-sm font-semibold text-[#3F8E91] active:bg-[#4FAEB2]/5 sm:hidden">
                  <Plus className="h-4 w-4" /> Agregar otra línea
                </button>
                <p className="mt-2 text-right text-sm text-slate-600 max-sm:hidden">Total previsto: <b className="text-slate-900">{total > 0 ? monto(total, moneda) : "variable"}</b></p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><label className={LABEL}>Notas</label><input className={INPUT} maxLength={500} enterKeyHint="done" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej. contrato hasta dic. 2027" /></div>
                {p ? <label className="flex items-center gap-2 pt-5 text-sm text-slate-600 max-sm:min-h-11 max-sm:pt-0"><input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="accent-[#4FAEB2] max-sm:h-5 max-sm:w-5" /> Activa (aparece al generar)</label> : null}
              </div>
            </>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-4 py-3 sm:flex-nowrap sm:px-6 sm:py-4">
          {/* Celular: lo que falta y el total previsto arriba de los botones */}
          <div className="flex w-full min-w-0 items-baseline justify-between gap-3 sm:mr-auto sm:w-auto sm:flex-1">
            <span className="min-w-0 text-xs text-slate-400">{faltante ?? ""}</span>
            {cat ? <span className="shrink-0 text-sm text-slate-600 sm:hidden">Total <b className="tabular-nums text-slate-900">{total > 0 ? monto(total, moneda) : "variable"}</b></span> : null}
          </div>
          <button onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 max-sm:flex-1">Cancelar</button>
          <button onClick={() => void guardar()} disabled={busy || !!faltante || !cat}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50 max-sm:flex-[2]">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar plantilla
          </button>
        </div>
      </div>
    </CapaModal>
  );
}
