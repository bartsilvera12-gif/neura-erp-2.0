"use client";

/**
 * /inventario/categorias — Categorías de productos (portado de Ferretería República):
 * alta rápida arriba, tabla con estado y acciones Editar / Activar-Desactivar.
 * No hay borrado (como Ferretería): una categoría con productos se desactiva.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Pencil, Plus, Tags } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { colorCategoria, type Categoria } from "@/modules/inventario/categorias";

const TEAL = clienteConfig.color;
const INPUT = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
const ET = "mb-1 block text-xs font-medium text-slate-600";

export default function CategoriasPage() {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [esAdmin, setEsAdmin] = useState(false);
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [padre, setPadre] = useState("");
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<Categoria | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await apiFetch<{ categorias: Categoria[] }>("/api/inventario/categorias?todas=1");
      setCategorias(r.categorias);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
    apiFetch<{ rol: string }>("/api/me").then((m) => setEsAdmin(m.rol === "ADMIN")).catch(() => {});
  }, [cargar]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setCreando(true);
    setError(null);
    try {
      await apiFetch("/api/inventario/categorias", {
        method: "POST",
        body: JSON.stringify({ nombre: nombre.trim(), codigo: codigo.trim() || null, parent_id: padre || null }),
      });
      setNombre("");
      setCodigo("");
      setPadre("");
      await cargar();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreando(false);
    }
  }

  async function toggle(c: Categoria) {
    setToggling(c.id);
    try {
      await apiFetch(`/api/inventario/categorias/${c.id}`, { method: "PATCH", body: JSON.stringify({ activo: !c.activo }) });
      await cargar();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setToggling(null);
    }
  }

  const nombrePorId = new Map(categorias.map((c) => [c.id, c.nombre]));
  const activas = categorias.filter((c) => c.activo);

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Operaciones · Stock</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Categorías de productos</h1>
          <p className="mt-1 text-sm text-slate-500">Clasificá tus productos para reportes y búsqueda.</p>
        </div>
        <Link href="/inventario" className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50">Inventario</Link>
      </header>

      <p className="rounded-xl border px-4 py-3 text-xs text-slate-600" style={{ borderColor: `${TEAL}33`, backgroundColor: "var(--brand-50)" }}>
        Las categorías aparecen en el selector <strong>Categoría</strong> del producto y como filtro en el inventario. También se pueden crear solas al importar desde Excel.
      </p>

      {esAdmin ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="block h-5 w-1 rounded-full" style={{ backgroundColor: TEAL }} />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">Nueva categoría</h2>
          </div>
          <form onSubmit={crear} className="grid gap-3 sm:grid-cols-[2fr_1fr_1.5fr_auto] sm:items-end">
            <label className="block">
              <span className={ET}>Nombre</span>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} required placeholder="Ej: BEBIDAS" className={INPUT} />
            </label>
            <label className="block">
              <span className={ET}>Código (opcional)</span>
              <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ej: BEB" className={INPUT} />
            </label>
            <label className="block">
              <span className={ET}>Categoría padre (opcional)</span>
              <Select value={padre} onChange={setPadre} block options={[["", "— ninguna —"], ...activas.map((c): [string, string] => [c.id, c.nombre])]} />
            </label>
            <button type="submit" disabled={creando || !nombre.trim()} className="inline-flex h-[42px] items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50" style={{ backgroundColor: TEAL }}>
              {creando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {creando ? "Creando..." : "Crear categoría"}
            </button>
          </form>
          {error ? <p className="mt-3 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
        </section>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b-2 text-[11px] font-bold uppercase tracking-wider" style={{ borderColor: `${TEAL}26`, backgroundColor: `${TEAL}0d`, color: TEAL }}>
                <th className="px-5 py-3">Nombre</th>
                <th className="px-3 py-3">Código</th>
                <th className="px-3 py-3">Padre</th>
                <th className="px-3 py-3 text-center">Estado</th>
                {esAdmin ? <th className="px-5 py-3 text-right">Acciones</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-sm text-slate-400">Cargando...</td></tr>
              ) : categorias.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-14 text-center">
                    <Tags className="mx-auto h-8 w-8 text-slate-300" />
                    <p className="mt-3 text-sm text-slate-500">Todavía no cargaste categorías.</p>
                  </td>
                </tr>
              ) : (
                categorias.map((c) => {
                  const col = colorCategoria(c.nombre);
                  return (
                    <tr key={c.id} className="transition-colors hover:bg-[var(--brand-50)]">
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center gap-2 font-semibold text-slate-800">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: col.dot, boxShadow: `0 0 0 3px ${col.bg}` }} />
                          {c.nombre}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-slate-500">{c.codigo ?? "—"}</td>
                      <td className="px-3 py-3 text-xs text-slate-600">{c.parent_id ? nombrePorId.get(c.parent_id) ?? "—" : "—"}</td>
                      <td className="px-3 py-3 text-center">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.activo ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{c.activo ? "Activo" : "Inactivo"}</span>
                      </td>
                      {esAdmin ? (
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-3">
                            <button onClick={() => setEditando(c)} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-[var(--brand)]">
                              <Pencil className="h-3.5 w-3.5" /> Editar
                            </button>
                            <button onClick={() => toggle(c)} disabled={toggling === c.id} className={`text-xs font-medium transition disabled:opacity-40 ${c.activo ? "text-slate-500 hover:text-amber-600" : "text-emerald-600 hover:text-emerald-700"}`}>
                              {toggling === c.id ? "..." : c.activo ? "Desactivar" : "Activar"}
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editando ? <EditarCategoria categoria={editando} categorias={categorias} onClose={() => setEditando(null)} onGuardado={() => { setEditando(null); void cargar(); }} /> : null}
    </div>
  );
}

function EditarCategoria({ categoria, categorias, onClose, onGuardado }: { categoria: Categoria; categorias: Categoria[]; onClose: () => void; onGuardado: () => void }) {
  const [nombre, setNombre] = useState(categoria.nombre);
  const [codigo, setCodigo] = useState(categoria.codigo ?? "");
  const [padre, setPadre] = useState(categoria.parent_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/inventario/categorias/${categoria.id}`, {
        method: "PATCH",
        body: JSON.stringify({ nombre: nombre.trim(), codigo: codigo.trim() || null, parent_id: padre || null }),
      });
      onGuardado();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[120] overflow-y-auto bg-slate-900/40 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <div className="flex min-h-full items-center justify-center p-4">
        <form onSubmit={guardar} onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-900/5" style={{ animation: "rb-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
          <h3 className="text-lg font-semibold text-slate-900">Editar categoría</h3>
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className={ET}>Nombre</span>
              <input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} required className={INPUT} />
            </label>
            <label className="block">
              <span className={ET}>Código (opcional)</span>
              <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ej: HERR" className={INPUT} />
            </label>
            <label className="block">
              <span className={ET}>Categoría padre (opcional)</span>
              <Select value={padre} onChange={setPadre} block options={[["", "— ninguna —"], ...categorias.filter((c) => c.activo && c.id !== categoria.id).map((c): [string, string] => [c.id, c.nombre])]} />
            </label>
          </div>
          {error ? <p className="mt-3 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
            <button type="submit" disabled={busy || !nombre.trim()} className="rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50" style={{ backgroundColor: TEAL }}>
              {busy ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
