"use client";

/**
 * Caja (POS) — portada de neura-erp-oymcomercial (/ventas), re-plomada al 2.0.
 * Layout de dos paneles: izquierda buscador/escaneo + carrito; derecha panel de
 * marca con el último producto + totales + descuento + "Aceptar y cobrar".
 * Fase 1: venta de contado/crédito, descuento global, IVA por línea, edición de
 * precio, ticket imprimible. (Sin caja-por-turno / pedidos / multi-cobro todavía.)
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Package, Search, Trash2 } from "lucide-react";
import { buscar } from "@/lib/busqueda";
import { apiFetch } from "@/lib/api/client-fetch";
import { browserClient } from "@/lib/supabase/browser";
import CajaControlPanel from "@/components/caja/CajaControlPanel";
import { clienteConfig } from "@/cliente.config";
import MontoInput, { parseMontoInput } from "@/components/ui/MontoInput";
import { QtyInput } from "@/components/ui/QtyInput";
import { NuevoCliente } from "@/modules/clientes/NuevoCliente";
import { Select } from "@/components/Select";
import {
  calcIva,
  formatGs,
  precioSegunLista,
  type Cliente,
  type Producto,
  type TipoIva,
  type TipoPrecio,
} from "@/modules/caja/lib";

const TEAL = clienteConfig.color;

// Escalonado por cantidad (regla del negocio): ≥10 mayorista, ≥20 distribuidor.
const UMBRAL_MAYORISTA = 10;
const UMBRAL_DISTRIBUIDOR = 20;
function tierPorCantidad(c: number): TipoPrecio {
  if (c >= UMBRAL_DISTRIBUIDOR) return "distribuidor";
  if (c >= UMBRAL_MAYORISTA) return "mayorista";
  return "minorista";
}

const IVAS_SEG: TipoIva[] = ["EXENTA", "5%", "10%"];
const ivaCorto = (t: TipoIva) => (t === "EXENTA" ? "Ex" : t);

// Métodos de pago (con tipo débito/crédito para tarjeta y POS). Soportan pago mixto.
type MetodoDetalle = "efectivo" | "transferencia" | "tarjeta_debito" | "tarjeta_credito" | "pos_debito" | "pos_credito";
const METODOS_PAGO: { value: MetodoDetalle; label: string }[] = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "tarjeta_debito", label: "Tarjeta débito" },
  { value: "tarjeta_credito", label: "Tarjeta crédito" },
  { value: "pos_debito", label: "POS débito" },
  { value: "pos_credito", label: "POS crédito" },
];
/** Categoría para la cabecera de la venta (la RPC deriva la del cajón). */
function categoriaPago(m: MetodoDetalle): "efectivo" | "transferencia" | "tarjeta" | "pos" {
  if (m === "efectivo") return "efectivo";
  if (m === "transferencia") return "transferencia";
  return m.startsWith("tarjeta") ? "tarjeta" : "pos";
}
type PagoLinea = { id: string; metodo: MetodoDetalle; monto: number };
const nuevoPagoId = () => `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

type CartLine = {
  cart_line_id: string;
  producto: Producto;
  cantidad: number;
  tipo_iva: TipoIva;
  /** Precio unitario manual; si está, pisa el de lista. */
  precio_override: number | null;
  /** true = el cajero fijó el tier a mano (no lo pisa el automático por cantidad). */
  tier_manual: boolean;
  tipo_precio: TipoPrecio;
  /** Descuento de la línea (%), 0..100. En súper el descuento es por producto. */
  descuento_pct: number;
};

/** Abre el ticket imprimible en una pestaña nueva, adjuntando el Bearer. */
async function imprimirTicket(ventaId: string) {
  try {
    const { data } = await browserClient().auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch(`/api/ventas/${ventaId}/ticket?auto=1`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const html = await res.text();
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  } catch { /* el ticket es best-effort; la venta ya quedó registrada */ }
}

function nuevaIdempotencyKey(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* sin crypto */ }
  return `vk_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export default function CajaPage() {
  // ── Datos ──────────────────────────────────────────────────────────────────
  const [productos, setProductos] = useState<Producto[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);

  // ── Búsqueda / escaneo ───────────────────────────────────────────────────
  const [q, setQ] = useState("");
  const [hitsHighlight, setHitsHighlight] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Carrito ────────────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartLine[]>([]);
  // Último producto escaneado: se guarda el producto en sí (no se deriva del
  // carrito) para que siga mostrándose aunque se borre la línea, hasta el próximo.
  const [ultimo, setUltimo] = useState<Producto | null>(null);

  // ── Datos de la venta ──────────────────────────────────────────────────────
  const [tipoVenta, setTipoVenta] = useState<"CONTADO" | "CREDITO">("CONTADO");
  const [plazoDias, setPlazoDias] = useState("");
  const [tipoDocumento, setTipoDocumento] = useState<"factura" | "ticket">("ticket");
  const [clienteId, setClienteId] = useState("");
  const [clienteQuery, setClienteQuery] = useState("");
  const [clienteOpen, setClienteOpen] = useState(false);
  const [modalNuevoCliente, setModalNuevoCliente] = useState(false);
  const clienteContainerRef = useRef<HTMLDivElement>(null);

  // ── Cobro (soporta pago mixto) ──────────────────────────────────────────────
  const [cobroOpen, setCobroOpen] = useState(false);
  const [pagos, setPagos] = useState<PagoLinea[]>([]);
  const [efectivoRecibido, setEfectivoRecibido] = useState("");
  const [cobrando, setCobrando] = useState(false);
  const [cobroError, setCobroError] = useState<string | null>(null);
  const [ventaOk, setVentaOk] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);

  // ── Caja por turno (gate de la venta) ───────────────────────────────────────
  const [cajaAbierta, setCajaAbierta] = useState(false);
  const [refreshCaja, setRefreshCaja] = useState(0);

  // Espejo del estado para los atajos de teclado (se asigna en cada render).
  const kbRef = useRef<{
    abrirCobro: () => void;
    confirmarCobro: () => Promise<void> | void;
    cobroOpen: boolean;
    cobrando: boolean;
    cart: CartLine[];
    q: string;
    inputRef: React.RefObject<HTMLInputElement | null>;
    updateCant: (id: string, n: number) => void;
    removeFromCart: (id: string) => void;
    setCobroOpen: (v: boolean) => void;
    setQ: (v: string) => void;
    setClienteOpen: (v: boolean) => void;
  }>({} as never);

  // ── Carga inicial ────────────────────────────────────────────────────────
  useEffect(() => {
    apiFetch<Producto[]>("/api/productos").then(setProductos).catch(() => {});
    apiFetch<Cliente[]>("/api/clientes").then(setClientes).catch(() => {});
  }, []);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Búsqueda de clientes en la base (debounce 250 ms).
  const [clientesBuscados, setClientesBuscados] = useState<Cliente[] | null>(null);
  useEffect(() => {
    const t = clienteQuery.trim();
    setClientesBuscados(null);
    if (!t) return;
    let vivo = true;
    const h = setTimeout(() => {
      apiFetch<Cliente[]>(`/api/clientes?q=${encodeURIComponent(t)}`)
        .then((r) => { if (vivo) setClientesBuscados(r); })
        .catch(() => {});
    }, 250);
    return () => { vivo = false; clearTimeout(h); };
  }, [clienteQuery]);

  // Cerrar dropdown de cliente al click fuera.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (clienteContainerRef.current && !clienteContainerRef.current.contains(e.target as Node)) setClienteOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // ── Atajos de teclado (cajero de súper: una mano en el lector + pavé) ───────
  // Lee el estado vía ref para no re-suscribir el listener en cada tecla.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const s = kbRef.current;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const esTexto = tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable === true;

      // Dentro del modal de cobro: Esc cierra; Enter confirma, PERO no cuando el
      // foco está en un botón/select/opción (ahí Enter lo maneja el propio control:
      // abrir el método, elegir opción, o activar Cancelar/Confirmar).
      if (s.cobroOpen) {
        if (e.key === "Escape") {
          // Si hay un dropdown de método abierto, que Escape lo cierre a él (no al modal).
          if (document.querySelector("[role=listbox]")) return;
          if (!s.cobrando) s.setCobroOpen(false);
          return;
        }
        if (e.key === "Enter") {
          const esControl = tag === "BUTTON" || tag === "SELECT" || el?.getAttribute("role") === "option" || !!el?.closest("[role=listbox]");
          if (esControl) return; // dejar que el control haga lo suyo
          e.preventDefault();
          if (!s.cobrando) void s.confirmarCobro();
        }
        return;
      }

      // Espacio: abrir cobro. Desde el buscador VACÍO (para no romper nombres con
      // espacios) o desde una zona neutra (no un campo de texto / botón / link).
      if (e.key === " ") {
        const buscadorVacio = el === s.inputRef.current && s.q.trim() === "";
        const zonaNeutra = !esTexto && tag !== "BUTTON" && tag !== "A" && tag !== "SELECT";
        if (buscadorVacio || zonaNeutra) { e.preventDefault(); s.abrirCobro(); }
        return;
      }

      // +/− (pavé numérico): ajusta la cantidad de la última línea cargada.
      if ((e.key === "+" || e.key === "-") && s.cart.length > 0) {
        const buscadorVacio = el === s.inputRef.current && s.q.trim() === "";
        if (!esTexto || buscadorVacio) {
          e.preventDefault();
          const last = s.cart[s.cart.length - 1];
          s.updateCant(last.cart_line_id, last.cantidad + (e.key === "+" ? 1 : -1));
        }
        return;
      }

      // Supr: quita la última línea (fuera de un campo de texto).
      if (e.key === "Delete" && !esTexto && s.cart.length > 0) {
        e.preventDefault();
        s.removeFromCart(s.cart[s.cart.length - 1].cart_line_id);
        return;
      }

      // Esc fuera del modal: limpia el buscador y cierra el dropdown de cliente.
      if (e.key === "Escape") { s.setQ(""); s.setClienteOpen(false); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ── Derivados ──────────────────────────────────────────────────────────────
  const vendibles = useMemo(() => productos.filter((p) => !p.controla_stock || true), [productos]);
  // Búsqueda inteligente: nombre, SKU y código de barras (lector), sin tildes, en cualquier
  // orden y con errores de tipeo; un código exacto va primero (Enter lo agrega).
  const hits = useMemo(() => {
    if (!q.trim()) return [];
    return buscar(vendibles, q, (p) => ({ principal: p.nombre, codigos: [p.sku, p.codigo_barras] })).slice(0, 8);
  }, [vendibles, q]);

  const tierDe = useCallback((l: CartLine): TipoPrecio => (l.tier_manual ? l.tipo_precio : tierPorCantidad(l.cantidad)), []);
  const precioEfectivo = useCallback((l: CartLine) => precioSegunLista(l.producto, tierDe(l)), [tierDe]);
  // Precio de lista/override por unidad (SIN descuento).
  const precioActual = useCallback((l: CartLine) => (l.precio_override != null && l.precio_override > 0 ? l.precio_override : precioEfectivo(l)), [precioEfectivo]);
  // Precio unitario YA con el descuento de la línea (como lo guarda crear_venta).
  const precioConDesc = useCallback((l: CartLine) => Math.round(precioActual(l) * (1 - (l.descuento_pct || 0) / 100)), [precioActual]);
  const totalLinea = useCallback((l: CartLine) => l.cantidad * precioConDesc(l), [precioConDesc]);

  const cantTotal = useMemo(() => cart.reduce((s, l) => s + l.cantidad, 0), [cart]);
  const total = useMemo(() => cart.reduce((s, l) => s + totalLinea(l), 0), [cart, totalLinea]);
  // IVA CONTENIDO en el total (Paraguay: el precio ya lo incluye).
  const totalIva = useMemo(() => cart.reduce((s, l) => s + calcIva(l.tipo_iva, totalLinea(l)), 0), [cart, totalLinea]);


  // Stock insuficiente (bloquea el cobro).
  const sinStock = useMemo(
    () => cart.filter((l) => l.producto.controla_stock && l.cantidad > l.producto.stock_actual),
    [cart],
  );
  const haySinStock = sinStock.length > 0;
  const idsSinStock = useMemo(() => new Set(sinStock.map((l) => l.producto.id)), [sinStock]);

  // Cliente seleccionado / filtrado.
  const clienteSel = clientes.find((c) => c.id === clienteId) ?? null;
  // Con texto, busca en la base (todos los clientes, no solo los cargados) y mientras
  // llega la respuesta usa los que ya están en pantalla con la misma lógica.
  const clientesFiltrados = (clienteQuery.trim() === ""
    ? clientes
    : clientesBuscados ?? buscar(clientes, clienteQuery, (c) => ({ principal: c.razon_social || c.nombre, otros: [c.nombre, c.telefono], codigos: [c.documento, c.ruc] }))
  ).slice(0, 50);

  const clienteObligatorio = tipoDocumento === "factura" || tipoVenta === "CREDITO";
  const plazoDiasNum = parseInt(plazoDias) || 0;

  // Pago mixto: la suma de los montos debe igualar el total.
  const totalPagos = pagos.reduce((a, p) => a + (p.monto || 0), 0);
  const restante = total - totalPagos;
  const hayEfectivo = pagos.some((p) => p.metodo === "efectivo");
  const efectivoAplicado = pagos.filter((p) => p.metodo === "efectivo").reduce((a, p) => a + (p.monto || 0), 0);
  // Vuelto: solo sobre la parte en efectivo (si el cliente entrega más).
  const recibidoNum = parseMontoInput(efectivoRecibido);
  const vuelto = hayEfectivo && recibidoNum > 0 ? Math.max(0, recibidoNum - efectivoAplicado) : 0;
  const faltaEfectivo = hayEfectivo && recibidoNum > 0 ? Math.max(0, efectivoAplicado - recibidoNum) : 0;
  const cobroListo = tipoVenta === "CREDITO" || restante === 0;

  // ── Acciones carrito ───────────────────────────────────────────────────────
  const addToCart = useCallback((p: Producto) => {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.producto.id === p.id);
      if (idx !== -1) {
        const copia = [...prev];
        copia[idx] = { ...copia[idx], cantidad: copia[idx].cantidad + 1 };
        return copia;
      }
      const nuevo: CartLine = {
        cart_line_id: `${p.id}_${Date.now()}`,
        producto: p,
        cantidad: 1,
        tipo_iva: p.tipo_iva,
        precio_override: null,
        tier_manual: false,
        tipo_precio: "minorista",
        descuento_pct: Math.max(0, Math.min(Number(p.descuento_pct) || 0, 100)), // viene del producto (Inventario)
      };
      return [...prev, nuevo];
    });
    // El último producto escaneado (nuevo o repetido) es el que se muestra en el panel.
    setUltimo(p);
    setQ("");
    setHitsHighlight(-1);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const updateCant = useCallback((id: string, n: number) => {
    if (!Number.isFinite(n) || n <= 0) return;
    setCart((prev) => prev.map((l) => (l.cart_line_id === id ? { ...l, cantidad: n } : l)));
  }, []);

  const setIvaLinea = useCallback((id: string, iva: TipoIva) => {
    setCart((prev) => prev.map((l) => (l.cart_line_id === id ? { ...l, tipo_iva: iva } : l)));
  }, []);

  const removeFromCart = useCallback((id: string) => {
    setCart((prev) => prev.filter((l) => l.cart_line_id !== id));
  }, []);

  const vaciarCarrito = useCallback(() => {
    setCart([]);
    setUltimo(null);
  }, []);

  function onKeyDownBuscar(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHitsHighlight((h) => Math.min(h + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHitsHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const pick = hitsHighlight >= 0 ? hits[hitsHighlight] : hits[0];
      if (pick) addToCart(pick);
    }
  }

  // ── Cobro ──────────────────────────────────────────────────────────────────
  function abrirCobro() {
    setCobroError(null);
    if (cart.length === 0 || haySinStock) return;
    if (clienteObligatorio && !clienteId) {
      setCobroError(tipoDocumento === "factura" ? "Para emitir factura elegí un cliente." : "La venta a crédito requiere un cliente.");
      return;
    }
    if (tipoVenta === "CREDITO" && plazoDiasNum < 1) {
      setCobroError("Ingresá un plazo de crédito de al menos 1 día.");
      return;
    }
    setEfectivoRecibido("");
    // Arranca con un solo pago en efectivo por el total (camino rápido).
    setPagos(tipoVenta === "CREDITO" ? [] : [{ id: nuevoPagoId(), metodo: "efectivo", monto: total }]);
    setCobroOpen(true);
  }

  // ── Handlers de pago mixto ──────────────────────────────────────────────────
  const setPagoMetodo = useCallback((id: string, metodo: MetodoDetalle) => {
    setPagos((prev) => prev.map((p) => (p.id === id ? { ...p, metodo } : p)));
  }, []);
  const setPagoMonto = useCallback((id: string, monto: number) => {
    setPagos((prev) => prev.map((p) => (p.id === id ? { ...p, monto: Math.max(0, Math.round(monto)) } : p)));
  }, []);
  const quitarPago = useCallback((id: string) => {
    setPagos((prev) => (prev.length <= 1 ? prev : prev.filter((p) => p.id !== id)));
  }, []);
  // Agrega un método nuevo y le asigna el monto que falta.
  const agregarPago = useCallback(() => {
    setPagos((prev) => {
      const sum = prev.reduce((a, p) => a + (p.monto || 0), 0);
      const falta = Math.max(0, total - sum);
      const usados = new Set(prev.map((p) => p.metodo));
      const siguiente = (METODOS_PAGO.find((m) => !usados.has(m.value)) ?? METODOS_PAGO[1]).value;
      return [...prev, { id: nuevoPagoId(), metodo: siguiente, monto: falta }];
    });
  }, [total]);

  async function confirmarCobro() {
    if (isSubmittingRef.current) return;
    // Pago mixto: la suma debe cuadrar con el total (salvo crédito).
    if (tipoVenta !== "CREDITO" && restante !== 0) {
      setCobroError(restante > 0 ? `Falta asignar ${formatGs(restante)}.` : `Te pasaste por ${formatGs(-restante)}.`);
      return;
    }
    isSubmittingRef.current = true;
    setCobrando(true);
    setCobroError(null);
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = nuevaIdempotencyKey();
    try {
      const items = cart.map((l) => {
        const tier = tierDe(l);
        return {
          producto_id: l.producto.id,
          cantidad: l.cantidad,
          tipo_precio: tier,
          tipo_iva: l.tipo_iva,
          descuento_pct: l.descuento_pct || 0,
          ...(l.precio_override != null && l.precio_override > 0 ? { precio_unitario: l.precio_override } : {}),
        };
      });
      const venta = await apiFetch<{ venta_id: string; numero_control: string; total: number }>("/api/caja/venta", {
        method: "POST",
        body: JSON.stringify({
          cliente_id: clienteId || null,
          tipo_venta: tipoVenta,
          // Cabecera: 'mixto' si hay varios medios; si no, la categoría del único.
          metodo_pago: tipoVenta === "CREDITO" ? "otro" : (pagos.length > 1 ? "mixto" : categoriaPago(pagos[0]?.metodo ?? "efectivo")),
          moneda: "GS",
          idempotency_key: idempotencyKeyRef.current,
          plazo_dias: tipoVenta === "CREDITO" ? plazoDiasNum : undefined,
          items,
          // Detalle de pagos (solo contado). La RPC valida que sume el total.
          pagos: tipoVenta === "CREDITO" ? undefined : pagos.map((p) => ({ metodo_pago: p.metodo, monto: p.monto })),
        }),
      });
      idempotencyKeyRef.current = null;
      // Ticket imprimible (SIFEN inactivo → por ahora siempre ticket). La auth del
      // 2.0 es por Bearer, así que una pestaña nueva no lleva el token: traemos el
      // HTML con el token y lo abrimos como blob (el auto-print corre igual).
      void imprimirTicket(venta.venta_id);
      setVentaOk(venta.numero_control);
      setCobroOpen(false);
      vaciarCarrito();
      setClienteId("");
      setClienteQuery("");
      setTipoVenta("CONTADO");
      setPlazoDias("");
      // refrescar stock + resumen de caja (el turno acaba de cobrar)
      apiFetch<Producto[]>("/api/productos").then(setProductos).catch(() => {});
      setRefreshCaja((t) => t + 1);
      setTimeout(() => setVentaOk(null), 6000);
    } catch (e) {
      setCobroError((e as Error).message);
    } finally {
      isSubmittingRef.current = false;
      setCobrando(false);
    }
  }

  // Espejo del estado para los atajos de teclado (siempre el último valor).
  kbRef.current = {
    abrirCobro, confirmarCobro, cobroOpen, cobrando, cart, q, inputRef,
    updateCant, removeFromCart, setCobroOpen, setQ, setClienteOpen,
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-0 flex-col gap-3">
      {/* Header compacto: todo en una línea para no gastar alto vertical. */}
      <div className="flex shrink-0 items-center justify-between gap-4">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">Caja</h1>
          <span className="hidden text-xs text-slate-400 sm:inline">· Escaneá y cobrá directo</span>
        </div>
        <Link href="/caja" className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
          Ver órdenes del día →
        </Link>
      </div>

      {/* Caja por turno: gate de la venta. Sin caja abierta no se puede cobrar. */}
      <div className="shrink-0">
        <CajaControlPanel onStateChange={setCajaAbierta} defaultCollapsed refreshTick={refreshCaja} />
      </div>

      {ventaOk && (
        <div className="flex shrink-0 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 shadow-sm">
          <CheckCircle2 className="h-5 w-5" /> Venta <strong>{ventaOk}</strong> registrada. Ticket enviado a imprimir.
        </div>
      )}

      {!cajaAbierta ? (
        <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
          Abrí la caja para empezar a cobrar.
        </div>
      ) : (
      <>
      {/* Datos de la venta — compacto, una fila. */}
      <div className="shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {/* Cliente */}
          <div ref={clienteContainerRef} className="relative">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Cliente {clienteObligatorio ? <span className="text-rose-600">*</span> : <span className="font-normal text-slate-400">(opcional para ticket)</span>}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={clienteSel ? clienteSel.nombre : clienteQuery}
                onChange={(e) => { setClienteId(""); setClienteQuery(e.target.value); setClienteOpen(true); }}
                onFocus={() => setClienteOpen(true)}
                placeholder="Buscar por nombre o RUC…"
                className={`w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 ${clienteSel ? "font-medium" : ""}`}
                style={{ ["--tw-ring-color" as string]: TEAL }}
              />
              {clienteSel && (
                <button type="button" onClick={() => { setClienteId(""); setClienteQuery(""); }} className="shrink-0 rounded-lg border border-slate-200 px-3 text-xs text-slate-500 hover:bg-slate-50">
                  Quitar
                </button>
              )}
            </div>
            {clienteOpen && !clienteSel && (
              <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-xl ring-1 ring-black/5">
                <button type="button" onClick={() => { setClienteOpen(false); setModalNuevoCliente(true); }} className="flex w-full items-center gap-1.5 border-b border-slate-100 px-3 py-2 text-left text-xs font-semibold hover:bg-slate-50" style={{ color: TEAL, backgroundColor: `${TEAL}0f` }}>
                  <span className="text-base leading-none">＋</span> Cargar nuevo cliente
                  {clienteQuery.trim() && <span className="ml-1 truncate text-slate-500">«{clienteQuery.trim()}»</span>}
                </button>
                {clientesFiltrados.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-400">Sin clientes que coincidan.</p>
                ) : clientesFiltrados.map((c) => (
                  <button key={c.id} type="button" onClick={() => { if (!clientes.some((x) => x.id === c.id)) setClientes((prev) => [c, ...prev]); setClienteId(c.id); setClienteQuery(""); setClienteOpen(false); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                    <span className="font-medium text-slate-800">{c.nombre}</span>
                    {c.ruc && <span className="ml-2 text-xs text-slate-400">RUC {c.ruc}</span>}
                    {c.documento && !c.ruc && <span className="ml-2 text-xs text-slate-400">{c.documento}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Condición */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Condición</label>
            <Segmented value={tipoVenta} onChange={(v) => { setTipoVenta(v); if (v === "CONTADO") setPlazoDias(""); }} options={[{ value: "CONTADO", label: "Contado" }, { value: "CREDITO", label: "Crédito" }]} />
            {tipoVenta === "CREDITO" && (
              <div className="mt-2">
                <input type="number" min={1} value={plazoDias} onChange={(e) => setPlazoDias(e.target.value)} placeholder="Plazo (días)"
                  className={`w-full rounded-lg border px-3 py-2 text-sm outline-none ${plazoDiasNum < 1 ? "border-rose-300 bg-rose-50" : "border-slate-200"}`} />
              </div>
            )}
          </div>

          {/* Documento */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Documento</label>
            <Segmented value={tipoDocumento} onChange={setTipoDocumento} options={[{ value: "factura", label: "Factura" }, { value: "ticket", label: "Solo ticket" }]} />
            <p className="mt-1 text-[11px] text-slate-500">
              {tipoDocumento === "factura" ? "Factura electrónica (SIFEN) — por ahora inactivo: se imprime el ticket." : "Registra la venta e imprime un ticket. No toca SIFEN."}
            </p>
          </div>
        </div>
      </div>

      {/* Split POS */}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_440px]">
        {/* IZQUIERDA: buscador + carrito */}
        <div className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                value={q}
                onChange={(e) => { setQ(e.target.value); setHitsHighlight(-1); }}
                onKeyDown={onKeyDownBuscar}
                placeholder="Escaneá el código o buscá por nombre/SKU…"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-base outline-none focus:bg-white focus:ring-2"
                style={{ ["--tw-ring-color" as string]: `${TEAL}55` }}
                autoComplete="off"
              />
            </div>
            {hits.length > 0 && (
              <ul className="mt-2 max-h-56 divide-y divide-slate-100 overflow-auto rounded-xl border border-slate-200 bg-white shadow-inner">
                {hits.map((p, i) => (
                  <li key={p.id} onClick={() => addToCart(p)} onMouseEnter={() => setHitsHighlight(i)}
                    className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm" style={i === hitsHighlight ? { backgroundColor: `${TEAL}26` } : undefined}>
                    <ProdThumb url={p.imagen_url} nombre={p.nombre} className="h-10 w-10" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900">{p.nombre}</p>
                      <p className="font-mono text-[11px] text-slate-500">{p.sku}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-[11px] font-medium ${p.controla_stock && p.stock_actual <= 0 ? "text-rose-600" : "text-emerald-700"}`}>
                        {p.controla_stock ? (p.stock_actual <= 0 ? "Sin stock" : `${p.stock_actual} u`) : "—"}
                      </p>
                      <p className="text-sm font-semibold tabular-nums text-slate-900">{formatGs(p.precio_venta)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {q.trim().length >= 2 && hits.length === 0 && (
              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm">
                <p className="font-medium text-amber-900">Ningún producto con «{q.trim()}».</p>
              </div>
            )}

            {/* Guía de atajos: operar la caja sin mouse. */}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
              <span className="font-semibold uppercase tracking-wider text-slate-400">Teclado</span>
              <Atajo k="Enter" t="agregar" />
              <Atajo k="Espacio" t="cobrar" />
              <Atajo k="+ / −" t="cantidad" />
              <Atajo k="Supr" t="quitar" />
              <Atajo k="Esc" t="limpiar" />
            </div>
          </div>

          {/* Ítems cargados */}
          <div className="flex items-baseline justify-between border-t border-slate-100 bg-slate-50/60 px-4 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Ítems cargados: <span className="text-base font-bold tabular-nums" style={{ color: TEAL }}>{cart.length}</span>
            </p>
            {cart.length > 0 && <p className="text-[11px] tabular-nums text-slate-500">{cantTotal} unidad{cantTotal === 1 ? "" : "es"} totales</p>}
          </div>

          {/* Carrito */}
          <div className="flex-1 overflow-auto p-4">
            {haySinStock && (
              <div className="mb-3 rounded-xl border border-rose-300 bg-rose-50 p-3">
                <p className="text-sm font-semibold text-rose-800">❌ No podés cobrar — hay productos sin stock suficiente</p>
                <ul className="mt-2 space-y-1 text-xs text-rose-900">
                  {sinStock.map((l) => (
                    <li key={l.cart_line_id} className="tabular-nums"><strong>{l.producto.nombre}</strong> · Disponible: {l.producto.stock_actual} / Solicitado: {l.cantidad}</li>
                  ))}
                </ul>
              </div>
            )}
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-400">
                <Package className="h-8 w-8 text-slate-300" />
                <p>Todavía no cargaste productos.</p>
                <p className="text-xs">Escaneá o buscá arriba.</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {cart.map((l) => {
                  const sinStockLinea = idsSinStock.has(l.producto.id);
                  const tier = tierDe(l);
                  const pAct = precioActual(l);
                  const desc = l.descuento_pct || 0;
                  const brutoLinea = l.cantidad * pAct;
                  const netoLinea = totalLinea(l);
                  return (
                    <li key={l.cart_line_id} className={`rounded-xl border p-3 ${sinStockLinea ? "border-rose-300 bg-rose-50/60" : "border-slate-200 bg-slate-50/40"}`}>
                      <div className="flex items-start gap-3">
                        <ProdThumb url={l.producto.imagen_url} nombre={l.producto.nombre} className="h-12 w-12" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{l.producto.nombre}</p>
                            {sinStockLinea && <span className="rounded-full border border-rose-300 bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-800">❌ Sin stock</span>}
                            {tier !== "minorista" && (
                              <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ borderColor: `${TEAL}55`, backgroundColor: `${TEAL}14`, color: TEAL }}>
                                {tier === "mayorista" ? "Mayorista" : "Distribuidor"}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-1 font-mono text-[11px] text-slate-500">
                            <span>{l.producto.sku}</span>
                            <span>·</span>
                            <span className="font-semibold text-slate-700">{formatGs(pAct)}</span>
                            <span>c/u</span>
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            {/* Stepper unificado: un solo borde, divisores internos y hover turquesa. */}
                            <div className="inline-flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                              <button type="button" onClick={() => updateCant(l.cart_line_id, l.cantidad - 1)} className="flex h-8 w-9 items-center justify-center text-lg font-medium leading-none text-slate-400 transition-colors hover:bg-[var(--brand-50)] hover:text-[var(--brand)] active:bg-[var(--brand-100)]" aria-label="Quitar una unidad">−</button>
                              <QtyInput value={l.cantidad} onChange={(n) => updateCant(l.cart_line_id, n)} decimals={0} className="h-8 w-10 border-x border-slate-200 bg-white text-center text-sm font-semibold tabular-nums text-slate-900 outline-none focus:bg-slate-50" />
                              <button type="button" onClick={() => updateCant(l.cart_line_id, l.cantidad + 1)} className="flex h-8 w-9 items-center justify-center text-lg font-medium leading-none text-slate-400 transition-colors hover:bg-[var(--brand-50)] hover:text-[var(--brand)] active:bg-[var(--brand-100)]" aria-label="Agregar una unidad">+</button>
                            </div>
                            <div className="ml-auto inline-flex overflow-hidden rounded-md border border-slate-300 shadow-sm" role="group" aria-label="IVA de la línea">
                              {IVAS_SEG.map((iva, idx) => {
                                const sel = l.tipo_iva === iva;
                                return (
                                  <button key={iva} type="button" onClick={() => setIvaLinea(l.cart_line_id, iva)}
                                    className={`px-2.5 py-1 text-[11px] font-bold transition-colors ${idx > 0 ? "border-l border-slate-300" : ""} ${sel ? "text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
                                    style={sel ? { backgroundColor: TEAL } : undefined}>
                                    {ivaCorto(iva)}
                                  </button>
                                );
                              })}
                            </div>
                            {/* Descuento del producto (definido en Inventario): solo lectura. */}
                            {desc > 0 && (
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700" title="Descuento del producto (Inventario)">−{desc}%</span>
                            )}
                            <div className="w-24 text-right">
                              {desc > 0 && <div className="text-[10px] text-slate-400 line-through tabular-nums">{formatGs(brutoLinea)}</div>}
                              <div className="text-sm font-semibold tabular-nums text-slate-900">{formatGs(netoLinea)}</div>
                            </div>
                          </div>
                        </div>
                        <button type="button" onClick={() => removeFromCart(l.cart_line_id)} className="text-slate-400 hover:text-rose-500" aria-label="Quitar"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* DERECHA: último producto + totales */}
        <div className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="relative hidden min-h-[170px] flex-1 overflow-hidden rounded-t-2xl sm:block" style={{ backgroundColor: ultimo && cart.length > 0 ? "#ffffff" : "#0b1f20" }}>
            {ultimo && cart.length > 0 ? (
              <>
                {/* La imagen del último producto ocupa TODO el recuadro. */}
                {ultimo.imagen_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ultimo.imagen_url} alt={ultimo.nombre} className="absolute inset-0 h-full w-full object-contain p-2" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-slate-200">
                    <Package className="h-28 w-28" />
                  </div>
                )}
                {/* Nombre + SKU sobre un degradado abajo, para que se lean sobre la foto. */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 pt-10 text-center">
                  <p className="truncate text-sm font-semibold text-white">{ultimo.nombre}</p>
                  <p className="font-mono text-[10px] text-white/70">{ultimo.sku}</p>
                </div>
              </>
            ) : (
              <div className="absolute inset-x-0 bottom-0 p-4 text-center">
                <p className="text-[11px] text-white/50">El último producto cargado se muestra acá.</p>
              </div>
            )}
          </div>

          <div className="space-y-2 border-t border-slate-100 px-5 py-3.5">
            <div className="flex items-baseline justify-between text-sm text-slate-500">
              <span>Ítems</span><span className="font-medium tabular-nums text-slate-800">{cantTotal}</span>
            </div>
            <div className="flex items-baseline justify-between text-sm text-slate-500">
              <span>IVA incluido</span><span className="tabular-nums text-slate-600">{formatGs(totalIva)}</span>
            </div>
            <div className="flex items-baseline justify-between border-t border-dashed border-slate-200 pt-2.5">
              <span className="text-sm font-medium text-slate-600">Total a cobrar</span>
              <span className="text-2xl font-bold tabular-nums text-slate-900">{formatGs(total)}</span>
            </div>
            <button type="button" onClick={abrirCobro} disabled={cart.length === 0 || haySinStock}
              className="w-full rounded-xl px-5 py-3 text-base font-semibold text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
              style={cart.length === 0 || haySinStock ? undefined : { backgroundColor: TEAL }}>
              {haySinStock ? "Falta stock" : "Aceptar y cobrar"}
            </button>
            {cobroError && !cobroOpen && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{cobroError}</p>}
          </div>
        </div>
      </div>
      </>
      )}

      {/* Modal de cobro */}
      {cobroOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!cobrando) setCobroOpen(false); }}>
          <div role="dialog" aria-modal className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Cobrar</h3>
              <p className="mt-1 text-sm text-slate-500">Total: <strong className="text-slate-900">{formatGs(total)}</strong> · {cantTotal} ítem{cantTotal === 1 ? "" : "s"}</p>
            </div>
            {tipoVenta === "CREDITO" ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-800">
                Venta <strong>a crédito</strong>{plazoDiasNum ? ` a ${plazoDiasNum} días` : ""}. Se registra en la cuenta corriente del cliente; no entra dinero a la caja ahora.
              </div>
            ) : (
              <>
                {/* Pago mixto: una fila por medio (método + monto). Suma = total. */}
                <div className="space-y-2">
                  {pagos.map((p) => (
                    <div key={p.id} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <Select value={p.metodo} onChange={(v) => setPagoMetodo(p.id, v as MetodoDetalle)} options={METODOS_PAGO.map((m) => [m.value, m.label])} block />
                      </div>
                      <MontoInput value={p.monto} onChange={(n) => setPagoMonto(p.id, n)} decimals={false}
                        className="w-32 shrink-0 rounded-md border border-slate-200 px-3 py-2 text-right text-sm font-semibold tabular-nums outline-none focus:ring-2" />
                      {pagos.length > 1 && (
                        <button type="button" onClick={() => quitarPago(p.id)} aria-label="Quitar método" className="shrink-0 rounded-md p-2 text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-500"><Trash2 className="h-4 w-4" /></button>
                      )}
                    </div>
                  ))}
                </div>
                <button type="button" onClick={agregarPago} className="text-xs font-semibold transition-colors hover:brightness-90" style={{ color: TEAL }}>
                  + Agregar método (pago mixto)
                </button>

                {/* Pagado / restante */}
                <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="flex justify-between text-slate-500"><span>Pagado</span><span className="tabular-nums">{formatGs(totalPagos)}</span></div>
                  <div className={`flex justify-between font-semibold ${restante === 0 ? "text-emerald-700" : restante > 0 ? "text-amber-700" : "text-rose-700"}`}>
                    <span>{restante === 0 ? "✓ Cuadra" : restante > 0 ? "Falta asignar" : "Te pasaste"}</span>
                    <span className="tabular-nums">{formatGs(Math.abs(restante))}</span>
                  </div>
                </div>

                {/* Vuelto de la parte en efectivo (opcional) */}
                {hayEfectivo && (
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-slate-700">Efectivo recibido <span className="font-normal text-slate-400">(para el vuelto)</span></span>
                    <MontoInput value={efectivoRecibido} onChange={(n) => setEfectivoRecibido(String(n))} placeholder={`${efectivoAplicado.toLocaleString("es-PY")} (exacto)`} decimals={false} autoFocus
                      className="w-full rounded-md border border-slate-200 px-3 py-2 text-lg tabular-nums outline-none focus:ring-2" />
                    {recibidoNum > 0 && (
                      faltaEfectivo > 0
                        ? <span className="mt-1 block text-xs font-medium text-rose-600">Falta {formatGs(faltaEfectivo)} en efectivo</span>
                        : <span className="mt-1 block text-xs font-medium text-emerald-700">Vuelto: {formatGs(vuelto)}</span>
                    )}
                  </label>
                )}
              </>
            )}
            {cobroError && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{cobroError}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setCobroOpen(false)} disabled={cobrando} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={() => void confirmarCobro()} disabled={cobrando || !cobroListo} className="rounded-lg px-5 py-2 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40" style={{ backgroundColor: TEAL }}>{cobrando ? "Cobrando…" : "Confirmar e imprimir"}</button>
            </div>
          </div>
        </div>
      )}

      {modalNuevoCliente && (
        <NuevoCliente
          onClose={() => setModalNuevoCliente(false)}
          onCreado={(c) => { setClientes((prev) => [c, ...prev]); setClienteId(c.id); setClienteQuery(""); setModalNuevoCliente(false); }}
        />
      )}
    </div>
  );
}

// ── Sub-componentes ──────────────────────────────────────────────────────────

function Atajo({ k, t }: { k: string; t: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 shadow-sm">{k}</kbd>
      <span>{t}</span>
    </span>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-slate-200">
      {options.map((opt) => {
        const sel = value === opt.value;
        return (
          <button key={opt.value} type="button" onClick={() => onChange(opt.value)}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${sel ? "text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            style={sel ? { backgroundColor: TEAL } : undefined}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ProdThumb({ url, nombre, className = "", contain, big }: { url?: string | null; nombre: string; className?: string; contain?: boolean; big?: boolean }) {
  return (
    <div className={`shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white ${className}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={nombre} className={`h-full w-full ${contain ? "object-contain p-1" : "object-cover"}`} />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-slate-300">
          <Package className={big ? "h-24 w-24" : "h-5 w-5"} />
        </div>
      )}
    </div>
  );
}
