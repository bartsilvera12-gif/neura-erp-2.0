"use client";

/**
 * /inventario/categorias — Categorías de productos en ÁRBOL: cada categoría con sus
 * subcategorías debajo (dos niveles: Bebidas › Gaseosas), plegables, con la cantidad de
 * productos y un "+ Subcategoría" en la misma fila para crearla ahí mismo.
 * No hay borrado (como Ferretería): una categoría con productos se desactiva.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight, CornerDownRight, Loader2, Pencil, Plus, Search, Tags, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { colorCategoria, colorLibre, coloresPorCategoria, PALETA, type Categoria, type ColorCategoria } from "@/modules/inventario/categorias";

const TEAL = clienteConfig.color;
const INPUT = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
const ET = "mb-1 block text-xs font-medium text-slate-600";

const sinTildes = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const nProductos = (n: number) => (n === 1 ? "1 producto" : `${n} productos`);

export default function CategoriasPage() {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [conteo, setConteo] = useState<Record<string, number>>({});
  const [cargando, setCargando] = useState(true);
  const [esAdmin, setEsAdmin] = useState(false);
  const [nombre, setNombre] = useState("");
  const [padre, setPadre] = useState("");
  const [colorNuevo, setColorNuevo] = useState<string | null>(null); // null = el libre que propone el sistema
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<Categoria | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [cerradas, setCerradas] = useState<Set<string>>(new Set());
  const [busqueda, setBusqueda] = useState("");
  const [agregandoEn, setAgregandoEn] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await apiFetch<{ categorias: Categoria[]; conteo?: Record<string, number> }>("/api/inventario/categorias?todas=1&conteo=1");
      setCategorias(r.categorias);
      setConteo(r.conteo ?? {});
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
    apiFetch<{ rol: string }>("/api/me").then((m) => setEsAdmin(m.rol === "ADMIN")).catch(() => {});
  }, [cargar]);

  const abrir = (id: string) => setCerradas((s) => { const n = new Set(s); n.delete(id); return n; });
  const alternar = (id: string) => setCerradas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function crearCategoria(nombreNuevo: string, parentId: string | null, color: string | null = null) {
    await apiFetch("/api/inventario/categorias", {
      method: "POST",
      body: JSON.stringify({ nombre: nombreNuevo.trim(), parent_id: parentId, color: parentId ? null : color }),
    });
    if (parentId) abrir(parentId);
    await cargar();
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setCreando(true);
    setError(null);
    try {
      await crearCategoria(nombre, padre || null, colorElegido);
      setNombre("");
      setColorNuevo(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreando(false);
    }
  }

  async function toggle(c: Categoria) {
    setToggling(c.id);
    setError(null);
    try {
      await apiFetch(`/api/inventario/categorias/${c.id}`, { method: "PATCH", body: JSON.stringify({ activo: !c.activo }) });
      await cargar();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setToggling(null);
    }
  }

  // Árbol: principales ordenadas y, debajo, sus subcategorías. Una sub cuya madre no está
  // (datos viejos) se muestra como principal para que no desaparezca.
  const arbol = useMemo(() => {
    const ids = new Set(categorias.map((c) => c.id));
    const orden = [...categorias].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    const raices = orden.filter((c) => !c.parent_id || !ids.has(c.parent_id));
    return raices.map((r) => ({ cat: r, hijas: orden.filter((c) => c.parent_id === r.id) }));
  }, [categorias]);

  const colores = useMemo(() => coloresPorCategoria(categorias), [categorias]);
  const q = sinTildes(busqueda.trim());
  const visibles = useMemo(() => {
    if (!q) return arbol;
    return arbol
      .map(({ cat, hijas }) => {
        const madreCoincide = sinTildes(cat.nombre).includes(q);
        return { cat, hijas: madreCoincide ? hijas : hijas.filter((h) => sinTildes(h.nombre).includes(q)), madreCoincide };
      })
      .filter((g) => g.madreCoincide || g.hijas.length > 0);
  }, [arbol, q]);

  const principalesActivas = categorias.filter((c) => !c.parent_id && c.activo);
  const padreElegido = principalesActivas.find((c) => c.id === padre);
  const colorElegido = colorNuevo ?? colorLibre(categorias);
  const totalSubs = categorias.filter((c) => c.parent_id).length;
  const conHijas = arbol.filter((g) => g.hijas.length > 0).map((g) => g.cat.id);
  const todoAbierto = conHijas.every((id) => !cerradas.has(id));

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Operaciones · Stock</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Categorías de productos</h1>
          <p className="mt-1 text-sm text-slate-500">
            Ordená tus productos en categorías y, si querés, en subcategorías. Ej: <strong className="font-semibold text-slate-700">Bebidas › Gaseosas</strong>.
          </p>
        </div>
        <Link href="/inventario" className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50">Inventario</Link>
      </header>

      {esAdmin ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="block h-5 w-1 rounded-full" style={{ backgroundColor: TEAL }} />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">Nueva categoría</h2>
          </div>
          <form onSubmit={crear} className="grid gap-3 sm:grid-cols-[2fr_1.5fr_auto] sm:items-end">
            <label className="block">
              <span className={ET}>Nombre</span>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} required placeholder={padreElegido ? "Ej: Gaseosas" : "Ej: Bebidas"} className={INPUT} />
            </label>
            <label className="block">
              <span className={ET}>Ubicación</span>
              <Select
                value={padre}
                onChange={setPadre}
                block
                options={[["", "Es una categoría principal"], ...principalesActivas.map((c): [string, string] => [c.id, `Dentro de ${c.nombre}`])]}
              />
            </label>
            <button type="submit" disabled={creando || !nombre.trim()} className="inline-flex h-[42px] items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50" style={{ backgroundColor: TEAL }}>
              {creando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {creando ? "Creando..." : padreElegido ? "Crear subcategoría" : "Crear categoría"}
            </button>
            <div className="sm:col-span-3">
              <span className={ET}>Color</span>
              {padreElegido ? (
                <p className="flex items-center gap-2 py-1 text-xs text-slate-500">
                  <Punto col={colores.get(padreElegido.id) ?? colorCategoria(padreElegido.nombre)} />
                  Usa el color de {padreElegido.nombre}
                </p>
              ) : (
                <SelectorColor valor={colorElegido} onChange={setColorNuevo} />
              )}
            </div>
          </form>
          <p className="mt-2 text-[11px] text-slate-400">
            {padreElegido && nombre.trim() ? (
              <>Va a quedar como <strong className="font-semibold text-slate-600">{padreElegido.nombre} › {nombre.trim()}</strong></>
            ) : (
              <>También podés tocar <strong className="font-semibold text-slate-600">+ Subcategoría</strong> en cualquier categoría de la lista.</>
            )}
          </p>
        </section>
      ) : null}

      {error ? (
        <div className="flex items-start justify-between gap-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Cerrar" className="text-rose-400 hover:text-rose-600"><X className="h-4 w-4" /></button>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar categoría o subcategoría..." className={`${INPUT} pl-9`} />
          </div>
          <p className="text-xs text-slate-500">
            {arbol.length} {arbol.length === 1 ? "categoría" : "categorías"} · {totalSubs} {totalSubs === 1 ? "subcategoría" : "subcategorías"}
          </p>
          {conHijas.length > 0 && !q ? (
            <button
              onClick={() => setCerradas(todoAbierto ? new Set(conHijas) : new Set())}
              className="rounded-lg px-2 py-1 text-xs font-semibold text-[var(--brand)] transition hover:bg-[var(--brand-50)]"
            >
              {todoAbierto ? "Cerrar todas" : "Abrir todas"}
            </button>
          ) : null}
        </div>

        {cargando ? (
          <p className="px-5 py-12 text-center text-sm text-slate-400">Cargando...</p>
        ) : categorias.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <Tags className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm text-slate-500">Todavía no cargaste categorías. Creá la primera arriba.</p>
          </div>
        ) : visibles.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-400">Ninguna categoría coincide con «{busqueda}».</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visibles.map(({ cat, hijas }) => {
              const col = colores.get(cat.id) ?? colorCategoria(cat.nombre);
              const abierta = !!q || !cerradas.has(cat.id);
              const total = (conteo[cat.id] ?? 0) + hijas.reduce((a, h) => a + (conteo[h.id] ?? 0), 0);
              const tieneHijas = hijas.length > 0;
              return (
                <li key={cat.id}>
                  {/* Categoría principal */}
                  <div className={`flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-[var(--brand-50)] sm:px-5 ${cat.activo ? "" : "opacity-60"}`}>
                    <button
                      onClick={() => tieneHijas && alternar(cat.id)}
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition ${tieneHijas ? "hover:bg-white hover:text-slate-700" : "invisible"}`}
                      aria-label={abierta ? `Cerrar ${cat.nombre}` : `Abrir ${cat.nombre}`}
                    >
                      {abierta ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    {esAdmin ? (
                      <button onClick={() => setEditando(cat)} title="Cambiar color" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition hover:scale-125">
                        <Punto col={col} />
                      </button>
                    ) : (
                      <Punto col={col} />
                    )}
                    <button onClick={() => tieneHijas && alternar(cat.id)} className={`min-w-0 flex-1 text-left ${tieneHijas ? "cursor-pointer" : "cursor-default"}`}>
                      <p className="truncate text-sm font-bold text-slate-900">
                        <Resaltado texto={cat.nombre} q={q} />
                        {!cat.activo ? <EtiquetaInactiva /> : null}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {nProductos(total)}
                        {tieneHijas ? ` · ${hijas.length} ${hijas.length === 1 ? "subcategoría" : "subcategorías"}` : ""}
                      </p>
                    </button>
                    {esAdmin ? (
                      <div className="flex shrink-0 items-center gap-1">
                        {cat.activo && !cat.parent_id ? (
                          <button
                            onClick={() => { setAgregandoEn(cat.id); abrir(cat.id); }}
                            className="inline-flex items-center gap-1 rounded-lg border border-[var(--brand)] px-2.5 py-1 text-xs font-semibold text-[var(--brand)] transition hover:bg-white"
                          >
                            <Plus className="h-3.5 w-3.5" /> Subcategoría
                          </button>
                        ) : null}
                        <Acciones c={cat} toggling={toggling === cat.id} onEditar={() => setEditando(cat)} onToggle={() => toggle(cat)} />
                      </div>
                    ) : null}
                  </div>

                  {/* Subcategorías */}
                  {abierta && (tieneHijas || agregandoEn === cat.id) ? (
                    <ul className="pb-2">
                      {hijas.map((h) => (
                        <li key={h.id} className={`flex items-center gap-2 py-2 pl-12 pr-3 transition-colors hover:bg-[var(--brand-50)] sm:pl-16 sm:pr-5 ${h.activo ? "" : "opacity-60"}`}>
                          <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-700">
                              <Resaltado texto={h.nombre} q={q} />
                              {!h.activo ? <EtiquetaInactiva /> : null}
                            </p>
                            <p className="text-[11px] text-slate-500">{nProductos(conteo[h.id] ?? 0)}</p>
                          </div>
                          {esAdmin ? <Acciones c={h} toggling={toggling === h.id} onEditar={() => setEditando(h)} onToggle={() => toggle(h)} /> : null}
                        </li>
                      ))}
                      {agregandoEn === cat.id ? (
                        <NuevaSub
                          madre={cat.nombre}
                          onCancelar={() => setAgregandoEn(null)}
                          onCrear={async (n) => { await crearCategoria(n, cat.id); setAgregandoEn(null); }}
                        />
                      ) : null}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editando ? <EditarCategoria categoria={editando} categorias={categorias} colorActual={colores.get(editando.id)} onClose={() => setEditando(null)} onGuardado={() => { setEditando(null); void cargar(); }} /> : null}
    </div>
  );
}

function Acciones({ c, toggling, onEditar, onToggle }: { c: Categoria; toggling: boolean; onEditar: () => void; onToggle: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button onClick={onEditar} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-white hover:text-[var(--brand)]">
        <Pencil className="h-3.5 w-3.5" /> Editar
      </button>
      <button onClick={onToggle} disabled={toggling} className={`rounded-lg px-2 py-1 text-xs font-medium transition hover:bg-white disabled:opacity-40 ${c.activo ? "text-slate-500 hover:text-amber-600" : "text-emerald-600 hover:text-emerald-700"}`}>
        {toggling ? "..." : c.activo ? "Desactivar" : "Activar"}
      </button>
    </div>
  );
}

function Punto({ col }: { col: ColorCategoria }) {
  return <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: col.dot, boxShadow: `0 0 0 3px ${col.bg}` }} />;
}

/** Fila de colores para elegir con un toque; el elegido lleva un check. */
function SelectorColor({ valor, onChange }: { valor: string; onChange: (hex: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 py-1" role="radiogroup" aria-label="Color de la categoría">
      {PALETA.map((p) => {
        const sel = p.dot.toLowerCase() === valor.toLowerCase();
        return (
          <button
            key={p.dot}
            type="button"
            role="radio"
            aria-checked={sel}
            onClick={() => onChange(p.dot)}
            className="flex h-8 w-8 items-center justify-center rounded-full transition hover:scale-110"
            style={{ backgroundColor: p.dot, boxShadow: sel ? `0 0 0 2px #fff, 0 0 0 4px ${p.dot}` : undefined }}
          >
            {sel ? <Check className="h-4 w-4 text-white" strokeWidth={3} /> : null}
          </button>
        );
      })}
    </div>
  );
}

function EtiquetaInactiva() {
  return <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-slate-500">Inactiva</span>;
}

/** Marca en el nombre lo que coincide con la búsqueda. */
function Resaltado({ texto, q }: { texto: string; q: string }) {
  if (!q) return <>{texto}</>;
  const i = sinTildes(texto).indexOf(q);
  if (i < 0) return <>{texto}</>;
  return (
    <>
      {texto.slice(0, i)}
      <mark className="rounded bg-amber-100 px-0.5 text-inherit">{texto.slice(i, i + q.length)}</mark>
      {texto.slice(i + q.length)}
    </>
  );
}

/** Fila para crear una subcategoría ahí mismo, debajo de su categoría. Enter crea, Esc cancela. */
function NuevaSub({ madre, onCrear, onCancelar }: { madre: string; onCrear: (nombre: string) => Promise<void>; onCancelar: () => void }) {
  const [nombre, setNombre] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCrear(nombre);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <li className="py-2 pl-12 pr-3 sm:pl-16 sm:pr-5">
      <form onSubmit={enviar} className="flex flex-wrap items-center gap-2">
        <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
        <input
          ref={ref}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") onCancelar(); }}
          placeholder={`Nueva subcategoría de ${madre}`}
          className={`${INPUT} min-w-[200px] flex-1 py-2`}
        />
        <button type="submit" disabled={busy || !nombre.trim()} className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50" style={{ backgroundColor: TEAL }}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Agregar
        </button>
        <button type="button" onClick={onCancelar} className="rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancelar</button>
      </form>
      {error ? <p className="mt-1.5 pl-6 text-xs text-rose-600">{error}</p> : null}
    </li>
  );
}

function EditarCategoria({ categoria, categorias, colorActual, onClose, onGuardado }: { categoria: Categoria; categorias: Categoria[]; colorActual?: ColorCategoria; onClose: () => void; onGuardado: () => void }) {
  const [nombre, setNombre] = useState(categoria.nombre);
  const [codigo, setCodigo] = useState(categoria.codigo ?? "");
  const [padre, setPadre] = useState(categoria.parent_id ?? "");
  const [color, setColor] = useState(categoria.color ?? colorActual?.dot ?? PALETA[0].dot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Dos niveles: una categoría con subcategorías no puede quedar dentro de otra.
  const tieneHijas = categorias.some((c) => c.parent_id === categoria.id);

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
        body: JSON.stringify({ nombre: nombre.trim(), codigo: codigo.trim() || null, parent_id: padre || null, color: padre ? null : color }),
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
          <h3 className="text-lg font-semibold text-slate-900">{categoria.parent_id ? "Editar subcategoría" : "Editar categoría"}</h3>
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className={ET}>Nombre</span>
              <input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} required className={INPUT} />
            </label>
            <label className="block">
              <span className={ET}>Ubicación</span>
              {tieneHijas ? (
                <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500">Categoría principal (tiene subcategorías adentro)</p>
              ) : (
                <Select
                  value={padre}
                  onChange={setPadre}
                  block
                  options={[["", "Es una categoría principal"], ...categorias.filter((c) => !c.parent_id && c.activo && c.id !== categoria.id).map((c): [string, string] => [c.id, `Dentro de ${c.nombre}`])]}
                />
              )}
            </label>
            {padre ? (
              <p className="text-xs text-slate-500">Como subcategoría, usa el color de su categoría.</p>
            ) : (
              <div>
                <span className={ET}>Color</span>
                <SelectorColor valor={color} onChange={setColor} />
              </div>
            )}
            <label className="block">
              <span className={ET}>Código <span className="font-normal text-slate-400">(opcional)</span></span>
              <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ej: BEB" className={INPUT} />
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
