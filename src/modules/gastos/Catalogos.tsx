"use client";

/**
 * Catálogos de Gastos empresariales (modal con pestañas, solo ADMIN):
 *   · Categorías     rubros › subcategorías (fijo/variable, IVA deducible, personal). Desactivar
 *                    no borra: los gastos viejos conservan su categoría.
 *   · Empleados      nombre, CI, cargo y sucursal (para las líneas de sueldos / IPS / aguinaldo).
 *   · Cuentas bancarias  cuentas PROPIAS de donde salen transferencias, cheques y tarjetas.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { invalidar } from "@/lib/api/cache-cliente";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { Select } from "@/components/Select";
import { URL_CATALOGOS, nombreCuenta, type Catalogos, type CuentaBancaria, type Empleado, type Rubro, type Subcategoria } from "@/modules/gastos/tipos";

const INPUT = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";
const LABEL = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500";
type Pestana = "categorias" | "empleados" | "cuentas";

export function CatalogosGastos({ inicial = "categorias", onClose, onCambio }: { inicial?: Pestana; onClose: () => void; onCambio?: () => void }) {
  const [tab, setTab] = useState<Pestana>(inicial);
  const [cat, setCat] = useState<Catalogos | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    apiFetch<Catalogos>(`${URL_CATALOGOS}?todas=1`).then(setCat).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const guardado = () => { invalidar(URL_CATALOGOS); cargar(); onCambio?.(); };

  return (
    <CapaModal onClose={onClose}>
      <div className={`flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${ALTO_MAX_MODAL}`} style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-800">Catálogos de gastos</h2>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex shrink-0 gap-1 border-b border-slate-100 px-6">
          {([["categorias", "Categorías"], ["empleados", "Empleados"], ["cuentas", "Cuentas bancarias"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`relative px-3 py-2.5 text-sm font-medium ${tab === k ? "text-[#3F8E91]" : "text-slate-500 hover:text-slate-800"}`}>
              {l}<span className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full ${tab === k ? "bg-[#4FAEB2]" : ""}`} />
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {error ? <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
          {!cat ? <p className="py-10 text-center text-sm text-slate-400">Cargando…</p>
            : tab === "categorias" ? <TabCategorias rubros={cat.rubros} onGuardado={guardado} onError={setError} />
            : tab === "empleados" ? <TabEmpleados empleados={cat.empleados} sucursales={cat.sucursales} onGuardado={guardado} onError={setError} />
            : <TabCuentas cuentas={cat.cuentas_bancarias} bancos={cat.bancos} onGuardado={guardado} onError={setError} />}
        </div>
      </div>
    </CapaModal>
  );
}

async function guardar(url: string, body: unknown, onGuardado: () => void, onError: (e: string | null) => void) {
  onError(null);
  try {
    await apiFetch(url, { method: "POST", body: JSON.stringify(body) });
    onGuardado();
    return true;
  } catch (e) {
    onError((e as Error).message);
    return false;
  }
}

// ── Categorías ───────────────────────────────────────────────────────────────
type EdCat = { id?: string; nombre: string; padre_id: string | null; tipo_costo: "fijo" | "variable"; deducible_iva: boolean; activo: boolean };

function TabCategorias({ rubros, onGuardado, onError }: { rubros: Rubro[]; onGuardado: () => void; onError: (e: string | null) => void }) {
  const [ed, setEd] = useState<EdCat | null>(null);
  const [busy, setBusy] = useState(false);
  async function ok() {
    if (!ed || busy) return;
    setBusy(true);
    if (await guardar("/api/gastos/categorias", ed, onGuardado, onError)) setEd(null);
    setBusy(false);
  }
  const editor = (
    <EditorCat ed={ed!} setEd={setEd} busy={busy} onOk={() => void ok()} />
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Cada gasto se carga en una subcategoría. Los rubros agrupan para el resumen y el presupuesto.</p>
        <button onClick={() => setEd({ nombre: "", padre_id: null, tipo_costo: "variable", deducible_iva: true, activo: true })}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-[#3F8E91] hover:bg-slate-50"><Plus className="h-3.5 w-3.5" /> Rubro</button>
      </div>
      {ed && !ed.id && ed.padre_id === null ? editor : null}
      {rubros.map((r) => (
        <div key={r.id} className={`rounded-xl border border-slate-200 ${r.activo ? "" : "opacity-60"}`}>
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2">
            <p className="text-sm font-semibold text-slate-800">{r.nombre}{!r.activo ? <span className="ml-2 text-[11px] font-normal text-slate-400">inactivo</span> : null}</p>
            <div className="flex gap-1">
              <button onClick={() => setEd({ id: r.id, nombre: r.nombre, padre_id: null, tipo_costo: "variable", deducible_iva: true, activo: r.activo })} aria-label={`Editar ${r.nombre}`}
                className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-slate-700"><Pencil className="h-3.5 w-3.5" /></button>
              <button onClick={() => setEd({ nombre: "", padre_id: r.id, tipo_costo: "variable", deducible_iva: !r.es_personal, activo: true })}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-semibold text-[#3F8E91] hover:bg-white"><Plus className="h-3.5 w-3.5" /> Subcategoría</button>
            </div>
          </div>
          {ed?.id === r.id ? <div className="p-2">{editor}</div> : null}
          <ul className="divide-y divide-slate-100">
            {r.subcategorias.map((s: Subcategoria) => (
              <li key={s.id} className={`px-3 py-1.5 ${s.activo ? "" : "opacity-50"}`}>
                {ed?.id === s.id ? editor : (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-slate-700">{s.nombre}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${s.tipo_costo === "fijo" ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-500"}`}>{s.tipo_costo === "fijo" ? "Fijo" : "Variable"}</span>
                    {!s.deducible_iva ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">No deducible</span> : null}
                    {s.usos ? <span className="text-[11px] text-slate-400">{s.usos} usos</span> : null}
                    <button onClick={() => setEd({ id: s.id, nombre: s.nombre, padre_id: r.id, tipo_costo: s.tipo_costo, deducible_iva: s.deducible_iva, activo: s.activo })} aria-label={`Editar ${s.nombre}`}
                      className="rounded-lg p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-700"><Pencil className="h-3.5 w-3.5" /></button>
                  </div>
                )}
              </li>
            ))}
            {ed && !ed.id && ed.padre_id === r.id ? <li className="p-2">{editor}</li> : null}
          </ul>
        </div>
      ))}
    </div>
  );
}

function EditorCat({ ed, setEd, busy, onOk }: { ed: EdCat; setEd: (e: EdCat | null) => void; busy: boolean; onOk: () => void }) {
  const esRubro = ed.padre_id === null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#4FAEB2]/40 bg-[#4FAEB2]/5 p-2">
      <input autoFocus className={`${INPUT} min-w-[12rem] flex-1`} placeholder={esRubro ? "Nombre del rubro" : "Nombre de la subcategoría"} value={ed.nombre}
        onChange={(e) => setEd({ ...ed, nombre: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") onOk(); if (e.key === "Escape") setEd(null); }} />
      {!esRubro ? (
        <>
          <Select value={ed.tipo_costo} onChange={(v) => setEd({ ...ed, tipo_costo: v as "fijo" | "variable" })} compacto options={[["variable", "Variable"], ["fijo", "Fijo"]]} />
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={ed.deducible_iva} onChange={(e) => setEd({ ...ed, deducible_iva: e.target.checked })} className="accent-[#4FAEB2]" /> IVA deducible
          </label>
        </>
      ) : null}
      {ed.id ? (
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={ed.activo} onChange={(e) => setEd({ ...ed, activo: e.target.checked })} className="accent-[#4FAEB2]" /> Activa
        </label>
      ) : null}
      <button onClick={() => setEd(null)} className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-white">Cancelar</button>
      <button onClick={onOk} disabled={busy || ed.nombre.trim().length < 2} className="inline-flex items-center gap-1 rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Guardar
      </button>
    </div>
  );
}

// ── Empleados ────────────────────────────────────────────────────────────────
function TabEmpleados({ empleados, sucursales, onGuardado, onError }: {
  empleados: Empleado[]; sucursales: { id: string; nombre: string }[]; onGuardado: () => void; onError: (e: string | null) => void;
}) {
  const vacio = { id: undefined as string | undefined, nombre: "", ci: "", cargo: "", sucursal_id: "", activo: true };
  const [ed, setEd] = useState<typeof vacio | null>(null);
  const [busy, setBusy] = useState(false);
  async function ok() {
    if (!ed || busy) return;
    setBusy(true);
    if (await guardar("/api/gastos/empleados", { ...ed, sucursal_id: ed.sucursal_id || null, ci: ed.ci || null, cargo: ed.cargo || null }, onGuardado, onError)) setEd(null);
    setBusy(false);
  }
  const nombreSuc = (id: string | null) => sucursales.find((s) => s.id === id)?.nombre ?? "—";
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Para imputar sueldos, IPS patronal y aguinaldo por persona. Sin liquidación de IPS: se carga como gasto.</p>
        <button onClick={() => setEd({ ...vacio })} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-[#3F8E91] hover:bg-slate-50"><Plus className="h-3.5 w-3.5" /> Empleado</button>
      </div>
      {ed ? (
        <div className="grid grid-cols-1 gap-2 rounded-xl border border-[#4FAEB2]/40 bg-[#4FAEB2]/5 p-3 sm:grid-cols-4">
          <div className="sm:col-span-2"><label className={LABEL}>Nombre *</label><input autoFocus className={INPUT} value={ed.nombre} onChange={(e) => setEd({ ...ed, nombre: e.target.value })} /></div>
          <div><label className={LABEL}>CI</label><input className={INPUT} inputMode="numeric" value={ed.ci} onChange={(e) => setEd({ ...ed, ci: e.target.value })} /></div>
          <div><label className={LABEL}>Cargo</label><input className={INPUT} value={ed.cargo} onChange={(e) => setEd({ ...ed, cargo: e.target.value })} /></div>
          <div className="sm:col-span-2"><label className={LABEL}>Sucursal</label>
            <Select value={ed.sucursal_id} onChange={(v) => setEd({ ...ed, sucursal_id: v })} block options={[["", "(Sin sucursal fija)"], ...sucursales.map((s): [string, string] => [s.id, s.nombre])]} />
          </div>
          <div className="flex items-end justify-end gap-2 sm:col-span-2">
            {ed.id ? <label className="mr-auto flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={ed.activo} onChange={(e) => setEd({ ...ed, activo: e.target.checked })} className="accent-[#4FAEB2]" /> Activo</label> : null}
            <button onClick={() => setEd(null)} className="rounded-lg px-3 py-2 text-xs text-slate-500 hover:bg-white">Cancelar</button>
            <button onClick={() => void ok()} disabled={busy || ed.nombre.trim().length < 2} className="inline-flex items-center gap-1 rounded-lg bg-[#4FAEB2] px-3 py-2 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Guardar
            </button>
          </div>
        </div>
      ) : null}
      {empleados.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">Todavía no cargaste empleados.</p> : (
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="pb-2">Nombre</th><th className="pb-2">CI</th><th className="pb-2">Cargo</th><th className="pb-2">Sucursal</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {empleados.map((e) => (
              <tr key={e.id} className={e.activo ? "" : "opacity-50"}>
                <td className="py-1.5 text-slate-800">{e.nombre}</td><td className="py-1.5 font-mono text-xs text-slate-500">{e.ci ?? "—"}</td>
                <td className="py-1.5 text-slate-600">{e.cargo ?? "—"}</td><td className="py-1.5 text-slate-600">{nombreSuc(e.sucursal_id)}</td>
                <td className="py-1.5 text-right"><button onClick={() => setEd({ id: e.id, nombre: e.nombre, ci: e.ci ?? "", cargo: e.cargo ?? "", sucursal_id: e.sucursal_id ?? "", activo: e.activo })} aria-label={`Editar ${e.nombre}`}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-700"><Pencil className="h-3.5 w-3.5" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Cuentas bancarias ────────────────────────────────────────────────────────
function TabCuentas({ cuentas, bancos, onGuardado, onError }: {
  cuentas: CuentaBancaria[]; bancos: { id: string; nombre: string }[]; onGuardado: () => void; onError: (e: string | null) => void;
}) {
  const vacio = { id: undefined as string | undefined, banco_id: bancos[0]?.id ?? "", banco_nombre: "", numero: "", moneda: "GS" as "GS" | "USD", titular: "", alias: "", activa: true };
  const [ed, setEd] = useState<typeof vacio | null>(null);
  const [busy, setBusy] = useState(false);
  async function ok() {
    if (!ed || busy) return;
    setBusy(true);
    const body = { ...ed, banco_id: ed.banco_id && ed.banco_id !== "__otro__" ? ed.banco_id : null, banco_nombre: ed.banco_id === "__otro__" || !ed.banco_id ? ed.banco_nombre : null,
      titular: ed.titular || null, alias: ed.alias || null };
    if (await guardar("/api/gastos/cuentas-bancarias", body, onGuardado, onError)) setEd(null);
    setBusy(false);
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Las cuentas de la empresa: de dónde sale una transferencia, un cheque o un pago con tarjeta.</p>
        <button onClick={() => setEd({ ...vacio })} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-[#3F8E91] hover:bg-slate-50"><Plus className="h-3.5 w-3.5" /> Cuenta</button>
      </div>
      {ed ? (
        <div className="grid grid-cols-1 gap-2 rounded-xl border border-[#4FAEB2]/40 bg-[#4FAEB2]/5 p-3 sm:grid-cols-4">
          <div className="sm:col-span-2"><label className={LABEL}>Banco *</label>
            <Select value={ed.banco_id} onChange={(v) => setEd({ ...ed, banco_id: v })} block options={[...bancos.map((b): [string, string] => [b.id, b.nombre]), ["__otro__", "Otro banco…"]]} />
          </div>
          {ed.banco_id === "__otro__" || !ed.banco_id ? (
            <div className="sm:col-span-2"><label className={LABEL}>Nombre del banco *</label><input className={INPUT} value={ed.banco_nombre} onChange={(e) => setEd({ ...ed, banco_nombre: e.target.value })} /></div>
          ) : <div className="hidden sm:col-span-2 sm:block" />}
          <div className="sm:col-span-2"><label className={LABEL}>Número de cuenta *</label><input autoFocus className={`${INPUT} font-mono`} value={ed.numero} onChange={(e) => setEd({ ...ed, numero: e.target.value })} /></div>
          <div><label className={LABEL}>Moneda</label><Select value={ed.moneda} onChange={(v) => setEd({ ...ed, moneda: v as "GS" | "USD" })} block options={[["GS", "Guaraníes"], ["USD", "Dólares"]]} /></div>
          <div><label className={LABEL}>Alias</label><input className={INPUT} placeholder="Operativa" value={ed.alias} onChange={(e) => setEd({ ...ed, alias: e.target.value })} /></div>
          <div className="sm:col-span-2"><label className={LABEL}>Titular</label><input className={INPUT} value={ed.titular} onChange={(e) => setEd({ ...ed, titular: e.target.value })} /></div>
          <div className="flex items-end justify-end gap-2 sm:col-span-2">
            {ed.id ? <label className="mr-auto flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={ed.activa} onChange={(e) => setEd({ ...ed, activa: e.target.checked })} className="accent-[#4FAEB2]" /> Activa</label> : null}
            <button onClick={() => setEd(null)} className="rounded-lg px-3 py-2 text-xs text-slate-500 hover:bg-white">Cancelar</button>
            <button onClick={() => void ok()} disabled={busy || !ed.numero.trim()} className="inline-flex items-center gap-1 rounded-lg bg-[#4FAEB2] px-3 py-2 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Guardar
            </button>
          </div>
        </div>
      ) : null}
      {cuentas.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">Todavía no cargaste cuentas bancarias.</p> : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {cuentas.map((c) => (
            <li key={c.id} className={`flex items-center gap-2 px-3 py-2 text-sm ${c.activa ? "" : "opacity-50"}`}>
              <span className="min-w-0 flex-1 truncate text-slate-700">{nombreCuenta(c)}</span>
              {c.titular ? <span className="hidden text-xs text-slate-400 sm:inline">{c.titular}</span> : null}
              <button onClick={() => setEd({ id: c.id, banco_id: c.banco_id ?? "__otro__", banco_nombre: c.banco_nombre, numero: c.numero, moneda: c.moneda, titular: c.titular ?? "", alias: c.alias ?? "", activa: c.activa })}
                aria-label="Editar cuenta" className="rounded-lg p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-700"><Pencil className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
