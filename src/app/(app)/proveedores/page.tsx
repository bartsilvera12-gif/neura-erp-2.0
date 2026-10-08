"use client";

/**
 * /proveedores — maestro de proveedores (Fase 1 de Compras, portado de Ferretería).
 * Lista con búsqueda inteligente (nombre, RUC, vendedor, teléfono, rubro…), filtro por
 * rubro e inactivos, exportar a Excel y panel lateral para crear/editar. Un proveedor
 * con compras registradas no se borra: se desactiva.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Ban, CheckCircle2, Download, Loader2, MoreHorizontal, Pencil, Plus, Search, Trash2, Truck, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchCache, invalidar } from "@/lib/api/cache-cliente";
import { invalidarProveedores } from "@/modules/proveedores/cache";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { descargarArchivo } from "@/lib/api/client-blob";
import { buscar } from "@/lib/busqueda";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { MenuAcciones } from "@/components/MenuAcciones";
import { ProveedorForm } from "@/modules/proveedores/ProveedorForm";
import { condicionTexto, nombreProveedor, type CategoriaProveedor, type Proveedor } from "@/modules/proveedores/tipos";
import { TZ_PY } from "@/lib/fecha/paraguay";

const TEAL = clienteConfig.color;
const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "short", year: "numeric" });

export default function ProveedoresPage() {
  const [lista, setLista] = useState<Proveedor[]>([]);
  const [categorias, setCategorias] = useState<CategoriaProveedor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const esAdmin = useUsuario()?.rol === "ADMIN";
  const [busqueda, setBusqueda] = useState("");
  const [rubro, setRubro] = useState("");
  const [verInactivos, setVerInactivos] = useState(false);
  const [form, setForm] = useState<{ open: boolean; prov: Proveedor | null }>({ open: false, prov: null });
  const [borrando, setBorrando] = useState<Proveedor | null>(null);
  const [exportando, setExportando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([
        apiFetch<{ proveedores: Proveedor[] }>("/api/proveedores"),
        apiFetchCache<{ categorias: CategoriaProveedor[] }>("/api/proveedores/categorias"),
      ]);
      setLista(p.proveedores);
      setCategorias(c.categorias);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function cambiarEstado(p: Proveedor) {
    setError(null);
    try {
      await apiFetch(`/api/proveedores/${p.id}`, { method: "PATCH", body: JSON.stringify({ activo: !p.activo }) });
      invalidarProveedores();
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const visibles = useMemo(() => {
    const base = lista.filter((p) => (verInactivos || p.activo) && (!rubro || p.categorias.some((c) => c.id === rubro)));
    // Búsqueda inteligente: sin tildes, errores de tipeo, RUC con o sin guion.
    return buscar(base, busqueda, (p) => ({
      principal: nombreProveedor(p),
      otros: [p.nombre, p.contacto, p.ciudad, p.email, ...p.categorias.map((c) => c.nombre)],
      codigos: [p.ruc, p.telefono, p.contacto_telefono],
    }));
  }, [lista, busqueda, rubro, verInactivos]);

  const activos = lista.filter((p) => p.activo).length;
  const inactivos = lista.length - activos;

  async function exportar() {
    setExportando(true);
    try {
      await descargarArchivo("/api/proveedores/export", "proveedores.xlsx");
    } catch {
      /* best-effort */
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Operaciones · Compras</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Proveedores</h1>
          <p className="mt-1 text-sm text-slate-500">A quién le comprás: datos de contacto, rubros y condiciones de pago.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={exportar} disabled={exportando || lista.length === 0} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">
            {exportando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Exportar Excel
          </button>
          {esAdmin ? (
            <button onClick={() => setForm({ open: true, prov: null })} className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95" style={{ backgroundColor: TEAL }}>
              <Plus className="h-4 w-4" /> Nuevo proveedor
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="flex items-start justify-between gap-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Cerrar" className="text-rose-400 hover:text-rose-600"><X className="h-4 w-4" /></button>
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre, RUC, vendedor, teléfono o rubro…"
              className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]" />
          </div>
          {categorias.length ? (
            <Select value={rubro} onChange={setRubro} minWidth={170} options={[["", "Todos los rubros"], ...categorias.map((c): [string, string] => [c.id, c.nombre])]} />
          ) : null}
          {inactivos > 0 ? (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />
              Ver inactivos ({inactivos})
            </label>
          ) : null}
          <p className="text-xs text-slate-500">{visibles.length} de {verInactivos ? lista.length : activos}</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b-2 text-[11px] font-bold uppercase tracking-wider" style={{ borderColor: `${TEAL}26`, backgroundColor: `${TEAL}0d`, color: TEAL }}>
                <th className="px-5 py-3">Proveedor</th>
                <th className="px-3 py-3">RUC</th>
                <th className="px-3 py-3">Contacto</th>
                <th className="px-3 py-3">Condición</th>
                <th className="px-3 py-3">Rubros</th>
                <th className="px-3 py-3 text-right">Compras</th>
                <th className="w-px px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-400">Cargando…</td></tr>
              ) : lista.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <Truck className="mx-auto h-8 w-8 text-slate-300" />
                    <p className="mt-3 text-sm font-medium text-slate-700">Todavía no cargaste proveedores</p>
                    <p className="mt-1 text-xs text-slate-500">Cargalos para registrar a quién le comprás y a qué precio.</p>
                    {esAdmin ? (
                      <button onClick={() => setForm({ open: true, prov: null })} className="mt-4 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: TEAL }}>
                        <Plus className="h-4 w-4" /> Nuevo proveedor
                      </button>
                    ) : null}
                  </td>
                </tr>
              ) : visibles.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-400">Ningún proveedor coincide con la búsqueda.</td></tr>
              ) : (
                visibles.map((p) => {
                  const nombre = nombreProveedor(p);
                  return (
                    <tr key={p.id} onClick={() => esAdmin && setForm({ open: true, prov: p })} className={`transition-colors hover:bg-[var(--brand-50)] ${esAdmin ? "cursor-pointer" : ""} ${p.activo ? "" : "opacity-60"}`}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ backgroundColor: `${TEAL}1a`, color: TEAL }}>
                            {nombre.charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-bold text-slate-900">
                              {nombre}
                              {!p.activo ? <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-slate-500">Inactivo</span> : null}
                            </p>
                            {p.nombre_comercial && p.nombre_comercial.trim() !== p.nombre ? <p className="truncate text-[11px] text-slate-500">{p.nombre}</p> : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-slate-600">{p.ruc ?? "—"}</td>
                      <td className="px-3 py-3 text-xs text-slate-600">
                        <p>{p.contacto ?? (p.telefono ? "" : "—")}</p>
                        <p className="text-slate-400">{p.contacto_telefono || p.telefono || ""}</p>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.condicion_pago === "credito" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{condicionTexto(p)}</span>
                        {p.moneda === "USD" ? <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">USD</span> : null}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {p.categorias.length ? p.categorias.map((c) => (
                            <span key={c.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{c.nombre}</span>
                          )) : <span className="text-xs text-slate-400">—</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <p className="font-semibold tabular-nums text-slate-800">{p.compras}</p>
                        {p.ultima_compra ? <p className="text-[11px] text-slate-400">última {fechaCorta(p.ultima_compra)}</p> : null}
                      </td>
                      <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                        {esAdmin ? (
                          <MenuAcciones
                            etiqueta={`Acciones de ${nombre}`}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                            items={[
                              { etiqueta: "Editar", icono: <Pencil className="h-4 w-4" />, onClick: () => setForm({ open: true, prov: p }) },
                              p.activo
                                ? { etiqueta: "Desactivar", icono: <Ban className="h-4 w-4" />, onClick: () => cambiarEstado(p), tono: "peligro" }
                                : { etiqueta: "Activar", icono: <CheckCircle2 className="h-4 w-4" />, onClick: () => cambiarEstado(p), tono: "exito" },
                              ...(p.compras === 0 ? [{ etiqueta: "Eliminar", icono: <Trash2 className="h-4 w-4" />, onClick: () => setBorrando(p), tono: "peligro" as const }] : []),
                            ]}
                          >
                            <MoreHorizontal className="h-5 w-5" />
                          </MenuAcciones>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {form.open ? (
        <ProveedorForm
          proveedor={form.prov}
          categorias={categorias}
          onClose={() => setForm({ open: false, prov: null })}
          onSaved={() => { setForm({ open: false, prov: null }); invalidar("/api/proveedores/categorias"); void cargar(); }}
        />
      ) : null}

      {borrando ? (
        <ConfirmarBorrado
          nombre={nombreProveedor(borrando)}
          onCancelar={() => setBorrando(null)}
          onConfirmar={async () => {
            await apiFetch(`/api/proveedores/${borrando.id}`, { method: "DELETE" });
            invalidarProveedores();
            setBorrando(null);
            await cargar();
          }}
        />
      ) : null}
    </div>
  );
}

function ConfirmarBorrado({ nombre, onCancelar, onConfirmar }: { nombre: string; onCancelar: () => void; onConfirmar: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm" onClick={() => !busy && onCancelar()}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" style={{ animation: "rb-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <h3 className="text-lg font-semibold text-slate-900">¿Eliminar a {nombre}?</h3>
        <p className="mt-1 text-sm text-slate-500">No tiene compras registradas, así que se puede borrar. No se puede deshacer.</p>
        {error ? <p className="mt-3 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancelar} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button
            disabled={busy}
            onClick={async () => { setBusy(true); setError(null); try { await onConfirmar(); } catch (e) { setError((e as Error).message); setBusy(false); } }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Eliminar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
