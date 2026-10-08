"use client";

/**
 * /inventario/categorias — Categorías de productos en LISTA LIMPIA: una fila por categoría
 * con su color, sus subcategorías como etiquetas (del mismo color) y la cantidad de
 * productos. Al tocar la categoría se despliega su árbol (subcategorías y cuántos productos tienen).
 * Las acciones viven en el menú ⋯ (y en cada etiqueta), así la pantalla no se
 * llena de botones repetidos. Dos niveles: Bebidas › Gaseosas.
 * No hay borrado (como Ferretería): una categoría con productos se desactiva.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { Ban, CheckCircle2, ChevronRight, Loader2, MoreHorizontal, Palette, Pencil, Plus, Search, Tags, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { ColorPicker } from "@/components/ColorPicker";
import { MenuAcciones, type ItemMenu } from "@/components/MenuAcciones";
import { ArbolCategoria } from "@/modules/inventario/ArbolCategoria";
import { colorLibre, coloresPorCategoria, tonosDe, type Categoria } from "@/modules/inventario/categorias";

const TEAL = clienteConfig.color;
const INPUT = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
const ET = "mb-1 block text-xs font-medium text-slate-600";

/** El contenedor que scrollea (en el layout es el <main>, no la ventana). */
function contenedorScroll(el: HTMLElement): HTMLElement {
  let e: HTMLElement | null = el.parentElement;
  while (e) {
    const o = getComputedStyle(e).overflowY;
    if (o === "auto" || o === "scroll") return e;
    e = e.parentElement;
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

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
  const [busqueda, setBusqueda] = useState("");
  const [agregandoEn, setAgregandoEn] = useState<string | null>(null);
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const relleno = useRef<HTMLDivElement>(null);

  // "+ Subcategoría": abre el árbol de la categoría y suma una rama para escribir la nueva.
  function agregarSub(id: string) {
    setAgregandoEn(id);
    setAbiertas((s) => new Set(s).add(id));
  }

  // Al CERRAR un árbol la página se achica y el navegador sube la vista sola (la fila
  // tocada salta). Para que no pase: se mide la fila antes y después y, si se movió, se
  // agrega espacio abajo y se corrige el scroll, así queda exactamente donde estaba.
  function alternar(id: string, fila?: HTMLElement) {
    const cerrando = abiertas.has(id);
    if (cerrando && agregandoEn === id) setAgregandoEn(null);
    const cambiar = () => setAbiertas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const sc = fila ? contenedorScroll(fila) : null;
    if (!cerrando || !fila || !sc || !relleno.current) { cambiar(); return; }
    const antes = fila.getBoundingClientRect().top;
    flushSync(cambiar);
    const corrimiento = fila.getBoundingClientRect().top - antes;
    if (corrimiento > 0.5) {
      relleno.current.style.height = `${relleno.current.offsetHeight + corrimiento}px`;
      sc.scrollTop += corrimiento;
    }
  }

  // El espacio extra se va solo a medida que el usuario sube: se saca solo lo que sobra
  // por encima del scroll actual, así sacarlo nunca mueve la vista.
  useEffect(() => {
    const el = relleno.current;
    const sc = el ? contenedorScroll(el) : null;
    if (!el || !sc) return;
    const recortar = () => {
      const h = el.offsetHeight;
      if (!h) return;
      // Arriba de todo no hay nada que mover; si no, solo lo que queda debajo del scroll.
      if (sc.scrollTop <= 0) { el.style.height = "0px"; return; }
      const sobra = sc.scrollHeight - sc.clientHeight - sc.scrollTop;
      if (sobra > 0) el.style.height = `${Math.max(0, h - sobra)}px`;
    };
    let frame = 0;
    const alScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(recortar); };
    sc.addEventListener("scroll", alScroll, { passive: true });
    sc.addEventListener("scrollend", recortar);
    return () => { cancelAnimationFrame(frame); sc.removeEventListener("scroll", alScroll); sc.removeEventListener("scrollend", recortar); };
  }, []);

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

  async function crearCategoria(nombreNuevo: string, parentId: string | null, color: string | null = null) {
    await apiFetch("/api/inventario/categorias", {
      method: "POST",
      body: JSON.stringify({ nombre: nombreNuevo.trim(), parent_id: parentId, color: parentId ? null : color }),
    });
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
    setError(null);
    try {
      await apiFetch(`/api/inventario/categorias/${c.id}`, { method: "PATCH", body: JSON.stringify({ activo: !c.activo }) });
      await cargar();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Principales ordenadas con sus subcategorías. Una sub cuya madre no está (datos viejos)
  // se muestra como principal para que no desaparezca.
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
    return arbol.filter(({ cat, hijas }) => sinTildes(cat.nombre).includes(q) || hijas.some((h) => sinTildes(h.nombre).includes(q)));
  }, [arbol, q]);

  const principalesActivas = categorias.filter((c) => !c.parent_id && c.activo);
  const padreElegido = principalesActivas.find((c) => c.id === padre);
  const colorElegido = colorNuevo ?? colorLibre(categorias);
  const totalSubs = categorias.filter((c) => c.parent_id).length;
  const hexDe = (id: string) => colores.get(id)?.dot ?? "#94a3b8";

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
          <form onSubmit={crear} className="grid gap-3 sm:grid-cols-[2fr_1.5fr_1fr_auto] sm:items-end">
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
            <div>
              <span className={ET}>Color</span>
              {padreElegido ? (
                <p className="flex h-[42px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs text-slate-500" title="Las subcategorías usan el color de su categoría">
                  <span className="h-4 w-4 shrink-0 rounded-md" style={{ backgroundColor: hexDe(padreElegido.id) }} />
                  El de {padreElegido.nombre}
                </p>
              ) : (
                <ColorPicker value={colorElegido} onChange={setColorNuevo} block />
              )}
            </div>
            <button type="submit" disabled={creando || !nombre.trim()} className="inline-flex h-[42px] items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50" style={{ backgroundColor: TEAL }}>
              {creando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {creando ? "Creando..." : padreElegido ? "Crear subcategoría" : "Crear categoría"}
            </button>
          </form>
          {padreElegido && nombre.trim() ? (
            <p className="mt-2 text-[11px] text-slate-400">Va a quedar como <strong className="font-semibold text-slate-600">{padreElegido.nombre} › {nombre.trim()}</strong></p>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <div className="flex items-start justify-between gap-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Cerrar" className="text-rose-400 hover:text-rose-600"><X className="h-4 w-4" /></button>
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar categoría o subcategoría..." className={`${INPUT} pl-9`} />
          </div>
          <p className="text-xs text-slate-500">
            {arbol.length} {arbol.length === 1 ? "categoría" : "categorías"} · {totalSubs} {totalSubs === 1 ? "subcategoría" : "subcategorías"}
          </p>
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
              const hex = hexDe(cat.id);
              const tono = tonosDe(hex);
              const abierta = abiertas.has(cat.id);
              const total = (conteo[cat.id] ?? 0) + hijas.reduce((a, h) => a + (conteo[h.id] ?? 0), 0);
              const menu: ItemMenu[] = [
                ...(cat.activo && !cat.parent_id ? [{ etiqueta: "Agregar subcategoría", icono: <Plus className="h-4 w-4" />, onClick: () => agregarSub(cat.id) }] : []),
                { etiqueta: "Editar", icono: <Pencil className="h-4 w-4" />, onClick: () => setEditando(cat) },
                ...(!cat.parent_id ? [{ etiqueta: "Cambiar color", icono: <Palette className="h-4 w-4" />, onClick: () => setEditando(cat) }] : []),
                cat.activo
                  ? { etiqueta: "Desactivar", icono: <Ban className="h-4 w-4" />, onClick: () => toggle(cat), tono: "peligro" as const }
                  : { etiqueta: "Activar", icono: <CheckCircle2 className="h-4 w-4" />, onClick: () => toggle(cat), tono: "exito" as const },
              ];
              return (
                <li key={cat.id}>
                  <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors hover:bg-slate-50/70 ${abierta ? "bg-slate-50/70" : ""}`}>
                  {/* Nombre y cantidad: al tocarlo se despliega el árbol de la categoría */}
                  <button
                    type="button"
                    onClick={(e) => alternar(cat.id, e.currentTarget)}
                    aria-expanded={abierta}
                    title={abierta ? "Ocultar subcategorías" : "Ver subcategorías"}
                    className={`group flex w-full min-w-0 items-center gap-3 text-left sm:w-56 ${cat.activo ? "" : "opacity-50"}`}
                  >
                    <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 group-hover:text-slate-700 ${abierta ? "rotate-90" : ""}`} />
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: hex, boxShadow: `0 0 0 4px ${tono.fondo}` }} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        <Resaltado texto={cat.nombre} q={q} />
                        {!cat.activo ? <EtiquetaInactiva /> : null}
                      </p>
                      <p className="text-xs text-slate-500">{nProductos(total)}</p>
                    </div>
                  </button>

                  {/* Cerrada: las subcategorías como etiquetas. Abierta: se ven en el árbol de abajo. */}
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    {abierta ? null : hijas.length ? (
                      hijas.map((h) => (
                        <EtiquetaSub
                          key={h.id}
                          sub={h}
                          tono={tono}
                          cantidad={conteo[h.id] ?? 0}
                          q={q}
                          esAdmin={esAdmin}
                          onEditar={() => setEditando(h)}
                          onToggle={() => toggle(h)}
                        />
                      ))
                    ) : (
                      <span className="text-xs text-slate-400">Sin subcategorías</span>
                    )}
                  </div>

                  {esAdmin ? (
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                      {cat.activo && !cat.parent_id ? (
                        <button
                          onClick={() => agregarSub(cat.id)}
                          className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
                        >
                          <Plus className="h-3 w-3" /> Subcategoría
                        </button>
                      ) : null}
                      <MenuAcciones
                        items={menu}
                        etiqueta={`Acciones de ${cat.nombre}`}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                      >
                        <MoreHorizontal className="h-5 w-5" />
                      </MenuAcciones>
                    </div>
                  ) : null}
                  </div>
                  {abierta ? (
                    <div className="border-t border-slate-100 bg-slate-50/60 sm:pl-10">
                      <ArbolCategoria
                        categoria={cat}
                        hijas={hijas}
                        conteo={conteo}
                        tono={tono}
                        renderSub={(h) => (
                          <EtiquetaSub
                            sub={h}
                            tono={tono}
                            q={q}
                            esAdmin={esAdmin}
                            onEditar={() => setEditando(h)}
                            onToggle={() => toggle(h)}
                          />
                        )}
                        extra={
                          agregandoEn === cat.id ? (
                            <NuevaSub
                              madre={cat.nombre}
                              onCancelar={() => setAgregandoEn(null)}
                              onCrear={async (n) => { await crearCategoria(n, cat.id); setAgregandoEn(null); }}
                            />
                          ) : undefined
                        }
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div ref={relleno} aria-hidden style={{ height: 0 }} />

      {editando ? (
        <EditarCategoria
          categoria={editando}
          categorias={categorias}
          colorActual={colores.get(editando.id)?.dot}
          onClose={() => setEditando(null)}
          onGuardado={() => { setEditando(null); void cargar(); }}
        />
      ) : null}
    </div>
  );
}

/** Subcategoría como etiqueta del color de su categoría; al tocarla, sus acciones. */
function EtiquetaSub({ sub, tono, cantidad, q, esAdmin, onEditar, onToggle }: {
  sub: Categoria;
  tono: ReturnType<typeof tonosDe>;
  cantidad?: number;
  q: string;
  esAdmin: boolean;
  onEditar: () => void;
  onToggle: () => void;
}) {
  const coincide = !!q && sinTildes(sub.nombre).includes(q);
  const contenido = (
    <>
      <Resaltado texto={sub.nombre} q={q} />
      {cantidad !== undefined ? <span className="font-normal opacity-70">· {cantidad}</span> : null}
      {!sub.activo ? <span className="font-normal opacity-70">(inactiva)</span> : null}
    </>
  );
  const estilo = {
    backgroundColor: sub.activo ? tono.fondo : "transparent",
    borderColor: coincide ? tono.dot : tono.borde,
    color: tono.texto,
  };
  const clase = `inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${sub.activo ? "" : "border-dashed opacity-60"}`;
  if (!esAdmin) return <span className={clase} style={estilo}>{contenido}</span>;
  return (
    <MenuAcciones
      etiqueta={`Acciones de ${sub.nombre}`}
      className={`${clase} hover:brightness-95`}
      style={estilo}
      items={[
        { etiqueta: "Editar", icono: <Pencil className="h-4 w-4" />, onClick: onEditar },
        sub.activo
          ? { etiqueta: "Desactivar", icono: <Ban className="h-4 w-4" />, onClick: onToggle, tono: "peligro" }
          : { etiqueta: "Activar", icono: <CheckCircle2 className="h-4 w-4" />, onClick: onToggle, tono: "exito" },
      ]}
    >
      {contenido}
    </MenuAcciones>
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

/** Campo para crear una subcategoría ahí mismo, en la fila. Enter crea, Esc cancela. */
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
    <form onSubmit={enviar} className="flex flex-wrap items-center gap-1.5">
      <input
        ref={ref}
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") onCancelar(); }}
        placeholder={`Nueva en ${madre}`}
        className="w-48 rounded-full border border-[var(--brand)] px-3 py-1 text-xs outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
      />
      <button type="submit" disabled={busy || !nombre.trim()} className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold text-white transition hover:brightness-95 disabled:opacity-50" style={{ backgroundColor: TEAL }}>
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Agregar
      </button>
      <button type="button" onClick={onCancelar} className="rounded-full px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100">Cancelar</button>
      {error ? <span className="w-full text-xs text-rose-600">{error}</span> : null}
    </form>
  );
}

function EditarCategoria({ categoria, categorias, colorActual, onClose, onGuardado }: {
  categoria: Categoria;
  categorias: Categoria[];
  colorActual?: string;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [nombre, setNombre] = useState(categoria.nombre);
  const [codigo, setCodigo] = useState(categoria.codigo ?? "");
  const [padre, setPadre] = useState(categoria.parent_id ?? "");
  const [color, setColor] = useState(categoria.color ?? colorActual ?? "#3b82f6");
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
                <ColorPicker value={color} onChange={setColor} block />
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
