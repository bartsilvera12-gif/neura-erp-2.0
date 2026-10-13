"use client";

/**
 * Alta / edición de un gasto o servicio (modal, igual que el sistema actual):
 * proveedor y datos fiscales del comprobante (tipo, número 001-001-0000001, timbrado, fecha),
 * condición contado (medio de pago; el efectivo sale de la caja abierta) o crédito (plazo y
 * vencimiento: nace la deuda en Compras › Pagos a proveedores), líneas con categoría,
 * descripción, monto IVA INCLUIDO y tipo de IVA (10 % / 5 % / exenta), y el comprobante
 * adjunto (foto o PDF). "Guardar borrador" o "Confirmar" (número GS-000001). La clave de
 * idempotencia evita que un doble clic cree dos documentos.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Paperclip, Plus, Trash2, X } from "lucide-react";
import { apiFetch, apiForm } from "@/lib/api/client-fetch";
import { apiFetchCache, invalidar } from "@/lib/api/cache-cliente";
import { hoyPY } from "@/lib/fecha/paraguay";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { Select } from "@/components/Select";
import MontoInput from "@/components/ui/MontoInput";
import { cargarProveedores } from "@/modules/proveedores/cache";
import { nombreProveedor, type ProveedorMin } from "@/modules/proveedores/tipos";
import { ACCEPT_COMPROBANTE, validarComprobante } from "@/modules/compras/Comprobantes";
import {
  MEDIOS_PAGO_GASTO, TIPOS_COMPROBANTE, formatComprobante, gs, ivaDe, requiereTimbrado,
  type CategoriaGasto, type DetalleGasto, type IvaTipo, type ItemGasto, type MedioPagoGasto, type TipoPago,
} from "@/modules/gastos/tipos";

const INPUT = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";
const LABEL = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500";
const URL_CATEGORIAS = "/api/gastos/categorias";

type Form = {
  proveedor_id: string;
  tipo_comprobante: string;
  numero_comprobante: string;
  timbrado: string;
  fecha_comprobante: string;
  tipo_pago: TipoPago;
  plazo_dias: string;
  fecha_vencimiento: string;
  medio_pago: MedioPagoGasto | "";
  referencia_pago: string;
  descripcion: string;
  observacion: string;
  items: ItemGasto[];
};

export type GastoHecho = { id: string; numero: string | null; confirmado: boolean; total: number; credito: boolean; caja: boolean; avisoAdjunto: string | null };

const lineaVacia = (): ItemGasto => ({ categoria_id: null, descripcion: "", monto: 0, iva_tipo: "10%" });
const sumarDias = (ymd: string, dias: number) => {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
};

export function FormGasto({ gastoId, onClose, onHecho }: {
  /** Borrador a editar (abrir y confirmar); sin id es un alta. */
  gastoId?: string | null;
  onClose: () => void;
  onHecho: () => void;
}) {
  const [form, setForm] = useState<Form>({
    proveedor_id: "", tipo_comprobante: "Factura", numero_comprobante: "", timbrado: "", fecha_comprobante: hoyPY(),
    tipo_pago: "contado", plazo_dias: "", fecha_vencimiento: "", medio_pago: "", referencia_pago: "", descripcion: "", observacion: "",
    items: [lineaVacia()],
  });
  const [proveedores, setProveedores] = useState<ProveedorMin[]>([]);
  const [categorias, setCategorias] = useState<CategoriaGasto[]>([]);
  const [cargando, setCargando] = useState(!!gastoId);
  const [busy, setBusy] = useState<"" | "borrador" | "confirmar">("");
  const [error, setError] = useState<string | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [adjuntoActual, setAdjuntoActual] = useState<string | null>(null);
  const [hecho, setHecho] = useState<GastoHecho | null>(null);
  const [nuevaCat, setNuevaCat] = useState<{ fila: number; nombre: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [idem] = useState(() => crypto.randomUUID());

  useEffect(() => {
    void cargarProveedores().then((p) => setProveedores(p.filter((x) => x.activo !== false)));
    apiFetchCache<{ categorias: CategoriaGasto[] }>(URL_CATEGORIAS).then((r) => setCategorias(r.categorias)).catch(() => setCategorias([]));
  }, []);

  useEffect(() => {
    if (!gastoId) return;
    apiFetch<DetalleGasto>(`/api/gastos/${gastoId}`)
      .then(({ gasto: g, items }) => {
        setForm({
          proveedor_id: g.proveedor_id ?? "",
          tipo_comprobante: g.tipo_comprobante ?? "Factura",
          numero_comprobante: g.numero_comprobante ?? "",
          timbrado: g.timbrado ?? "",
          fecha_comprobante: g.fecha_comprobante ?? hoyPY(),
          tipo_pago: g.tipo_pago ?? "contado",
          plazo_dias: g.plazo_dias != null ? String(g.plazo_dias) : "",
          fecha_vencimiento: g.fecha_vencimiento ?? "",
          medio_pago: g.medio_pago ?? "",
          referencia_pago: g.referencia_pago ?? "",
          descripcion: g.descripcion ?? "",
          observacion: g.observacion ?? "",
          items: items.length ? items.map((i) => ({ categoria_id: i.categoria_id, descripcion: i.descripcion, monto: Number(i.monto), iva_tipo: i.iva_tipo })) : [lineaVacia()],
        });
        setAdjuntoActual(g.tiene_comprobante ? g.comprobante_nombre ?? "comprobante" : null);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setCargando(false));
  }, [gastoId]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setItem = (i: number, patch: Partial<ItemGasto>) => setForm((f) => ({ ...f, items: f.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));

  function elegirProveedor(id: string) {
    const p = proveedores.find((x) => x.id === id);
    setForm((f) => {
      const n = { ...f, proveedor_id: id };
      // La condición habitual del proveedor como punto de partida (se puede cambiar).
      if (p?.condicion_pago === "credito") {
        n.tipo_pago = "credito";
        if (!f.plazo_dias && p.plazo_pago_dias) n.plazo_dias = String(p.plazo_pago_dias);
      }
      return n;
    });
  }

  // Vencimiento sugerido: fecha del comprobante + plazo.
  const vencSugerido = form.tipo_pago === "credito" && form.fecha_comprobante ? sumarDias(form.fecha_comprobante, Number(form.plazo_dias) || 30) : "";

  function elegirCategoria(i: number, id: string) {
    if (id === "__nueva__") { setNuevaCat({ fila: i, nombre: "" }); return; }
    const c = categorias.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      items: f.items.map((it, j) => (j === i ? { ...it, categoria_id: id || null, descripcion: it.descripcion.trim() ? it.descripcion : c?.nombre ?? "" } : it)),
    }));
  }

  async function crearCategoria() {
    if (!nuevaCat || nuevaCat.nombre.trim().length < 2) return;
    try {
      const c = await apiFetch<CategoriaGasto>(URL_CATEGORIAS, { method: "POST", body: JSON.stringify({ nombre: nuevaCat.nombre.trim() }) });
      invalidar(URL_CATEGORIAS);
      setCategorias((cs) => (cs.some((x) => x.id === c.id) ? cs : [...cs, c]));
      const fila = nuevaCat.fila;
      setNuevaCat(null);
      setForm((f) => ({ ...f, items: f.items.map((it, j) => (j === fila ? { ...it, categoria_id: c.id, descripcion: it.descripcion.trim() ? it.descripcion : c.nombre } : it)) }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const totales = useMemo(() => {
    let t10 = 0, i10 = 0, t5 = 0, i5 = 0, ex = 0;
    for (const it of form.items) {
      const m = Math.round(Number(it.monto) || 0);
      if (it.iva_tipo === "10%") { t10 += m; i10 += ivaDe(m, "10%"); } else if (it.iva_tipo === "5%") { t5 += m; i5 += ivaDe(m, "5%"); } else ex += m;
    }
    const total = t10 + t5 + ex;
    return { t10, i10, t5, i5, ex, iva: i10 + i5, sub: total - i10 - i5, total };
  }, [form.items]);

  // Mismos requisitos que valida la base para confirmar.
  const faltante = useMemo(() => {
    if (!form.proveedor_id) return "Elegí el proveedor";
    if (!form.tipo_comprobante) return "Elegí el tipo de comprobante";
    if (!form.numero_comprobante.trim()) return "Cargá el número de comprobante";
    if (requiereTimbrado(form.tipo_comprobante) && !form.timbrado.trim()) return "Cargá el timbrado";
    if (!form.fecha_comprobante) return "Cargá la fecha del comprobante";
    if (form.tipo_pago === "contado" && !form.medio_pago) return "Elegí el medio de pago";
    if (form.items.length === 0) return "Cargá al menos una línea";
    if (!form.items.every((it) => it.categoria_id && it.descripcion.trim() && Number(it.monto) > 0)) return "Cada línea necesita categoría, descripción y monto";
    return null;
  }, [form]);

  function cuerpo(confirmar: boolean) {
    const credito = form.tipo_pago === "credito";
    return {
      confirmar,
      id: gastoId ?? null,
      idempotency_key: gastoId ? null : idem,
      proveedor_id: form.proveedor_id || null,
      tipo_comprobante: form.tipo_comprobante || null,
      numero_comprobante: form.numero_comprobante.trim() || null,
      timbrado: form.timbrado.trim() || null,
      fecha_comprobante: form.fecha_comprobante || null,
      tipo_pago: form.tipo_pago,
      plazo_dias: credito && form.plazo_dias ? Number(form.plazo_dias) : null,
      fecha_vencimiento: credito ? form.fecha_vencimiento || vencSugerido || null : null,
      medio_pago: !credito && form.medio_pago ? form.medio_pago : null,
      referencia_pago: !credito ? form.referencia_pago.trim() || null : null,
      descripcion: form.descripcion.trim() || null,
      observacion: form.observacion.trim() || null,
      items: form.items.map((it) => ({ categoria_id: it.categoria_id, descripcion: it.descripcion.trim(), monto: Math.round(Number(it.monto) || 0), iva_tipo: it.iva_tipo })),
    };
  }

  async function guardar(confirmar: boolean) {
    if (busy) return; // evita doble clic
    if (archivo) {
      const err = validarComprobante(archivo);
      if (err) { setError(err); return; }
    }
    setBusy(confirmar ? "confirmar" : "borrador");
    setError(null);
    try {
      const r = await apiFetch<{ id: string; numero?: string; total?: number; cxp_id?: string | null; caja_id?: string | null }>("/api/gastos", {
        method: "POST",
        body: JSON.stringify(cuerpo(confirmar)),
      });
      let avisoAdjunto: string | null = null;
      if (archivo) {
        try {
          const fd = new FormData();
          fd.append("file", archivo);
          await apiForm(`/api/gastos/${r.id}/comprobante`, fd);
        } catch (e) {
          avisoAdjunto = `El gasto se guardó, pero el comprobante no se pudo adjuntar: ${(e as Error).message}`;
        }
      }
      setHecho({
        id: r.id, numero: r.numero ?? null, confirmado: confirmar, total: Number(r.total) || totales.total,
        credito: !!r.cxp_id, caja: !!r.caja_id, avisoAdjunto,
      });
      onHecho();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const titulo = gastoId ? "Revisar y confirmar" : "Nuevo gasto o servicio";
  const opcionesProv: [string, string][] = [["", "(Elegir proveedor)"], ...proveedores.map((p): [string, string] => [p.id, `${nombreProveedor(p)}${p.ruc ? ` — ${p.ruc}` : ""}`])];
  const opcionesCat: [string, string][] = [["", "(Categoría)"], ...categorias.map((c): [string, string] => [c.id, c.nombre]), ["__nueva__", "+ Nueva categoría…"]];

  return (
    <CapaModal onClose={busy ? undefined : onClose}>
      <div className={`flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${ALTO_MAX_MODAL}`} style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-800">{hecho ? (hecho.confirmado ? "Gasto o servicio confirmado" : "Borrador guardado") : titulo}</h2>
          <button onClick={onClose} disabled={!!busy} aria-label="Cerrar" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"><X className="h-5 w-5" /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {hecho ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><CheckCircle2 className="h-8 w-8" /></div>
              {hecho.confirmado ? (
                <>
                  <p className="text-sm text-slate-500">Número generado: <b className="font-mono text-[#3F8E91]">{hecho.numero ?? "—"}</b> · {gs(hecho.total)}</p>
                  {hecho.credito ? (
                    <p className="text-sm text-slate-600">Quedó como deuda con el proveedor. Pagalo desde{" "}
                      <Link href="/compras/pagos" className="font-semibold text-[#3F8E91] hover:underline">Compras › Pagos a proveedores</Link>.</p>
                  ) : hecho.caja ? (
                    <p className="text-sm text-slate-600">El efectivo salió de la caja abierta (egreso registrado).</p>
                  ) : (
                    <p className="text-sm text-slate-600">Quedó registrado como pagado al contado.</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-600">Lo podés completar y confirmar después desde la lista.</p>
              )}
              {hecho.avisoAdjunto ? <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{hecho.avisoAdjunto}</p> : null}
            </div>
          ) : cargando ? (
            <p className="py-10 text-center text-sm text-slate-400">Cargando…</p>
          ) : (
            <>
              {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</div> : null}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={LABEL}>Proveedor *</label>
                  <Select value={form.proveedor_id} onChange={elegirProveedor} options={opcionesProv} block />
                  {proveedores.length === 0 ? (
                    <p className="mt-1 text-[11px] text-slate-500">No hay proveedores activos. <Link href="/proveedores" className="font-semibold text-[#3F8E91] hover:underline">Cargá uno</Link>.</p>
                  ) : null}
                </div>
                <div>
                  <label className={LABEL}>Tipo de comprobante *</label>
                  <Select value={form.tipo_comprobante} onChange={(v) => set("tipo_comprobante", v)} options={TIPOS_COMPROBANTE.map((t): [string, string] => [t, t])} block />
                </div>
                <div>
                  <label className={LABEL}>Número de comprobante *</label>
                  <input className={`${INPUT} font-mono`} inputMode={requiereTimbrado(form.tipo_comprobante) ? "numeric" : "text"} placeholder={requiereTimbrado(form.tipo_comprobante) ? "001-001-0000001" : "N° del recibo"}
                    value={form.numero_comprobante}
                    onChange={(e) => set("numero_comprobante", requiereTimbrado(form.tipo_comprobante) ? formatComprobante(e.target.value) : e.target.value.slice(0, 40))} />
                </div>
                <div>
                  <label className={LABEL}>Timbrado{requiereTimbrado(form.tipo_comprobante) ? " *" : ""}</label>
                  <input className={`${INPUT} font-mono`} inputMode="numeric" maxLength={20} placeholder="12345678" value={form.timbrado} onChange={(e) => set("timbrado", e.target.value.replace(/\s/g, ""))} />
                </div>
                <div>
                  <label className={LABEL}>Fecha del comprobante *</label>
                  <input type="date" className={INPUT} max={hoyPY()} value={form.fecha_comprobante} onChange={(e) => set("fecha_comprobante", e.target.value)} />
                </div>
                <div>
                  <label className={LABEL}>Condición *</label>
                  <div className="flex rounded-xl bg-slate-100 p-1">
                    {(["contado", "credito"] as const).map((t) => (
                      <button key={t} type="button" onClick={() => set("tipo_pago", t)}
                        className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${form.tipo_pago === t ? "bg-white text-[#3F8E91] shadow-sm" : "text-slate-500"}`}>
                        {t === "contado" ? "Contado" : "Crédito"}
                      </button>
                    ))}
                  </div>
                </div>
                {form.tipo_pago === "contado" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={LABEL}>Medio de pago *</label>
                      <Select value={form.medio_pago} onChange={(v) => set("medio_pago", v as MedioPagoGasto)} block
                        options={[["", "(Elegir)"], ...MEDIOS_PAGO_GASTO.map((m): [string, string] => [m.v, m.l])]} />
                    </div>
                    <div>
                      <label className={LABEL}>Referencia</label>
                      <input className={INPUT} placeholder={form.medio_pago === "efectivo" ? "—" : "N° operación / cheque"} disabled={form.medio_pago === "efectivo"}
                        value={form.referencia_pago} onChange={(e) => set("referencia_pago", e.target.value)} />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={LABEL}>Plazo (días)</label>
                      <input type="number" min={0} max={3650} className={INPUT} placeholder="30" value={form.plazo_dias}
                        onChange={(e) => setForm((f) => ({ ...f, plazo_dias: e.target.value, fecha_vencimiento: "" }))} />
                    </div>
                    <div>
                      <label className={LABEL}>Vencimiento</label>
                      <input type="date" className={INPUT} min={form.fecha_comprobante || undefined} value={form.fecha_vencimiento || vencSugerido}
                        onChange={(e) => set("fecha_vencimiento", e.target.value)} />
                    </div>
                  </div>
                )}
              </div>

              {form.tipo_pago === "credito" ? (
                <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                  Al confirmar queda como deuda con el proveedor y se paga desde <b>Compras › Pagos a proveedores</b>.
                </p>
              ) : form.medio_pago === "efectivo" ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Al confirmar, el efectivo <b>sale de la caja abierta</b> (necesitás tener una caja abierta).
                </p>
              ) : null}

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Líneas (categoría por línea)</h3>
                  <button type="button" onClick={() => set("items", [...form.items, lineaVacia()])}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-[#3F8E91] hover:bg-slate-50">
                    <Plus className="h-3.5 w-3.5" /> Agregar línea
                  </button>
                </div>
                <div className="space-y-2">
                  {form.items.map((it, i) => {
                    const m = Math.round(Number(it.monto) || 0);
                    return (
                      <div key={i} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <div>
                            <label className={LABEL}>Categoría *</label>
                            {nuevaCat?.fila === i ? (
                              <div className="flex gap-1.5">
                                <input autoFocus className={INPUT} placeholder="Nombre de la categoría" value={nuevaCat.nombre}
                                  onChange={(e) => setNuevaCat({ fila: i, nombre: e.target.value })}
                                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void crearCategoria(); } }} />
                                <button type="button" onClick={() => void crearCategoria()} className="rounded-xl bg-[#4FAEB2] px-3 text-xs font-semibold text-white hover:bg-[#3F8E91]">Crear</button>
                                <button type="button" onClick={() => setNuevaCat(null)} aria-label="Cancelar" className="rounded-xl border border-slate-200 px-2 text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
                              </div>
                            ) : (
                              <Select value={it.categoria_id ?? ""} onChange={(v) => elegirCategoria(i, v)} options={opcionesCat} block />
                            )}
                          </div>
                          <div>
                            <label className={LABEL}>Descripción *</label>
                            <input className={INPUT} placeholder="Detalle de la línea" maxLength={300} value={it.descripcion} onChange={(e) => setItem(i, { descripcion: e.target.value })} />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <div>
                            <label className={LABEL}>Monto (IVA incluido) *</label>
                            <div className="relative">
                              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">Gs.</span>
                              <MontoInput value={it.monto} onChange={(n) => setItem(i, { monto: n })} decimals={false} placeholder="0" className={`${INPUT} pl-10 text-right tabular-nums`} />
                            </div>
                          </div>
                          <div>
                            <label className={LABEL}>Tipo de IVA</label>
                            <Select value={it.iva_tipo} onChange={(v) => setItem(i, { iva_tipo: v as IvaTipo })} block options={[["10%", "10 %"], ["5%", "5 %"], ["exenta", "Exenta"]]} />
                          </div>
                          <div className="flex flex-col justify-end text-right text-xs text-slate-500">
                            <span>{it.iva_tipo === "exenta" ? "Exento" : `IVA ${it.iva_tipo}`}: <b className="text-slate-700">{gs(ivaDe(m, it.iva_tipo))}</b></span>
                            <span>Total de la línea: <b className="text-slate-800">{gs(m)}</b></span>
                          </div>
                        </div>
                        {form.items.length > 1 ? (
                          <div className="flex justify-end">
                            <button type="button" onClick={() => set("items", form.items.filter((_, j) => j !== i))} className="inline-flex items-center gap-1 text-xs text-rose-500 hover:text-rose-700">
                              <Trash2 className="h-3.5 w-3.5" /> Eliminar línea
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-1 text-sm">
                  <span className="text-slate-500">Subtotal: <b className="text-slate-800">{gs(totales.sub)}</b></span>
                  {totales.i10 ? <span className="text-slate-500">IVA 10 %: <b className="text-slate-800">{gs(totales.i10)}</b></span> : null}
                  {totales.i5 ? <span className="text-slate-500">IVA 5 %: <b className="text-slate-800">{gs(totales.i5)}</b></span> : null}
                  {totales.ex ? <span className="text-slate-500">Exentas: <b className="text-slate-800">{gs(totales.ex)}</b></span> : null}
                  <span className="text-slate-600">Total de la operación: <b className="text-base text-slate-900">{gs(totales.total)}</b></span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={LABEL}>Comprobante adjunto (foto o PDF)</label>
                  <input ref={fileRef} type="file" accept={ACCEPT_COMPROBANTE} className="hidden" onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); e.target.value = ""; }} />
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="flex w-full items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-left text-sm text-slate-600 hover:border-[#4FAEB2] hover:bg-[#4FAEB2]/5">
                    <Paperclip className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1 truncate">{archivo ? archivo.name : adjuntoActual ? `${adjuntoActual} (reemplazar)` : "Elegir archivo…"}</span>
                    {archivo ? <X className="h-4 w-4 shrink-0 text-slate-400 hover:text-slate-700" onClick={(e) => { e.stopPropagation(); setArchivo(null); }} /> : null}
                  </button>
                </div>
                <div>
                  <label className={LABEL}>Descripción general</label>
                  <input className={INPUT} maxLength={500} placeholder="Ej. alquiler de octubre" value={form.descripcion} onChange={(e) => set("descripcion", e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <label className={LABEL}>Observación</label>
                  <textarea rows={2} className={INPUT} maxLength={1000} value={form.observacion} onChange={(e) => set("observacion", e.target.value)} />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
          {hecho ? (
            <button onClick={onClose} className="rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91]">Cerrar</button>
          ) : (
            <>
              {faltante && !cargando ? <span className="mr-auto text-xs text-slate-400">{faltante}</span> : null}
              <button onClick={onClose} disabled={!!busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
              <button onClick={() => void guardar(false)} disabled={!!busy || cargando}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#4FAEB2]/50 px-4 py-2 text-sm font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/5 disabled:opacity-50">
                {busy === "borrador" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar borrador
              </button>
              <button onClick={() => void guardar(true)} disabled={!!busy || cargando || !!faltante}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50">
                {busy === "confirmar" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {busy === "confirmar" ? "Confirmando…" : "Confirmar gasto o servicio"}
              </button>
            </>
          )}
        </div>
      </div>
    </CapaModal>
  );
}
