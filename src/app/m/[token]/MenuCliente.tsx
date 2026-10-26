"use client";

/**
 * Menú de la mesa en el celular del cliente (mobile-first): categorías desplegables (acordeón:
 * nombre + cantidad de productos; con pocas categorías arranca abierta la primera, con muchas
 * todas cerradas; "Otros" va al final; al buscar se abren las que tienen resultados), productos
 * con foto y precio, carrito (con nota por producto y nota general), nombre opcional y "Enviar pedido".
 * Después de enviar, "Tus pedidos" muestra el estado de cada uno (consulta cada 5 s mientras
 * haya alguno en curso). Los códigos de seguimiento se guardan en este celular (localStorage).
 * Precios y total los pone el servidor: lo que se ve acá es solo una vista previa.
 * Receta 73: un plato con modificadores (quitar / extras / opciones) abre una hoja para elegirlos;
 * cada combinación distinta es una línea propia del carrito con su resumen ("sin cebolla · + extra queso").
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChefHat, ChevronDown, Clock3, Loader2, MessageSquareText, Minus, Plus, Receipt, Search, ShoppingBag, Trash2, X, XCircle } from "lucide-react";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import type { EstadoPedidoPublico, MenuMesa, ProductoMenu } from "@/modules/mesas/publico";
import { ESTADOS_PEDIDO, gs, horaCorta } from "@/modules/mesas/tipos";
import { HojaModificadores, type ResultadoMods } from "@/modules/mesas/HojaModificadores";
import { ModsDetalle } from "@/modules/mesas/ModsDetalle";
import { modsParaEnviar, partesSel, tieneMods, type ModsSeleccion } from "@/modules/mesas/modificadores";

type Menu = Extract<MenuMesa, { activa: true }>;
/** Línea del carrito. Clave = `${producto_id}|${clave de modificadores}` (misma combinación = misma línea). */
type Linea = { producto_id: string; cantidad: number; nota: string; sel?: ModsSeleccion; precio_mods?: number };
const claveLinea = (id: string, clave = "") => `${id}|${clave}`;

const CLAVE = (token: string) => `neura.mesa.${token.slice(0, 16)}.pedidos`;
const FINALES = new Set(["entregado", "rechazado"]);

function leerSeguimientos(token: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE(token)) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(-20) : [];
  } catch {
    return [];
  }
}
function guardarSeguimientos(token: string, segs: string[]) {
  try {
    localStorage.setItem(CLAVE(token), JSON.stringify(segs.slice(-20)));
  } catch { /* sin storage: el estado se ve mientras la página siga abierta */ }
}

export function MenuCliente({ token, menu, color, logoInstalacion }: { token: string; menu: Menu; color: string; logoInstalacion: string }) {
  const [carrito, setCarrito] = useState<Record<string, Linea>>({});
  const [verCarrito, setVerCarrito] = useState(false);
  const [q, setQ] = useState("");
  const [nota, setNota] = useState("");
  const [nombre, setNombre] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState<number | null>(null);
  const [segs, setSegs] = useState<string[]>([]);
  const [pedidos, setPedidos] = useState<EstadoPedidoPublico[]>([]);
  const enviandoRef = useRef(false);
  // Hoja de modificadores: el plato y, si se está cambiando una línea, su clave.
  const [hoja, setHoja] = useState<{ p: ProductoMenu; editar?: string } | null>(null);

  const porId = useMemo(() => new Map(menu.productos.map((p) => [p.id, p])), [menu.productos]);
  const buscando = q.trim() !== "";
  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (!t) return menu.productos;
    return menu.productos.filter((p) =>
      `${p.nombre} ${p.descripcion ?? ""} ${p.categoria}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(t));
  }, [menu.productos, q]);
  // Grupos por categoría en el orden del servidor; "Otros" (sin categoría) siempre al final.
  const grupos = useMemo(() => {
    const m = new Map<string, ProductoMenu[]>();
    for (const p of filtrados) m.set(p.categoria, [...(m.get(p.categoria) ?? []), p]);
    return [...m.entries()].sort((a, b) => Number(a[0] === "Otros") - Number(b[0] === "Otros"));
  }, [filtrados]);
  // Acordeón: con pocas categorías arranca abierta la primera; con muchas, todas cerradas (la
  // lista de nombres sirve de índice y no hay que bajar tanto en el celular).
  const totalCategorias = useMemo(() => new Set(menu.productos.map((p) => p.categoria)).size, [menu.productos]);
  const [abiertas, setAbiertas] = useState<Set<string>>(() => {
    if (totalCategorias > 6) return new Set();
    const primera = [...new Set(menu.productos.map((p) => p.categoria))].sort((a, b) => Number(a === "Otros") - Number(b === "Otros"))[0];
    return new Set(primera ? [primera] : []);
  });
  const alternar = (c: string) => setAbiertas((s) => {
    const n = new Set(s);
    if (n.has(c)) n.delete(c); else n.add(c);
    return n;
  });

  const lineas = Object.entries(carrito).filter(([, l]) => l.cantidad > 0 && porId.has(l.producto_id));
  const unidades = lineas.reduce((a, [, l]) => a + l.cantidad, 0);
  const total = lineas.reduce((a, [, l]) => a + l.cantidad * ((porId.get(l.producto_id)?.precio ?? 0) + (l.precio_mods ?? 0)), 0);
  /** Unidades de un plato en el pedido (sumando todas sus combinaciones). */
  const cantidadDe = (id: string) => lineas.reduce((a, [, l]) => a + (l.producto_id === id ? l.cantidad : 0), 0);

  // `clave` = la de la línea; un plato sin modificadores usa `${id}|`.
  const cambiar = (clave: string, delta: number, productoId?: string) =>
    setCarrito((c) => {
      const actual = c[clave]?.cantidad ?? 0;
      const n = Math.max(0, Math.min(50, actual + delta));
      const sig = { ...c };
      if (n === 0) delete sig[clave];
      else sig[clave] = { ...(c[clave] ?? { producto_id: productoId ?? clave.split("|")[0], nota: "" }), cantidad: n };
      return sig;
    });
  const notaLinea = (clave: string, v: string) => setCarrito((c) => (c[clave] ? { ...c, [clave]: { ...c[clave], nota: v.slice(0, 200) } } : c));
  // Hoja de modificadores: agrega la combinación (o reemplaza la línea que se estaba cambiando).
  function confirmarHoja(p: ProductoMenu, r: ResultadoMods, editar?: string) {
    setCarrito((c) => {
      const sig = { ...c };
      const previa = editar ? sig[editar] : undefined;
      if (editar) delete sig[editar];
      const k = claveLinea(p.id, r.clave);
      const ya = sig[k];
      sig[k] = {
        producto_id: p.id,
        cantidad: Math.min(50, (ya?.cantidad ?? 0) + r.cantidad),
        nota: r.nota || ya?.nota || previa?.nota || "",
        sel: r.sel,
        precio_mods: r.precio_mods,
      };
      return sig;
    });
    setHoja(null);
  }

  // ── Estado de mis pedidos (polling cada 5 s mientras haya alguno en curso) ──
  useEffect(() => { setSegs(leerSeguimientos(token)); }, [token]);
  const consultar = useCallback(async (lista: string[]) => {
    if (!lista.length) { setPedidos([]); return; }
    try {
      const r = await fetch(`/api/publico/mesas/${token}/estado`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seguimientos: lista }), cache: "no-store",
      });
      const b = await r.json().catch(() => null);
      if (!r.ok || !b?.ok) return;
      const data = b.data as EstadoPedidoPublico[];
      // La cuenta ya se cobró: esos pedidos se dejan de seguir en este celular.
      const vigentes = data.filter((p) => !p.cuenta_cerrada);
      setPedidos(vigentes);
      // Se dejan de seguir los de esta consulta que ya no vuelven (cuenta cobrada, QR cambiado o
      // muy viejos); los que se agregaron mientras tanto quedan.
      const siguen = new Set(vigentes.map((p) => p.seguimiento));
      if (lista.some((s) => !siguen.has(s))) {
        setSegs((cur) => {
          const nuevos = cur.filter((s) => !lista.includes(s) || siguen.has(s));
          guardarSeguimientos(token, nuevos);
          return nuevos;
        });
      }
    } catch { /* sin red: se reintenta en el próximo ciclo */ }
  }, [token]);
  // Mientras la cuenta siga abierta se sigue consultando (para ver "Pediste la cuenta" y el cierre).
  const enCurso = pedidos.some((p) => !FINALES.has(p.estado) || !p.cuenta_cerrada) || (segs.length > 0 && pedidos.length === 0);
  const cuentaEnCaja = pedidos.some((p) => p.cuenta_en_caja);
  const segsRef = useRef(segs);
  segsRef.current = segs;
  const enCursoRef = useRef(enCurso);
  enCursoRef.current = enCurso;
  useEffect(() => { void consultar(segs); }, [segs, consultar]);
  const hayQueSeguir = segs.length > 0;
  useEffect(() => {
    if (!hayQueSeguir) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && enCursoRef.current) void consultar(segsRef.current);
    }, 5000);
    return () => clearInterval(id);
  }, [hayQueSeguir, consultar]);

  async function enviar() {
    if (enviandoRef.current || !lineas.length) return;
    enviandoRef.current = true;
    setEnviando(true);
    setError(null);
    try {
      const r = await fetch(`/api/publico/mesas/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: lineas.map(([, l]) => ({ producto_id: l.producto_id, cantidad: l.cantidad, nota: l.nota.trim() || null, mods: modsParaEnviar(l.sel) })),
          nota: nota.trim() || null,
          nombre: nombre.trim() || null,
        }),
      });
      const b = await r.json().catch(() => null);
      if (!r.ok || !b?.ok) throw new Error(b?.error?.message || "No se pudo enviar el pedido. Probá de nuevo.");
      const ped = b.data as { seguimiento: string; numero: number; total: number };
      const nuevos = [...segs.filter((s) => s !== ped.seguimiento), ped.seguimiento];
      guardarSeguimientos(token, nuevos);
      setSegs(nuevos);
      setCarrito({});
      setNota("");
      setVerCarrito(false);
      setEnviado(ped.numero);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  const subtitulo = [menu.zona, menu.sucursal].filter(Boolean).join(" · ");

  return (
    <div className="min-h-dvh bg-slate-50 pb-[calc(6rem+env(safe-area-inset-bottom))]" style={{ ["--brand" as string]: color }}>
      {/* Cabecera */}
      <header className="pt-safe bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 pt-3 pb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={menu.logo_url || logoInstalacion} alt="" className="h-9 w-auto max-w-[120px] shrink-0 object-contain" />
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{menu.empresa}</p>
        </div>
        <div className="mx-auto max-w-2xl px-4 pb-3">
          <div className="flex items-center gap-3 rounded-2xl px-4 py-3 text-white" style={{ backgroundColor: color }}>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/20 text-base font-bold">
              {menu.mesa.replace(/^mesa\s*/i, "").slice(0, 3) || "•"}
            </span>
            <div className="min-w-0">
              <p className="truncate text-lg font-bold leading-tight">{menu.mesa}</p>
              <p className="truncate text-xs text-white/85">{subtitulo || "Pedí desde tu celular"}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4">
        {/* Mis pedidos */}
        {enviado != null || pedidos.length > 0 ? (
          <section className="mt-3 space-y-2" aria-live="polite">
            {enviado != null ? (
              <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <p className="min-w-0 flex-1">Pedido #{enviado} enviado. La caja lo confirma en un momento.</p>
                <button type="button" onClick={() => setEnviado(null)} aria-label="Cerrar aviso" className="-m-1 p-1 text-emerald-700"><X className="h-4 w-4" /></button>
              </div>
            ) : null}
            {cuentaEnCaja ? (
              <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-900">
                <Receipt className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <p className="min-w-0 flex-1"><b>Pediste la cuenta</b> — acercate a la caja o esperá al mozo.</p>
              </div>
            ) : null}
            {pedidos.length ? <h2 className="pt-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Tus pedidos</h2> : null}
            {pedidos.map((p) => <TarjetaEstado key={p.seguimiento} p={p} />)}
          </section>
        ) : null}

        {/* Buscador chico */}
        <div className="sticky top-0 z-10 -mx-4 mt-3 bg-slate-50/95 px-4 pt-2 pb-2 backdrop-blur">
          <label className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en el menú" enterKeyHint="search"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white pr-10 pl-9 text-base outline-none focus:border-[var(--brand)]" />
            {q ? (
              <button type="button" onClick={() => setQ("")} aria-label="Limpiar búsqueda"
                className="absolute top-1/2 right-0.5 grid h-10 w-10 -translate-y-1/2 place-items-center text-slate-400"><X className="h-4 w-4" /></button>
            ) : null}
          </label>
        </div>

        {/* Productos por categoría (acordeón) */}
        {menu.productos.length === 0 ? (
          <p className="mt-8 rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">Todavía no hay productos en el menú. Pedile a quien te atiende.</p>
        ) : grupos.length === 0 ? (
          <p className="mt-8 text-center text-sm text-slate-500">No encontramos “{q}” en el menú.</p>
        ) : (
          <div className="mt-2 space-y-2.5">
            {grupos.map(([nombreCat, prods]) => {
              // Al buscar se abren todas las que tienen resultados.
              const abierta = buscando || abiertas.has(nombreCat);
              const enPedido = prods.reduce((a, p) => a + cantidadDe(p.id), 0);
              const idPanel = `cat-${nombreCat.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
              return (
                <section key={nombreCat} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <h2>
                    <button type="button" onClick={() => alternar(nombreCat)} disabled={buscando} aria-expanded={abierta} aria-controls={idPanel}
                      className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-slate-50 disabled:cursor-default">
                      <span className="min-w-0 flex-1">
                        <span className="block text-base font-bold leading-snug text-slate-900 [overflow-wrap:anywhere]">{nombreCat}</span>
                        <span className="block text-xs text-slate-500">{prods.length} producto{prods.length === 1 ? "" : "s"}</span>
                      </span>
                      {enPedido > 0 ? (
                        <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold text-white tabular-nums" style={{ backgroundColor: color }}>{enPedido} en tu pedido</span>
                      ) : null}
                      <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform duration-300 motion-reduce:transition-none ${abierta ? "rotate-180" : ""}`} aria-hidden />
                    </button>
                  </h2>
                  {/* Despliegue suave (0fr → 1fr); sin animación con prefers-reduced-motion. */}
                  <div id={idPanel} inert={!abierta}
                    className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${abierta ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                    <div className="min-h-0 overflow-hidden">
                      <ul className="grid grid-cols-1 gap-2.5 border-t border-slate-100 bg-slate-50/60 p-2.5 min-[480px]:grid-cols-2">
                        {prods.map((p) => (
                          <TarjetaProducto key={p.id} p={p} cantidad={tieneMods(p.mods) ? cantidadDe(p.id) : carrito[claveLinea(p.id)]?.cantidad ?? 0} color={color}
                            onCambiar={(d) => cambiar(claveLinea(p.id), d, p.id)} onElegir={tieneMods(p.mods) ? () => setHoja({ p }) : undefined} />
                        ))}
                      </ul>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}
        <p className="mt-8 text-center text-[11px] text-slate-400">Precios con IVA incluido. Se paga en la caja al final.</p>
      </main>

      {/* Barra del carrito */}
      {unidades > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
          <button type="button" onClick={() => { setError(null); setVerCarrito(true); }}
            className="mx-auto flex h-12 w-full max-w-2xl items-center gap-3 rounded-xl px-4 text-white shadow-sm active:scale-[0.99]" style={{ backgroundColor: color }}>
            <span className="grid h-7 min-w-7 place-items-center rounded-full bg-white/25 px-1.5 text-sm font-bold">{unidades}</span>
            <span className="flex-1 text-left text-base font-semibold">Ver pedido</span>
            <span className="text-base font-bold tabular-nums">{gs(total)}</span>
          </button>
        </div>
      ) : null}

      {/* Carrito */}
      {verCarrito ? (
        <CapaModal onClose={() => !enviando && setVerCarrito(false)}>
          <div className={`flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl ${ALTO_MAX_MODAL}`}>
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <p className="text-base font-semibold text-slate-900">Tu pedido</p>
                <p className="truncate text-xs text-slate-500">{menu.mesa}{subtitulo ? ` · ${subtitulo}` : ""}</p>
              </div>
              <button type="button" aria-label="Cerrar" onClick={() => setVerCarrito(false)} disabled={enviando} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {lineas.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">No hay productos en el pedido.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {lineas.map(([clave, l]) => {
                    const p = porId.get(l.producto_id)!;
                    const unit = p.precio + (l.precio_mods ?? 0);
                    const conMods = tieneMods(p.mods);
                    return (
                      <li key={clave} className="py-3">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-900">{p.nombre}</p>
                            {conMods && l.sel ? <ModsDetalle mods={partesSel(p.mods!, l.sel)} className="mt-0.5" /> : null}
                            <p className="text-xs tabular-nums text-slate-500">{gs(unit)} c/u · <span className="font-semibold text-slate-700">{gs(unit * l.cantidad)}</span></p>
                            {conMods ? (
                              <button type="button" onClick={() => setHoja({ p, editar: clave })} className="mt-1 inline-flex min-h-8 items-center text-xs font-semibold" style={{ color }}>
                                Cambiar
                              </button>
                            ) : null}
                          </div>
                          <Contador cantidad={l.cantidad} color={color} onCambiar={(d) => cambiar(clave, d)} />
                        </div>
                        <NotaLinea valor={l.nota} onCambiar={(v) => notaLinea(clave, v)} />
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Nota para el pedido <span className="font-normal text-slate-400">(opcional)</span></span>
                  <textarea value={nota} onChange={(e) => setNota(e.target.value.slice(0, 500))} rows={2} placeholder="Ej.: traer todo junto, sin cubiertos…"
                    className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-base outline-none focus:border-[var(--brand)]" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Tu nombre <span className="font-normal text-slate-400">(opcional)</span></span>
                  <input value={nombre} onChange={(e) => setNombre(e.target.value.slice(0, 60))} placeholder="Para saber de quién es" autoComplete="given-name"
                    className="h-11 w-full rounded-xl border border-slate-200 px-3 text-base outline-none focus:border-[var(--brand)]" />
                </label>
              </div>
            </div>
            <div className="shrink-0 border-t border-slate-100 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              {error ? <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p> : null}
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-sm text-slate-600">Total estimado</span>
                <span className="text-xl font-bold tabular-nums text-slate-900">{gs(total)}</span>
              </div>
              <button type="button" onClick={() => void enviar()} disabled={enviando || !lineas.length}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold text-white shadow-sm disabled:opacity-50" style={{ backgroundColor: color }}>
                {enviando ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <ShoppingBag className="h-5 w-5" aria-hidden />}
                {enviando ? "Enviando…" : "Enviar pedido"}
              </button>
              <p className="mt-2 text-center text-[11px] text-slate-400">La caja confirma el pedido. Se suma a la cuenta de la mesa y se paga al final.</p>
            </div>
          </div>
        </CapaModal>
      ) : null}

      {/* Modificadores del plato (receta 73) */}
      {hoja && tieneMods(hoja.p.mods) ? (
        <HojaModificadores
          producto={{ nombre: hoja.p.nombre, precio: hoja.p.precio, precio_lista: hoja.p.precio_lista, imagen_url: hoja.p.imagen_url, descripcion: hoja.p.descripcion }}
          catalogo={hoja.p.mods}
          inicial={hoja.editar && carrito[hoja.editar]?.sel ? { sel: carrito[hoja.editar].sel!, cantidad: carrito[hoja.editar].cantidad, nota: carrito[hoja.editar].nota } : undefined}
          color={color}
          conNota
          ocultarSinStock
          textoBoton={hoja.editar ? "Guardar" : "Agregar"}
          z="z-[60]"
          onConfirmar={(r) => confirmarHoja(hoja.p, r, hoja.editar)}
          onClose={() => setHoja(null)}
        />
      ) : null}
    </div>
  );
}

function TarjetaProducto({ p, cantidad, color, onCambiar, onElegir }: { p: ProductoMenu; cantidad: number; color: string; onCambiar: (d: number) => void; onElegir?: () => void }) {
  const [sinFoto, setSinFoto] = useState(!p.imagen_url);
  return (
    <li className={`flex gap-3 rounded-2xl border bg-white p-2.5 shadow-sm transition ${cantidad ? "border-[var(--brand)]" : "border-slate-200"}`}>
      <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-slate-100">
        {sinFoto ? (
          <div className="grid h-full w-full place-items-center text-2xl font-bold text-slate-300">{p.nombre.slice(0, 1)}</div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.imagen_url!} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setSinFoto(true)} />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900">{p.nombre}</p>
        {p.descripcion ? <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{p.descripcion}</p> : null}
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div className="min-w-0">
            {p.precio_lista ? <p className="text-[11px] tabular-nums text-slate-400 line-through">{gs(p.precio_lista)}</p> : null}
            <p className="text-sm font-bold tabular-nums text-slate-900">{gs(p.precio)}</p>
          </div>
          {onElegir ? (
            // Con modificadores: cada toque abre la hoja (cada combinación es una línea).
            <button type="button" onClick={onElegir} aria-label={`Elegir y agregar ${p.nombre}`}
              className="relative inline-flex h-10 shrink-0 items-center gap-1 rounded-full pl-3 pr-3.5 text-sm font-semibold text-white shadow-sm active:scale-95" style={{ backgroundColor: color }}>
              <Plus className="h-4 w-4" aria-hidden /> {cantidad > 0 ? "Otro" : "Elegir"}
              {cantidad > 0 ? <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-slate-900 px-1 text-[11px] font-bold tabular-nums">{cantidad}</span> : null}
            </button>
          ) : cantidad > 0 ? (
            <Contador cantidad={cantidad} color={color} onCambiar={onCambiar} />
          ) : (
            <button type="button" onClick={() => onCambiar(1)} aria-label={`Agregar ${p.nombre}`}
              className="grid h-10 w-10 place-items-center rounded-full text-white shadow-sm active:scale-95" style={{ backgroundColor: color }}>
              <Plus className="h-5 w-5" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function Contador({ cantidad, color, onCambiar }: { cantidad: number; color: string; onCambiar: (d: number) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white p-0.5">
      <button type="button" onClick={() => onCambiar(-1)} aria-label={cantidad === 1 ? "Quitar" : "Uno menos"}
        className="grid h-9 w-9 place-items-center rounded-full text-slate-700 active:bg-slate-100">
        {cantidad === 1 ? <Trash2 className="h-4 w-4" aria-hidden /> : <Minus className="h-4 w-4" aria-hidden />}
      </button>
      <span className="min-w-6 text-center text-sm font-bold tabular-nums">{cantidad}</span>
      <button type="button" onClick={() => onCambiar(1)} aria-label="Uno más" disabled={cantidad >= 50}
        className="grid h-9 w-9 place-items-center rounded-full text-white disabled:opacity-40" style={{ backgroundColor: color }}>
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

function NotaLinea({ valor, onCambiar }: { valor: string; onCambiar: (v: string) => void }) {
  const [abierta, setAbierta] = useState(!!valor);
  if (!abierta) {
    return (
      <button type="button" onClick={() => setAbierta(true)} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-slate-500">
        <MessageSquareText className="h-3.5 w-3.5" aria-hidden /> Agregar aclaración
      </button>
    );
  }
  return (
    <input value={valor} onChange={(e) => onCambiar(e.target.value)} placeholder="Ej.: sin cebolla, bien frío" autoFocus
      className="mt-2 h-10 w-full rounded-lg border border-slate-200 px-3 text-base outline-none focus:border-[var(--brand)]" />
  );
}

function TarjetaEstado({ p }: { p: EstadoPedidoPublico }) {
  const e = ESTADOS_PEDIDO[p.estado];
  const Icono = p.estado === "rechazado" ? XCircle : p.estado === "listo" || p.estado === "entregado" ? CheckCircle2 : p.estado === "en_preparacion" ? ChefHat : Clock3;
  const pasos = ["nuevo", "aceptado", "en_preparacion", "listo"] as const;
  const i = pasos.indexOf(p.estado as (typeof pasos)[number]);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-3.5 py-3 shadow-sm">
      <div className="flex items-center gap-2">
        <Icono className={`h-5 w-5 shrink-0 ${p.estado === "rechazado" ? "text-rose-600" : p.estado === "nuevo" ? "text-amber-600" : "text-emerald-600"}`} aria-hidden />
        <p className="min-w-0 flex-1 text-sm font-semibold text-slate-900">Pedido #{p.numero} <span className="font-normal text-slate-400">· {horaCorta(p.creado_at)}</span></p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.clase}`}>{e.texto}</span>
      </div>
      <p className="mt-1 text-sm text-slate-600">{e.cliente}{p.estado === "rechazado" && p.motivo_rechazo ? `: ${p.motivo_rechazo}` : ""}</p>
      {i >= 0 ? (
        <div className="mt-2 grid grid-cols-4 gap-1" aria-hidden>
          {pasos.map((_, n) => <span key={n} className={`h-1.5 rounded-full ${n <= i ? "bg-[var(--brand)]" : "bg-slate-200"}`} />)}
        </div>
      ) : null}
      <p className="mt-2 text-xs text-slate-500">
        {p.items.map((it) => `${Number(it.cantidad)} × ${it.nombre}${it.modificadores_texto ? ` (${it.modificadores_texto})` : ""}`).join(" · ")} — <span className="font-semibold text-slate-700">{gs(p.total)}</span>
      </p>
    </div>
  );
}
