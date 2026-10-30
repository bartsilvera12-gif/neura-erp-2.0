"use client";

/**
 * /caja/pedidos — Pedidos de mostrador (receta 77). El vendedor arma el pedido y lo envía a caja;
 * la caja lo cobra en Nueva venta ("Pedidos por cobrar" o escaneando el comprobante).
 *   · Armar: buscador inteligente de productos (nombre, código, código de barras; con stock; sin
 *     materias primas), cantidades, modificadores de los platos (HojaModificadores), cliente
 *     opcional, nota y total. "Enviar a caja" → número grande P-0042, "Imprimir comprobante" y
 *     "Nuevo pedido". "Imprimir al enviar" queda recordado en este equipo.
 *   · Pedidos de hoy: los míos (o todos, si el nivel no es Vendedor) con su estado — En caja,
 *     Cobrado (con su venta), Vencido, Anulado. Uno en caja se edita o se anula.
 * No reserva stock (se descuenta al cobrar). Vence al cierre del día.
 * Celular: pestañas "Armar" / "Pedidos de hoy" con el total y "Enviar a caja" fijos abajo;
 * tablet / escritorio (≥ 1024): las dos columnas a la vez.
 */
import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, CheckCircle2, ClipboardList, Loader2, Package, Pencil, Printer, RotateCw, Search, Trash2, UserRound, UserRoundPlus, X } from "lucide-react";
import { NuevoCliente } from "@/modules/clientes/NuevoCliente";
import { apiFetch } from "@/lib/api/client-fetch";
import { buscar, buscarEnIndice, exactosPrimero, indexar } from "@/lib/busqueda";
import { CapaModal, ALTO_MAX_MODAL } from "@/components/CapaModal";
import { QtyInput } from "@/components/ui/QtyInput";
import { clienteConfig } from "@/cliente.config";
import { hora } from "@/lib/fecha/paraguay";
import { formatGs, type Cliente, type Producto } from "@/modules/caja/lib";
import { HojaModificadores, type ResultadoMods } from "@/modules/mesas/HojaModificadores";
import { ModsDetalle } from "@/modules/mesas/ModsDetalle";
import { claveMods, esVacia, modsParaEnviar, partesSel, precioMods, selDeSnapshot, tieneMods, type ModsSeleccion, type ModsSnapshot } from "@/modules/mesas/modificadores";
import { guardarImprimirAlEnviar, imprimirComprobantePedido, leerImprimirAlEnviar } from "@/modules/pedidos-mostrador/cliente";
import {
  ESTADOS_PEDIDO_MOSTRADOR, URL_PEDIDOS,
  type ListaPedidosMostrador, type PedidoMostrador,
} from "@/modules/pedidos-mostrador/tipos";

const TEAL = clienteConfig.color;

/** Interruptor con aspecto de chip de la barra de filtros (igual que en Inventario › Productos). */
const CHIP_TOGGLE = (on: boolean) =>
  `flex h-[38px] cursor-pointer select-none items-center gap-2 whitespace-nowrap rounded-xl border px-3 text-[13px] transition max-md:h-11 max-md:text-sm ${on ? "border-[color-mix(in_srgb,var(--brand)_38%,white)] bg-[var(--brand-50)] font-semibold text-[var(--brand)]" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`;

type Linea = {
  key: string;
  producto: Producto;
  cantidad: number;
  mods?: ModsSeleccion;
  mods_snap?: ModsSnapshot | null;
  precio_mods: number;
};

const precioBase = (p: Producto) => Math.round(Number(p.precio_venta) * (1 - Math.max(0, Math.min(Number(p.descuento_pct) || 0, 100)) / 100));
const cantTxt = (n: number) => Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });

export default function PedidosMostradorPage() {
  // ── Lista (y contexto: sucursal, depósito, si ve todos) ────────────────────
  const [lista, setLista] = useState<ListaPedidosMostrador | null>(null);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [verTodos, setVerTodos] = useState(true);
  const cargarLista = useCallback(async (todos = verTodos) => {
    try {
      const d = await apiFetch<ListaPedidosMostrador>(`${URL_PEDIDOS}${todos ? "?todos=1" : ""}`);
      setLista(d);
      setErrorLista(null);
    } catch (e) {
      setErrorLista((e as Error).message);
    }
  }, [verTodos]);
  useEffect(() => {
    void cargarLista();
    const id = setInterval(() => { if (document.visibilityState === "visible") void cargarLista(); }, 10_000);
    return () => clearInterval(id);
  }, [cargarLista]);

  // ── Catálogo (stock del depósito de la sucursal) ───────────────────────────
  const [productos, setProductos] = useState<Producto[]>([]);
  const deposito = lista?.deposito_id ?? null;
  const [catalogoListo, setCatalogoListo] = useState(false);
  useEffect(() => {
    if (!lista) return;
    let vivo = true;
    apiFetch<Producto[]>(`/api/productos?pos=1${deposito ? `&deposito=${deposito}` : ""}`)
      .then((p) => { if (vivo) { setProductos(p.filter((x) => x.tipo_producto !== "materia_prima")); setCatalogoListo(true); } })
      .catch(() => { if (vivo) setCatalogoListo(true); });
    return () => { vivo = false; };
    // Solo cuando cambia el depósito (la lista se refresca sola cada 10 s).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deposito, !!lista]);

  // ── Armado ─────────────────────────────────────────────────────────────────
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [nota, setNota] = useState("");
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [editando, setEditando] = useState<PedidoMostrador | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [listo, setListo] = useState<PedidoMostrador | null>(null);
  const [imprimirAlEnviar, setImprimirAlEnviar] = useState(false);
  useEffect(() => { setImprimirAlEnviar(leerImprimirAlEnviar()); }, []);
  const [imprimiendo, setImprimiendo] = useState<string | null>(null);
  const [pestana, setPestana] = useState<"armar" | "lista">("armar");

  // Buscador de productos (el mismo de la caja).
  const [q, setQ] = useState("");
  const [resaltado, setResaltado] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const indice = useMemo(() => indexar(productos, (p) => ({ principal: p.nombre, codigos: [p.sku, p.codigo_barras] })), [productos]);
  const qDif = useDeferredValue(q);
  const hitsDif = useMemo(() => (qDif.trim() ? buscarEnIndice(indice, qDif, 8) : []), [indice, qDif]);
  const hits = q.trim() ? hitsDif : [];

  const [hojaMods, setHojaMods] = useState<{ p: Producto; editar?: string } | null>(null);

  const agregar = useCallback((p: Producto, r?: ResultadoMods) => {
    if (tieneMods(p.mods) && !r) { setHojaMods({ p }); setQ(""); setResaltado(-1); return; }
    const sel = r && !esVacia(r.sel) ? r.sel : undefined;
    const clave = claveMods(sel);
    const cant = r?.cantidad ?? 1;
    setLineas((prev) => {
      const i = prev.findIndex((l) => l.producto.id === p.id && claveMods(l.mods) === clave);
      if (i !== -1) { const c = [...prev]; c[i] = { ...c[i], cantidad: c[i].cantidad + cant }; return c; }
      return [...prev, {
        key: `${p.id}_${Date.now()}`, producto: p, cantidad: cant,
        ...(sel && p.mods ? { mods: sel, mods_snap: partesSel(p.mods, sel) } : {}),
        precio_mods: sel ? r?.precio_mods ?? 0 : 0,
      }];
    });
    setQ("");
    setResaltado(-1);
    setErrorEnvio(null);
    if (typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches) setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  function confirmarMods(r: ResultadoMods) {
    const h = hojaMods;
    if (!h) return;
    setHojaMods(null);
    if (!h.editar) { agregar(h.p, r); return; }
    const sel = esVacia(r.sel) ? undefined : r.sel;
    setLineas((prev) => prev.map((l) => (l.key === h.editar
      ? { ...l, cantidad: r.cantidad, mods: sel, mods_snap: sel && l.producto.mods ? partesSel(l.producto.mods, sel) : null, precio_mods: sel ? r.precio_mods : 0 }
      : l)));
  }

  const cambiarCant = (key: string, n: number) => {
    if (!Number.isFinite(n) || n <= 0) return;
    setLineas((prev) => prev.map((l) => (l.key === key ? { ...l, cantidad: n } : l)));
  };
  const quitar = (key: string) => setLineas((prev) => prev.filter((l) => l.key !== key));

  const unidad = (l: Linea) => precioBase(l.producto) + (l.precio_mods || 0);
  const total = lineas.reduce((s, l) => s + Math.round(l.cantidad * unidad(l)), 0);
  const unidades = lineas.reduce((s, l) => s + l.cantidad, 0);
  const porProducto = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lineas) m.set(l.producto.id, (m.get(l.producto.id) ?? 0) + l.cantidad);
    return m;
  }, [lineas]);
  const faltaStock = (p: Producto) => p.controla_stock && (porProducto.get(p.id) ?? 0) > Number(p.stock_actual);

  function onKeyBuscar(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setResaltado((h) => Math.min(h + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setResaltado((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const lst = qDif === q ? hits : q.trim() ? buscarEnIndice(indice, q, 8) : [];
      const pick = qDif === q && resaltado >= 0 ? lst[resaltado] : lst[0];
      if (pick) agregar(pick);
    }
  }

  // Cliente (opcional): buscador de la base (debounce).
  const [qCliente, setQCliente] = useState("");
  const [clientesBuscados, setClientesBuscados] = useState<Cliente[]>([]);
  const [abiertoCliente, setAbiertoCliente] = useState(false);
  // Alta rápida (la misma de la caja): con lo escrito como nombre si no es un número.
  const [creandoCliente, setCreandoCliente] = useState(false);
  const cajaCliente = useRef<HTMLDivElement>(null);
  const listaCliente = useRef<HTMLDivElement>(null);
  // La lista flota sobre la pantalla (fuera de la zona con scroll, que la recortaba): abajo del
  // campo o, si no entra, arriba.
  const [posCliente, setPosCliente] = useState<{ left: number; width: number; top?: number; bottom?: number; maxH: number } | null>(null);
  const mostrarClientes = abiertoCliente && !cliente && !!qCliente.trim();
  useLayoutEffect(() => {
    if (!mostrarClientes) { setPosCliente(null); return; }
    const ubicar = () => {
      const r = cajaCliente.current?.querySelector("input")?.getBoundingClientRect();
      if (!r) return;
      const abajo = window.innerHeight - r.bottom - 8;
      const arriba = r.top - 8;
      setPosCliente(abajo >= 200 || abajo >= arriba
        ? { left: r.left, width: r.width, top: r.bottom + 4, maxH: Math.min(256, abajo - 4) }
        : { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4, maxH: Math.min(256, arriba - 4) });
    };
    ubicar();
    window.addEventListener("resize", ubicar);
    window.addEventListener("scroll", ubicar, true);
    return () => { window.removeEventListener("resize", ubicar); window.removeEventListener("scroll", ubicar, true); };
  }, [mostrarClientes]);
  useEffect(() => {
    const t = qCliente.trim();
    if (!t) { setClientesBuscados([]); return; }
    let vivo = true;
    const h = setTimeout(() => {
      apiFetch<Cliente[]>(`/api/clientes?q=${encodeURIComponent(t)}`).then((r) => { if (vivo) setClientesBuscados(r); }).catch(() => {});
    }, 250);
    return () => { vivo = false; clearTimeout(h); };
  }, [qCliente]);
  useEffect(() => {
    const fuera = (e: MouseEvent) => {
      const n = e.target as Node;
      if (cajaCliente.current && !cajaCliente.current.contains(n) && !listaCliente.current?.contains(n)) setAbiertoCliente(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, []);
  const clientesFiltrados = useMemo(
    () => exactosPrimero(
      buscar(clientesBuscados, qCliente, (c) => ({ principal: c.razon_social || c.nombre, otros: [c.nombre], codigos: [c.documento, c.ruc, c.telefono] })),
      qCliente, (c) => [c.nombre, c.razon_social, c.documento, c.ruc, c.telefono]).slice(0, 20),
    [clientesBuscados, qCliente],
  );

  function limpiar() {
    setLineas([]);
    setNota("");
    setCliente(null);
    setQCliente("");
    setEditando(null);
    setErrorEnvio(null);
  }

  async function imprimir(id: string) {
    setImprimiendo(id);
    const okImp = await imprimirComprobantePedido(id);
    setImprimiendo(null);
    if (!okImp) setErrorEnvio("No se pudo imprimir el comprobante. Probá de nuevo.");
  }

  async function enviar() {
    if (!lineas.length || enviando) return;
    setEnviando(true);
    setErrorEnvio(null);
    try {
      const body = {
        ...(editando ? { id: editando.id, version: editando.version } : {}),
        cliente_id: cliente?.id ?? null,
        nota: nota.trim() || null,
        items: lineas.map((l) => ({
          producto_id: l.producto.id,
          cantidad: l.cantidad,
          ...(modsParaEnviar(l.mods) ? { mods: modsParaEnviar(l.mods) } : {}),
        })),
      };
      const pd = await apiFetch<PedidoMostrador>(URL_PEDIDOS, { method: "POST", body: JSON.stringify(body) });
      limpiar();
      setListo(pd);
      void cargarLista();
      if (imprimirAlEnviar) void imprimir(pd.id);
    } catch (e) {
      setErrorEnvio((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  function editar(pd: PedidoMostrador) {
    const ls: Linea[] = [];
    const faltan: string[] = [];
    for (const [i, it] of pd.items.entries()) {
      const prod = it.producto_id ? productos.find((x) => x.id === it.producto_id) : undefined;
      if (!prod) { faltan.push(it.nombre); continue; }
      const sel = it.modificadores ? selDeSnapshot(it.modificadores) : undefined;
      ls.push({
        key: `ed_${pd.id}_${i}`, producto: prod, cantidad: Number(it.cantidad), mods: sel, mods_snap: it.modificadores ?? null,
        precio_mods: sel ? (tieneMods(prod.mods) ? precioMods(prod.mods, sel) : Number(it.precio_mods) || 0) : 0,
      });
    }
    setLineas(ls);
    setNota(pd.nota ?? "");
    setCliente(pd.cliente?.id ? ({ id: pd.cliente.id, nombre: pd.cliente.nombre } as Cliente) : null);
    setEditando(pd);
    setErrorEnvio(faltan.length ? `Ya no están en el catálogo (se sacaron del pedido): ${faltan.join(", ")}.` : null);
    setPestana("armar");
  }

  // ── Anular ─────────────────────────────────────────────────────────────────
  const [anulando, setAnulando] = useState<PedidoMostrador | null>(null);
  const [motivo, setMotivo] = useState("");
  const [enAnular, setEnAnular] = useState(false);
  const [errorAnular, setErrorAnular] = useState<string | null>(null);
  async function confirmarAnular() {
    if (!anulando) return;
    setEnAnular(true);
    setErrorAnular(null);
    try {
      await apiFetch(`${URL_PEDIDOS}/${anulando.id}/anular`, { method: "POST", body: JSON.stringify({ motivo: motivo.trim() || null }) });
      if (editando?.id === anulando.id) limpiar();
      setAnulando(null);
      setMotivo("");
      void cargarLista();
    } catch (e) {
      setErrorAnular((e as Error).message);
    } finally {
      setEnAnular(false);
    }
  }

  const todosPedidos = lista?.pedidos ?? [];
  const enCaja = todosPedidos.filter((x) => x.estado === "en_caja").length;
  // Los anulados quedan ocultos por defecto; el chip "Ver anulados (N)" los muestra (se recuerda en este equipo).
  const [verAnulados, setVerAnulados] = useState(false);
  useEffect(() => { try { setVerAnulados(localStorage.getItem("pedidos.verAnulados") === "1"); } catch { /* sin storage */ } }, []);
  const cambiarVerAnulados = (v: boolean) => { setVerAnulados(v); try { localStorage.setItem("pedidos.verAnulados", v ? "1" : "0"); } catch { /* sin storage */ } };
  const cantAnulados = todosPedidos.filter((x) => x.estado === "anulado").length;
  const pedidos = verAnulados ? todosPedidos : todosPedidos.filter((x) => x.estado !== "anulado");

  // ── Render ─────────────────────────────────────────────────────────────────
  const panelArmar = (
    <section className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Armar pedido">
      {editando ? (
        <div className="flex items-center justify-between gap-2 rounded-t-2xl border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <span className="min-w-0">Editando <b className="font-mono">{editando.etiqueta}</b>: al guardar, la caja ve el pedido nuevo.</span>
          <button type="button" onClick={limpiar} className="min-h-11 shrink-0 rounded-lg px-2 text-xs font-semibold hover:bg-white/70 lg:min-h-0 lg:py-1">Cancelar edición</button>
        </div>
      ) : null}
      {/* Buscador */}
      <div className="border-b border-slate-100 p-3 sm:p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            ref={inputRef}
            type="search"
            value={q}
            onChange={(e) => { setQ(e.target.value); setResaltado(-1); }}
            onKeyDown={onKeyBuscar}
            placeholder={catalogoListo ? "Buscá por nombre, código o escaneá…" : "Cargando productos…"}
            disabled={!catalogoListo}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-11 text-base outline-none focus:bg-white focus:ring-2 disabled:opacity-60 [&::-webkit-search-cancel-button]:hidden"
            style={{ ["--tw-ring-color" as string]: `${TEAL}55` }}
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} enterKeyHint="search"
            aria-label="Buscar producto"
          />
          {q ? (
            <button type="button" onClick={() => { setQ(""); inputRef.current?.focus(); }} aria-label="Limpiar búsqueda"
              className="absolute right-1 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700">
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        {hits.length > 0 ? (
          <ul className="mt-2 max-h-72 divide-y divide-slate-100 overflow-auto overscroll-contain rounded-xl border border-slate-200 bg-white shadow-inner max-lg:max-h-[min(20rem,45dvh)]">
            {hits.map((p, i) => {
              const sinStock = p.controla_stock && Number(p.stock_actual) <= 0;
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => agregar(p)} onMouseEnter={() => setResaltado(i)}
                    className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left text-sm active:bg-slate-50" style={i === resaltado ? { backgroundColor: `${TEAL}26` } : undefined}>
                    <Miniatura url={p.imagen_url} nombre={p.nombre} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-slate-900">{p.nombre}</span>
                      <span className="block truncate font-mono text-[11px] text-slate-500">{p.sku}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={`block text-[11px] font-medium ${sinStock ? "text-rose-600" : "text-emerald-700"}`}>
                        {p.sin_receta ? "Sin receta" : p.controla_stock ? (sinStock ? "Sin stock" : p.tipo_producto === "menu" ? `${cantTxt(p.stock_actual)} porc.` : `${cantTxt(p.stock_actual)} u`) : "—"}
                      </span>
                      <span className="block text-sm font-semibold tabular-nums text-slate-900">{formatGs(precioBase(p))}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {q.trim().length >= 2 && qDif === q && hits.length === 0 ? (
          <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm font-medium text-amber-900">Ningún producto con «{q.trim()}».</p>
        ) : null}
      </div>

      {/* Líneas */}
      <div className="min-h-0 flex-1 overflow-auto p-2.5 sm:p-4">
        {lineas.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-slate-400">
            <Package className="h-8 w-8 text-slate-300" aria-hidden />
            <p>Todavía no cargaste productos.</p>
            <p className="text-xs">Buscalos arriba o escaneá el código.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {lineas.map((l) => {
              const falta = faltaStock(l.producto);
              return (
                <li key={l.key} className={`rounded-xl border p-2.5 sm:p-3 ${falta ? "border-amber-300 bg-amber-50/50" : "border-slate-200 bg-slate-50/40"}`}>
                  <div className="flex items-start gap-2.5">
                    <Miniatura url={l.producto.imagen_url} nombre={l.producto.nombre} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug text-slate-900 [overflow-wrap:anywhere]">{l.producto.nombre}</p>
                      <p className="font-mono text-[11px] text-slate-500">{l.producto.sku} · <b className="text-slate-700">{formatGs(unidad(l))}</b> c/u</p>
                      {l.mods_snap || tieneMods(l.producto.mods) ? (
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2">
                          <ModsDetalle mods={l.mods_snap ?? null} className="min-w-0" />
                          {tieneMods(l.producto.mods) ? (
                            <button type="button" onClick={() => setHojaMods({ p: l.producto, editar: l.key })} className="inline-flex min-h-8 items-center text-xs font-semibold hover:underline [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-1" style={{ color: TEAL }}>
                              {l.mods_snap ? "Cambiar" : "Elegir opciones"}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {falta ? (
                        <p className="mt-1 text-[11px] font-medium text-amber-800">
                          Stock: {cantTxt(l.producto.stock_actual)}. El pedido no reserva: en caja no se va a poder cobrar si sigue faltando.
                        </p>
                      ) : null}
                    </div>
                    <button type="button" onClick={() => quitar(l.key)} aria-label={`Quitar ${l.producto.nombre}`}
                      className="-mr-1 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-rose-500 active:bg-rose-50">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="inline-flex shrink-0 items-center overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                      <button type="button" onClick={() => cambiarCant(l.key, l.cantidad - 1)} disabled={l.cantidad <= 1} aria-label="Quitar una unidad"
                        className="flex h-11 w-11 items-center justify-center text-xl text-slate-500 active:bg-[var(--brand-100)] disabled:opacity-30">−</button>
                      <QtyInput value={l.cantidad} onChange={(n) => cambiarCant(l.key, n)} decimals={0}
                        className="h-11 w-14 border-x border-slate-200 bg-white text-center text-base font-semibold tabular-nums text-slate-900 outline-none focus:bg-slate-50" />
                      <button type="button" onClick={() => cambiarCant(l.key, l.cantidad + 1)} aria-label="Agregar una unidad"
                        className="flex h-11 w-11 items-center justify-center text-xl text-slate-500 active:bg-[var(--brand-100)]">+</button>
                    </div>
                    <p className="text-base font-bold tabular-nums text-slate-900">{formatGs(Math.round(l.cantidad * unidad(l)))}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Cliente y nota (opcionales) */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div ref={cajaCliente} className="relative">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label htmlFor="ped-cliente" className="block text-sm font-medium text-slate-700">Cliente <span className="font-normal text-slate-400">(opcional)</span></label>
              {!cliente ? (
                <button type="button" onClick={() => { setAbiertoCliente(false); setCreandoCliente(true); }}
                  className="-my-2 inline-flex min-h-8 items-center gap-1 text-xs font-semibold hover:underline [@media(pointer:coarse)]:min-h-11" style={{ color: TEAL }}>
                  <UserRoundPlus className="h-3.5 w-3.5" aria-hidden /> Nuevo
                </button>
              ) : null}
            </div>
            {cliente ? (
              <div className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3">
                <UserRound className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{cliente.nombre}</span>
                <button type="button" onClick={() => { setCliente(null); setQCliente(""); }} className="min-h-11 shrink-0 px-1 text-xs font-semibold text-slate-500 hover:text-slate-800">Quitar</button>
              </div>
            ) : (
              <input id="ped-cliente" type="text" value={qCliente} onChange={(e) => { setQCliente(e.target.value); setAbiertoCliente(true); }} onFocus={() => setAbiertoCliente(true)}
                onKeyDown={(e) => {
                  // Enter elige el primero de la lista (el que coincide tal cual va arriba).
                  if (e.key === "Enter") { e.preventDefault(); const c = clientesFiltrados[0]; if (c && qCliente.trim()) { setCliente(c); setQCliente(""); setAbiertoCliente(false); } }
                  else if (e.key === "Escape") setAbiertoCliente(false);
                }}
                placeholder="Nombre, CI, RUC o teléfono" autoComplete="off"
                className="min-h-11 w-full rounded-lg border border-slate-200 px-3 text-base outline-none focus:ring-2 sm:text-sm" style={{ ["--tw-ring-color" as string]: `${TEAL}55` }} />
            )}
            {mostrarClientes && posCliente && typeof document !== "undefined" ? createPortal(
              <div ref={listaCliente} style={{ position: "fixed", left: posCliente.left, width: posCliente.width, top: posCliente.top, bottom: posCliente.bottom, maxHeight: posCliente.maxH }}
                className="z-[90] overflow-auto overscroll-contain rounded-lg border border-slate-200 bg-white shadow-xl ring-1 ring-black/5">
                {clientesFiltrados.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-400">Sin clientes que coincidan.</p>
                ) : clientesFiltrados.map((c, i) => (
                  <button key={c.id} type="button" onClick={() => { setCliente(c); setQCliente(""); setAbiertoCliente(false); }}
                    className={`block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${i === 0 ? "bg-slate-50" : ""}`}>
                    <span className="font-medium text-slate-800">{c.nombre}</span>
                    {c.ruc ? <span className="ml-2 text-xs text-slate-400">RUC {c.ruc}</span> : c.documento ? <span className="ml-2 text-xs text-slate-400">{c.documento}</span> : null}
                    {c.telefono ? <span className="ml-2 text-xs text-slate-400">· {c.telefono}</span> : null}
                  </button>
                ))}
                <button type="button" onClick={() => { setAbiertoCliente(false); setCreandoCliente(true); }}
                  className="flex min-h-11 w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-sm font-semibold hover:bg-slate-50" style={{ color: TEAL }}>
                  <UserRoundPlus className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 truncate">Crear cliente{/^[\d.\s-]+$/.test(qCliente.trim()) ? "" : ` «${qCliente.trim()}»`}</span>
                </button>
              </div>,
              document.body,
            ) : null}
          </div>
          <div>
            <label htmlFor="ped-nota" className="mb-1.5 block text-sm font-medium text-slate-700">Nota <span className="font-normal text-slate-400">(opcional)</span></label>
            <input id="ped-nota" type="text" value={nota} onChange={(e) => setNota(e.target.value)} maxLength={500} placeholder="Ej.: lo retira el lunes, cortar a medida…"
              className="min-h-11 w-full rounded-lg border border-slate-200 px-3 text-base outline-none focus:ring-2 sm:text-sm" style={{ ["--tw-ring-color" as string]: `${TEAL}55` }} />
          </div>
        </div>
      </div>

      {/* Total y enviar (escritorio / tablet ancha; en celular va en el pie fijo) */}
      <div className="hidden border-t border-slate-100 px-4 py-3 lg:block">
        <PieEnvio total={total} unidades={unidades} lineas={lineas.length} enviando={enviando} editando={!!editando} error={errorEnvio}
          imprimir={imprimirAlEnviar} onImprimir={(v) => { setImprimirAlEnviar(v); guardarImprimirAlEnviar(v); }} onEnviar={() => void enviar()} />
      </div>
    </section>
  );

  const panelLista = (
    <section className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Pedidos de hoy">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{lista?.puede_ver_todos && verTodos ? "Pedidos de hoy" : "Mis pedidos de hoy"}</h2>
          <p className="text-xs text-slate-500">{lista?.sucursal?.nombre ?? ""}{enCaja ? `${lista?.sucursal ? " · " : ""}${enCaja} en caja` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {cantAnulados > 0 || verAnulados ? (
            <label className={CHIP_TOGGLE(verAnulados)} title="Mostrar también los pedidos anulados de hoy">
              <input type="checkbox" checked={verAnulados} onChange={(e) => cambiarVerAnulados(e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-[var(--brand)]" />
              Ver anulados ({cantAnulados})
            </label>
          ) : null}
          {lista?.puede_ver_todos ? (
            <div className="flex overflow-hidden rounded-lg border border-slate-200" role="group" aria-label="Qué pedidos ver">
              {[{ v: false, t: "Míos" }, { v: true, t: "Todos" }].map((o) => (
                <button key={String(o.v)} type="button" aria-pressed={verTodos === o.v} onClick={() => { setVerTodos(o.v); void cargarLista(o.v); }}
                  className={`min-h-11 px-3 text-xs font-semibold lg:min-h-9 ${verTodos === o.v ? "text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                  style={verTodos === o.v ? { backgroundColor: TEAL } : undefined}>{o.t}</button>
              ))}
            </div>
          ) : null}
          <button type="button" onClick={() => void cargarLista()} aria-label="Actualizar" className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:h-9 lg:w-9">
            <RotateCw className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2.5 sm:p-4">
        {errorLista && !lista ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{errorLista}</p> : null}
        {!lista && !errorLista ? [0, 1, 2].map((i) => <div key={i} className="mb-2 h-20 animate-pulse rounded-xl bg-slate-100" />) : null}
        {lista && pedidos.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">{cantAnulados && !verAnulados ? `No hay pedidos activos hoy (${cantAnulados === 1 ? "1 anulado oculto" : `${cantAnulados} anulados ocultos`}).` : "Todavía no hay pedidos hoy."}</p> : null}
        <ul className="space-y-2">
          {pedidos.map((pd) => {
            const est = ESTADOS_PEDIDO_MOSTRADOR[pd.estado];
            const propio = pd.creado_por === lista?.usuario_id;
            const suyo = propio || !!lista?.puede_ver_todos;
            const puedeTocar = pd.estado === "en_caja" && suyo;
            // Un vencido no se cobra ni se edita, pero se anula (y sale de la lista).
            const puedeAnular = (pd.estado === "en_caja" || pd.estado === "vencido") && suyo;
            return (
              <li key={pd.id} className={`rounded-xl border p-3 ${editando?.id === pd.id ? "border-[var(--brand)]" : "border-slate-200"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-base font-bold text-slate-900">{pd.etiqueta}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${est.clase}`}>{est.texto}</span>
                      {pd.modificado_en_caja ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">Modificado en caja</span> : null}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 [overflow-wrap:anywhere]">
                      {hora(pd.creado_at)}{pd.fecha !== lista?.hoy ? ` del ${pd.fecha.split("-").reverse().slice(0, 2).join("/")}` : ""}
                      {verTodos && pd.vendedor ? ` · ${pd.vendedor}` : ""}
                      {pd.cliente ? ` · ${pd.cliente.nombre}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-right text-base font-bold tabular-nums text-slate-900">{formatGs(pd.estado === "cobrado" && pd.total_cobrado != null ? pd.total_cobrado : pd.total)}</p>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-slate-600">{pd.items.map((i) => `${cantTxt(i.cantidad)}× ${i.nombre}`).join(" · ")}</p>
                {pd.estado === "cobrado" && pd.venta ? (
                  <p className="mt-1 text-xs text-emerald-800">Cobrado {pd.cobrado_at ? hora(pd.cobrado_at) : ""} · venta <b className="font-mono">{pd.venta.numero}</b>{pd.cobrado_por_nombre ? ` · ${pd.cobrado_por_nombre}` : ""}</p>
                ) : null}
                {pd.estado === "anulado" ? <p className="mt-1 text-xs text-slate-500">Anulado{pd.anulado_por_nombre ? ` por ${pd.anulado_por_nombre}` : ""}{pd.motivo_anulacion ? `: ${pd.motivo_anulacion}` : ""}</p> : null}
                {pd.estado === "vencido" ? <p className="mt-1 text-xs text-amber-800">Venció al cierre del día: ya no se cobra. Anulalo para sacarlo de la lista, o armá uno nuevo si hace falta.</p> : null}
                {pd.estado === "en_caja" || pd.estado === "cobrado" || puedeAnular ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {pd.estado !== "vencido" ? (
                      <button type="button" onClick={() => void imprimir(pd.id)} disabled={imprimiendo === pd.id}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 lg:min-h-9">
                        {imprimiendo === pd.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />} Comprobante
                      </button>
                    ) : null}
                    {puedeAnular ? (
                      <>
                        {puedeTocar ? (
                          <button type="button" onClick={() => editar(pd)} disabled={!catalogoListo}
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 lg:min-h-9">
                            <Pencil className="h-3.5 w-3.5" /> Editar
                          </button>
                        ) : null}
                        <button type="button" onClick={() => { setAnulando(pd); setMotivo(""); setErrorAnular(null); }}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-rose-200 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50 lg:min-h-9">
                          <X className="h-3.5 w-3.5" /> Anular
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );

  return (
    <div className="flex flex-col gap-3 max-lg:pb-28 lg:h-[calc(100vh-7rem)] lg:min-h-0">
      {/* Encabezado compacto (como la caja) */}
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <Link href="/caja/panel" aria-label="Volver a Caja" title="Volver a Caja"
            className="-ml-1.5 inline-flex h-11 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 lg:h-8 lg:w-8">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">Pedidos</h1>
          <span className="hidden truncate text-xs text-slate-400 sm:inline">· Armá el pedido y mandalo a caja</span>
        </div>
        <Link href="/caja/nueva" className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 lg:min-h-9">
          Ir a la caja →
        </Link>
      </div>

      {/* Celular / tablet angosta: pestañas */}
      <div className="flex shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white lg:hidden" role="tablist" aria-label="Pedidos">
        {([["armar", editando ? `Editando ${editando.etiqueta}` : "Armar pedido"], ["lista", `Pedidos de hoy${enCaja ? ` (${enCaja} en caja)` : ""}`]] as const).map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={pestana === k} onClick={() => setPestana(k)}
            className={`min-h-11 flex-1 px-3 text-sm font-semibold ${pestana === k ? "text-white" : "text-slate-600"}`}
            style={pestana === k ? { backgroundColor: TEAL } : undefined}>{t}</button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_340px] xl:grid-cols-[1fr_420px]">
        <div className={`min-h-0 min-w-0 flex-col ${pestana === "armar" ? "flex" : "hidden"} lg:flex`}>{panelArmar}</div>
        <div className={`min-h-0 min-w-0 flex-col ${pestana === "lista" ? "flex" : "hidden"} lg:flex`}>{panelLista}</div>
      </div>

      {creandoCliente ? (
        <NuevoCliente
          inicial={qCliente.trim() && !/^[\d.\s-]+$/.test(qCliente.trim()) ? { nombre: qCliente.trim() } : undefined}
          onClose={() => setCreandoCliente(false)}
          onCreado={(c) => { setCliente(c); setQCliente(""); setCreandoCliente(false); }}
        />
      ) : null}

      {/* Celular / tablet: pie fijo con el total y "Enviar a caja" */}
      {pestana === "armar" ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-10px_30px_-12px_rgba(15,23,42,0.28)] backdrop-blur sm:px-4 lg:hidden">
          <div className="mx-auto max-w-3xl">
            <PieEnvio total={total} unidades={unidades} lineas={lineas.length} enviando={enviando} editando={!!editando} error={errorEnvio}
              imprimir={imprimirAlEnviar} onImprimir={(v) => { setImprimirAlEnviar(v); guardarImprimirAlEnviar(v); }} onEnviar={() => void enviar()} />
          </div>
        </div>
      ) : null}

      {/* Listo: número grande */}
      {listo ? (
        <CapaModal onClose={() => setListo(null)} z="z-[70]">
          <div role="dialog" aria-modal="true" aria-labelledby="listo-titulo" className={`flex w-full max-w-md flex-col overflow-y-auto rounded-2xl bg-white p-6 text-center shadow-2xl ${ALTO_MAX_MODAL}`}>
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" aria-hidden />
            <p id="listo-titulo" className="mt-2 text-sm font-semibold uppercase tracking-wider text-slate-500">{listo.editado_at ? "Pedido actualizado" : "Pedido enviado a caja"}</p>
            <p className="mt-1 font-mono text-6xl font-black tracking-tight text-slate-900 tabular-nums sm:text-7xl">{listo.etiqueta}</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-slate-700">{formatGs(listo.total)}</p>
            <p className="mt-3 text-base text-slate-700">Listo. Decile al cliente que pase por caja con el número <b className="font-mono">{listo.etiqueta}</b>.</p>
            <div className="mt-5 grid gap-2">
              <button type="button" onClick={() => void imprimir(listo.id)} disabled={imprimiendo === listo.id}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60">
                {imprimiendo === listo.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Imprimir comprobante
              </button>
              <button type="button" onClick={() => { setListo(null); setPestana("armar"); setTimeout(() => inputRef.current?.focus(), 0); }}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold text-white shadow-sm" style={{ backgroundColor: TEAL }}>
                <ClipboardList className="h-4 w-4" /> Nuevo pedido
              </button>
            </div>
            {errorEnvio ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{errorEnvio}</p> : null}
          </div>
        </CapaModal>
      ) : null}

      {/* Anular */}
      {anulando ? (
        <CapaModal onClose={() => !enAnular && setAnulando(null)} z="z-[70]">
          <div role="dialog" aria-modal="true" aria-labelledby="anular-titulo" className={`flex w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${ALTO_MAX_MODAL}`}>
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <h3 id="anular-titulo" className="text-base font-semibold text-slate-900">¿Anular el pedido {anulando.etiqueta}?</h3>
              <button type="button" aria-label="Cerrar" onClick={() => setAnulando(null)} disabled={enAnular} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:h-9 lg:w-9"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 text-sm text-slate-600">
              <p>{anulando.estado === "vencido" ? "Ya venció: se anula y sale de la lista." : "La caja ya no lo va a poder cobrar."} {formatGs(anulando.total)} · {anulando.items.length} producto{anulando.items.length === 1 ? "" : "s"}.</p>
              <div>
                <label htmlFor="anular-motivo" className="mb-1.5 block text-sm font-medium text-slate-700">Motivo <span className="font-normal text-slate-400">(opcional)</span></label>
                <input id="anular-motivo" type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Ej.: el cliente se arrepintió"
                  className="min-h-11 w-full rounded-lg border border-slate-200 px-3 text-base outline-none focus:ring-2 sm:text-sm" style={{ ["--tw-ring-color" as string]: `${TEAL}55` }} />
              </div>
              {errorAnular ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{errorAnular}</p> : null}
            </div>
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-100 px-5 py-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setAnulando(null)} disabled={enAnular} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">No, dejarlo</button>
              <button type="button" onClick={() => void confirmarAnular()} disabled={enAnular} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60">
                {enAnular ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Anular pedido
              </button>
            </div>
          </div>
        </CapaModal>
      ) : null}

      {/* Modificadores del plato (misma hoja que la caja y el menú QR) */}
      {hojaMods && tieneMods(hojaMods.p.mods) ? (() => {
        const p = hojaMods.p;
        const l = hojaMods.editar ? lineas.find((x) => x.key === hojaMods.editar) : undefined;
        const desc = Math.max(0, Math.min(Number(p.descuento_pct) || 0, 100));
        return (
          <HojaModificadores
            producto={{ nombre: p.nombre, precio: precioBase(p), precio_lista: desc > 0 ? p.precio_venta : null, imagen_url: p.imagen_url }}
            catalogo={p.mods!}
            inicial={l ? { sel: l.mods ?? { quitar: [], extras: [], opciones: [] }, cantidad: l.cantidad } : undefined}
            color={TEAL}
            textoBoton={l ? "Guardar" : "Agregar"}
            maxCantidad={999}
            z="z-[80]"
            onConfirmar={confirmarMods}
            onClose={() => setHojaMods(null)}
          />
        );
      })() : null}
    </div>
  );
}

// ── Sub-componentes ──────────────────────────────────────────────────────────

function PieEnvio({ total, unidades, lineas, enviando, editando, error, imprimir, onImprimir, onEnviar }: {
  total: number; unidades: number; lineas: number; enviando: boolean; editando: boolean; error: string | null;
  imprimir: boolean; onImprimir: (v: boolean) => void; onEnviar: () => void;
}) {
  return (
    <div className="space-y-2">
      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700" role="alert">{error}</p> : null}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] text-slate-500">{lineas} producto{lineas === 1 ? "" : "s"} · {cantTxt(unidades)} unidad{unidades === 1 ? "" : "es"}</p>
          <p className="truncate text-2xl font-bold leading-tight tabular-nums text-slate-900">{formatGs(total)}</p>
        </div>
        <button type="button" onClick={onEnviar} disabled={!lineas || enviando}
          className="inline-flex h-14 min-w-[48%] shrink-0 items-center justify-center gap-2 rounded-2xl px-5 text-base font-bold text-white shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none sm:min-w-[13rem] lg:min-w-0 xl:min-w-[13rem]"
          style={!lineas || enviando ? undefined : { backgroundColor: TEAL }}>
          {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
          {editando ? "Guardar cambios" : "Enviar a caja"}
        </button>
      </div>
      <button type="button" role="switch" aria-checked={imprimir} onClick={() => onImprimir(!imprimir)}
        className="inline-flex min-h-10 items-center gap-2 text-xs font-medium text-slate-600">
        <span className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${imprimir ? "" : "bg-slate-300"}`} style={imprimir ? { backgroundColor: TEAL } : undefined}>
          <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${imprimir ? "translate-x-4" : "translate-x-0.5"}`} />
        </span>
        Imprimir comprobante al enviar <span className="text-slate-400">(en este equipo)</span>
      </button>
    </div>
  );
}

function Miniatura({ url, nombre }: { url?: string | null; nombre: string }) {
  return (
    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={nombre} loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-slate-300"><Package className="h-5 w-5" /></div>
      )}
    </div>
  );
}
