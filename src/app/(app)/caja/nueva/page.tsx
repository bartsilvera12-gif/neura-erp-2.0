"use client";

/**
 * Caja (POS) — portada de neura-erp-oymcomercial (/ventas), re-plomada al 2.0.
 * Layout de dos paneles: izquierda buscador/escaneo + carrito; derecha panel de
 * marca con el último producto + totales + descuento + "Aceptar y cobrar".
 * Venta de contado/crédito, descuento global, IVA por línea, edición de precio, ticket.
 * Caja por sucursal (receta 51): se vende en la caja abierta elegida (caja · sucursal ·
 * turno); el stock que se ve y se descuenta es el del depósito de ESA caja. Cobro con una
 * o varias formas de pago (efectivo con vuelto, débito, crédito, transferencia, QR…).
 */

import Link from "next/link";
import { Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, FileSignature, Package, Search, Trash2, X } from "lucide-react";
import { buscar, buscarEnIndice, indexar } from "@/lib/busqueda";
import { apiFetch } from "@/lib/api/client-fetch";
import { browserClient } from "@/lib/supabase/browser";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { clienteConfig } from "@/cliente.config";
import { QtyInput } from "@/components/ui/QtyInput";
import { NuevoCliente } from "@/modules/clientes/NuevoCliente";
import { CajaBarra } from "@/modules/caja/CajaBarra";
import { AperturaModal } from "@/modules/caja/AperturaModal";
import { MovimientoModal } from "@/modules/caja/MovimientoModal";
import { CierreModal } from "@/modules/caja/CierreModal";
import { TurnoModal } from "@/modules/caja/TurnoModal";
import { CobroModal, type PagoEnviar } from "@/modules/caja/CobroModal";
import { cajaEnUso, cajaGuardada, etiquetaCaja, guardarCaja, invalidarCajas, useEstadoCajas } from "@/modules/caja/turno";
import {
  calcIva,
  formatGs,
  precioSegunLista,
  type Cliente,
  type Producto,
  type TipoIva,
  type TipoPrecio,
} from "@/modules/caja/lib";
import { analizarConversion, type AnalisisConversion, type ConversionPresupuesto } from "@/modules/presupuestos/caja";

const TEAL = clienteConfig.color;

/** Presupuesto que se está cobrando (?presupuesto=<id>): líneas precargadas y sus avisos. */
type PresupuestoEnCaja =
  | { id: string; etiqueta: string; prospecto: string | null; a: AnalisisConversion; lineaDe: Record<string, string> }
  | { error: string };

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

// useSearchParams necesita un Suspense alrededor (si no, el build de Next falla).
export default function CajaPage() {
  return (
    <Suspense>
      <CajaPageContenido />
    </Suspense>
  );
}

function CajaPageContenido() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const me = useUsuario();

  // ── Caja (turno abierto) en la que se vende ────────────────────────────────
  // La elegida en este navegador (si sigue abierta), si no la que le toca al usuario.
  const [recargaCajas, setRecargaCajas] = useState(0);
  const { datos: estadoCajas } = useEstadoCajas(recargaCajas);
  const [elegida, setElegida] = useState<string | null>(null);
  useEffect(() => { setElegida(cajaGuardada(me?.usuarioId)); }, [me?.usuarioId]);
  const caja = useMemo(() => cajaEnUso(estadoCajas, elegida), [estadoCajas, elegida]);
  const elegirCaja = useCallback((id: string) => { setElegida(id); guardarCaja(me?.usuarioId, id); }, [me?.usuarioId]);
  const refrescarCajas = useCallback(() => { invalidarCajas(); setRecargaCajas((k) => k + 1); }, []);
  const [modalCaja, setModalCaja] = useState<null | "abrir" | "mov" | "cerrar" | "ver">(null);

  // ?cerrar=1 → abre la ventana de cierre de la caja en uso (links viejos de "Arqueo y cierre").
  const pedirCierre = searchParams.get("cerrar") === "1";
  useEffect(() => {
    if (!pedirCierre || !estadoCajas) return;
    if (caja) setModalCaja("cerrar");
    router.replace("/caja/nueva", { scroll: false });
  }, [pedirCierre, estadoCajas, caja, router]);

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

  // ── Cobro (una o varias formas de pago: CobroModal) ─────────────────────────
  const [cobroOpen, setCobroOpen] = useState(false);
  const [cobrando, setCobrando] = useState(false);
  const [cobroError, setCobroError] = useState<string | null>(null);
  const [ventaOk, setVentaOk] = useState<{ numero: string; vuelto: number } | null>(null);
  const isSubmittingRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);

  // Espejo del estado para los atajos de teclado (se asigna en cada render).
  const kbRef = useRef<{
    abrirCobro: () => void;
    cobroOpen: boolean;
    modalAbierto: boolean;
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
  // Catálogo liviano para la caja (?pos=1: solo lo que usa el POS, sin costos, y COMPLETO
  // aunque pase de 1000). Clientes: solo unos pocos para las sugerencias; al escribir se
  // busca en la base.
  // Stock del depósito de la caja en uso (cambia si se cambia de caja).
  const depositoCaja = caja?.deposito_id ?? null;
  useEffect(() => {
    if (!depositoCaja) return;
    let vivo = true;
    apiFetch<Producto[]>(`/api/productos?pos=1&deposito=${depositoCaja}`).then((p) => { if (vivo) setProductos(p); }).catch(() => {});
    return () => { vivo = false; };
  }, [depositoCaja]);
  useEffect(() => {
    // Se suma a lo que ya haya (p. ej. el cliente que llega preelegido con ?cliente=).
    apiFetch<Cliente[]>("/api/clientes?limit=20")
      .then((r) => setClientes((prev) => [...prev.filter((p) => !r.some((x) => x.id === p.id)), ...r]))
      .catch(() => {});
  }, []);

  // ?cliente=<id> (desde Gestión del Cliente → "Facturar venta"): solo deja ese cliente elegido.
  const clientePre = searchParams.get("cliente");
  const clientePreHecho = useRef(false);
  useEffect(() => {
    if (!clientePre || clientePreHecho.current) return;
    clientePreHecho.current = true;
    apiFetch<{ cliente: Cliente }>(`/api/clientes/${encodeURIComponent(clientePre)}`)
      .then(({ cliente: c }) => {
        if (!c?.id) return;
        setClientes((prev) => (prev.some((x) => x.id === c.id) ? prev : [c, ...prev]));
        setClienteId(c.id);
      })
      .catch(() => {});
  }, [clientePre]);

  // ?presupuesto=<id> (Presupuestos → "Convertir a venta"): carga cliente, condición, líneas,
  // cantidades, precios y descuentos del presupuesto. No cambia nada solo: si cambió el precio
  // de lista o hay líneas que no pasan, lo avisa arriba. Al cobrar, la venta queda ligada.
  const presupuestoPre = searchParams.get("presupuesto");
  const [presu, setPresu] = useState<PresupuestoEnCaja | null>(null);
  const [ventaPresu, setVentaPresu] = useState<string | null>(null);
  const presuHecho = useRef<string | null>(null);
  useEffect(() => {
    if (!presupuestoPre || presuHecho.current === presupuestoPre) return;
    presuHecho.current = presupuestoPre;
    apiFetch<ConversionPresupuesto>(`/api/presupuestos/${encodeURIComponent(presupuestoPre)}/conversion`)
      .then((conv) => {
        const p = conv.presupuesto;
        const etiqueta = p.revision > 1 ? `${p.numero} rev ${p.revision}` : p.numero;
        if (p.estado === "convertido" || p.estado === "rechazado") {
          setPresu({ error: `El presupuesto ${etiqueta} está ${p.estado === "convertido" ? "ya convertido en venta" : "rechazado"}: no se cargó.` });
          return;
        }
        const a = analizarConversion(conv);
        const t = Date.now();
        const lineaDe: Record<string, string> = {};
        setCart(a.lineas.map((l, i) => {
          const id = `pre_${l.item_id}_${t}_${i}`;
          lineaDe[l.item_id] = id;
          // Precio del presupuesto fijado (tier_manual: no lo pisa el escalonado por cantidad).
          return { cart_line_id: id, producto: l.producto, cantidad: l.cantidad, tipo_iva: l.tipo_iva, precio_override: l.precio_override, tier_manual: true, tipo_precio: "minorista", descuento_pct: l.descuento_pct };
        }));
        setUltimo(a.lineas.length ? a.lineas[a.lineas.length - 1].producto : null);
        if (conv.cliente) {
          const c = conv.cliente;
          setClientes((prev) => (prev.some((x) => x.id === c.id) ? prev : [c, ...prev]));
          setClienteId(c.id);
        }
        if (p.condicion === "credito") { setTipoVenta("CREDITO"); setPlazoDias(p.plazo_dias ? String(p.plazo_dias) : ""); }
        else { setTipoVenta("CONTADO"); setPlazoDias(""); }
        setPresu({ id: p.id, etiqueta, prospecto: conv.cliente ? null : `${p.cliente_nombre}${p.cliente_ruc ? ` (${p.cliente_ruc})` : ""}`, a, lineaDe });
      })
      .catch((e) => setPresu({ error: `No se pudo cargar el presupuesto: ${(e as Error).message}` }));
  }, [presupuestoPre]);

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

      // Con el cobro (o una ventana de la caja) abierto, el teclado es de esa ventana.
      if (s.cobroOpen || s.modalAbierto) return;

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
  // Búsqueda inteligente: nombre, SKU y código de barras (lector), sin tildes, en cualquier
  // orden y con errores de tipeo; un código exacto va primero (Enter lo agrega).
  // El catálogo se normaliza UNA vez (índice) y la lista se calcula con la consulta
  // "diferida": tipear no se traba aunque el catálogo sea grande.
  const indice = useMemo(() => indexar(productos, (p) => ({ principal: p.nombre, codigos: [p.sku, p.codigo_barras] })), [productos]);
  const qDiferida = useDeferredValue(q);
  const hitsDiferidos = useMemo(() => (qDiferida.trim() ? buscarEnIndice(indice, qDiferida, 8) : []), [indice, qDiferida]);
  const hits = q.trim() ? hitsDiferidos : [];

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

  // Lotes vencidos (NO bloquea): lo pedido supera lo que no está vencido. La base vende
  // solo de lotes vigentes (primero el que vence antes) y el resto queda sin lote.
  const conVencidos = useMemo(() => {
    const pedido = new Map<string, number>();
    for (const l of cart) if (l.producto.stock_vencido) pedido.set(l.producto.id, (pedido.get(l.producto.id) ?? 0) + l.cantidad);
    const out: { id: string; nombre: string; vigente: number; pedido: number }[] = [];
    for (const [id, cant] of pedido) {
      const p = cart.find((l) => l.producto.id === id)!.producto;
      const vigente = Math.max(0, Number(p.stock_actual) - Number(p.stock_vencido ?? 0));
      if (cant > vigente && !idsSinStock.has(id)) out.push({ id, nombre: p.nombre, vigente, pedido: cant });
    }
    return out;
  }, [cart, idsSinStock]);
  const idsVencidos = useMemo(() => new Set(conVencidos.map((v) => v.id)), [conVencidos]);

  // Cliente seleccionado / filtrado.
  const clienteSel = useMemo(() => clientes.find((c) => c.id === clienteId) ?? null, [clientes, clienteId]);
  // Con texto, busca en la base (todos los clientes, no solo los cargados) y mientras
  // llega la respuesta usa los que ya están en pantalla con la misma lógica.
  const clientesFiltrados = useMemo(
    () =>
      (clienteQuery.trim() === ""
        ? clientes
        : clientesBuscados ?? buscar(clientes, clienteQuery, (c) => ({ principal: c.razon_social || c.nombre, otros: [c.nombre, c.telefono], codigos: [c.documento, c.ruc] }))
      ).slice(0, 50),
    [clientes, clienteQuery, clientesBuscados],
  );

  const clienteObligatorio = tipoDocumento === "factura" || tipoVenta === "CREDITO";
  const plazoDiasNum = parseInt(plazoDias) || 0;

  // Presupuesto: se liga a la venta solo si en el carrito queda alguna de sus líneas.
  const presuOk = presu && !("error" in presu) ? presu : null;
  const presuActivo = presuOk && cart.some((l) => Object.values(presuOk.lineaDe).includes(l.cart_line_id)) ? presuOk : null;
  function usarPreciosDeHoy() {
    if (!presuOk) return;
    const ids = new Set(presuOk.a.cambiosPrecio.map((c) => presuOk.lineaDe[c.item_id]));
    setCart((prev) => prev.map((l) => (ids.has(l.cart_line_id) ? { ...l, precio_override: null, tier_manual: false } : l)));
    setPresu({ ...presuOk, a: { ...presuOk.a, cambiosPrecio: [] } });
  }
  function desvincularPresupuesto() {
    setPresu(null);
    router.replace("/caja/nueva", { scroll: false });
  }

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
      // El lector de códigos tipea rápido y aprieta Enter: si la lista todavía es la de una
      // consulta vieja (diferida), se busca YA con lo escrito para no agregar otro producto.
      const alDia = qDiferida === q;
      const lista = alDia ? hits : q.trim() ? buscarEnIndice(indice, q, 8) : [];
      const pick = alDia && hitsHighlight >= 0 ? lista[hitsHighlight] : lista[0];
      if (pick) addToCart(pick);
    }
  }

  // ── Cobro ──────────────────────────────────────────────────────────────────
  function abrirCobro() {
    setCobroError(null);
    if (cart.length === 0 || haySinStock) return;
    if (!caja) {
      setCobroError("Abrí (o elegí) la caja en la que vas a vender.");
      return;
    }
    if (clienteObligatorio && !clienteId) {
      setCobroError(tipoDocumento === "factura" ? "Para emitir factura elegí un cliente." : "La venta a crédito requiere un cliente.");
      return;
    }
    if (tipoVenta === "CREDITO" && plazoDiasNum < 1) {
      setCobroError("Ingresá un plazo de crédito de al menos 1 día.");
      return;
    }
    setCobroOpen(true);
  }

  async function confirmarCobro(pagos: PagoEnviar[]) {
    if (isSubmittingRef.current || !caja) return;
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
      const venta = await apiFetch<{ venta_id: string; numero_control: string; total: number; vuelto?: number; aviso_presupuesto?: string }>("/api/caja/venta", {
        method: "POST",
        body: JSON.stringify({
          caja_id: caja.id,
          cliente_id: clienteId || null,
          tipo_venta: tipoVenta,
          moneda: "GS",
          idempotency_key: idempotencyKeyRef.current,
          plazo_dias: tipoVenta === "CREDITO" ? plazoDiasNum : undefined,
          items,
          // Formas de pago (solo contado). La base valida que sumen el total.
          pagos: tipoVenta === "CREDITO" ? undefined : pagos,
          presupuesto_id: presuActivo?.id,
        }),
      });
      idempotencyKeyRef.current = null;
      if (presuActivo) {
        setVentaPresu(venta.aviso_presupuesto ?? `Presupuesto ${presuActivo.etiqueta} convertido en venta.`);
        setPresu(null);
        router.replace("/caja/nueva", { scroll: false });
      } else {
        setVentaPresu(null);
      }
      // Stock: se descuenta en pantalla lo recién vendido (antes se volvía a bajar TODO el
      // catálogo después de cada venta). La base igual valida el stock al vender.
      const vendido = new Map<string, number>();
      for (const l of cart) if (l.producto.controla_stock) vendido.set(l.producto.id, (vendido.get(l.producto.id) ?? 0) + l.cantidad);
      if (vendido.size) setProductos((prev) => prev.map((p) => (vendido.has(p.id) ? { ...p, stock_actual: Number(p.stock_actual) - (vendido.get(p.id) ?? 0) } : p)));
      // Ticket imprimible (SIFEN inactivo → por ahora siempre ticket). La auth del
      // 2.0 es por Bearer, así que una pestaña nueva no lleva el token: traemos el
      // HTML con el token y lo abrimos como blob (el auto-print corre igual).
      void imprimirTicket(venta.venta_id);
      setVentaOk({ numero: venta.numero_control, vuelto: Number(venta.vuelto) || 0 });
      setCobroOpen(false);
      vaciarCarrito();
      setClienteId("");
      setClienteQuery("");
      setTipoVenta("CONTADO");
      setPlazoDias("");
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch (e) {
      const msg = (e as Error).message;
      setCobroError(msg);
      // La caja se cerró (u otra cosa cambió) mientras se vendía: se refresca el estado.
      if (/caja/i.test(msg)) refrescarCajas();
    } finally {
      isSubmittingRef.current = false;
      setCobrando(false);
    }
  }

  // Espejo del estado para los atajos de teclado (siempre el último valor).
  kbRef.current = {
    abrirCobro, cobroOpen, modalAbierto: modalCaja !== null || modalNuevoCliente, cart, q, inputRef,
    updateCant, removeFromCart, setCobroOpen, setQ, setClienteOpen,
  };

  // El aviso de "venta registrada" se va solo (con vuelto queda más tiempo, para leerlo).
  useEffect(() => {
    if (!ventaOk) return;
    const t = setTimeout(() => setVentaOk(null), ventaOk.vuelto > 0 ? 12000 : 6000);
    return () => clearTimeout(t);
  }, [ventaOk]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-0 flex-col gap-3">
      {/* Header compacto: todo en una línea para no gastar alto vertical. */}
      <div className="flex shrink-0 items-center justify-between gap-4">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">Caja</h1>
          <span className="hidden text-xs text-slate-400 sm:inline">· Escaneá y cobrá directo</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href="/caja/turnos" className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Apertura y cierre
          </Link>
          <Link href="/caja" className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Órdenes de venta →
          </Link>
        </div>
      </div>

      {/* Caja en la que se vende: sin caja abierta no se puede cobrar. */}
      <div className="shrink-0">
        <CajaBarra estado={estadoCajas} caja={caja} onElegir={elegirCaja}
          onAbrir={() => setModalCaja("abrir")} onMov={() => setModalCaja("mov")}
          onVer={() => setModalCaja("ver")} onCerrar={() => setModalCaja("cerrar")} />
      </div>

      {ventaOk && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 shadow-sm">
          <CheckCircle2 className="h-5 w-5" />
          <span>Venta <strong>{ventaOk.numero}</strong> registrada. Ticket enviado a imprimir.</span>
          {ventaOk.vuelto > 0 ? (
            <span className="rounded-lg bg-white px-3 py-1 text-base font-extrabold tabular-nums text-emerald-700 ring-1 ring-emerald-200">Vuelto {formatGs(ventaOk.vuelto)}</span>
          ) : null}
          {ventaPresu ? <span className="font-normal">{ventaPresu}</span> : null}
          <button type="button" onClick={() => setVentaOk(null)} aria-label="Cerrar aviso" className="ml-auto text-emerald-500 hover:text-emerald-800"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Venta desde un presupuesto: qué se cargó y qué revisar antes de cobrar. */}
      {presu ? (
        "error" in presu ? (
          <div className="flex shrink-0 items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">
            <span>{presu.error}</span>
            <button type="button" onClick={desvincularPresupuesto} aria-label="Cerrar" className="text-rose-400 hover:text-rose-700"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <div className="shrink-0 space-y-1 rounded-xl border px-4 py-2.5 text-sm" style={{ borderColor: `${TEAL}55`, backgroundColor: `${TEAL}10` }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-slate-800">
                <FileSignature className="h-4 w-4 shrink-0" style={{ color: TEAL }} />
                {presuActivo
                  ? <span>Venta del presupuesto <Link href={`/presupuestos/${presu.id}`} className="font-mono font-semibold hover:underline">{presu.etiqueta}</Link>: al cobrar queda como <b>convertido</b>.</span>
                  : <span>Sacaste todas las líneas del presupuesto <b className="font-mono">{presu.etiqueta}</b>: esta venta no se va a ligar a él.</span>}
              </p>
              <button type="button" onClick={desvincularPresupuesto} className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-white/70 hover:text-slate-800">Desvincular</button>
            </div>
            {presu.prospecto ? <p className="text-xs text-amber-800">Es para un prospecto: {presu.prospecto}. Elegí o cargá el cliente si vas a facturar o vender a crédito.</p> : null}
            {presu.a.enDolares ? <p className="text-xs text-slate-600">Estaba en dólares: los precios se pasaron a guaraníes con la cotización del presupuesto.</p> : null}
            {presu.a.cambiosPrecio.length ? (
              <p className="text-xs text-amber-800">
                Cambió el precio de lista desde que se cotizó: {presu.a.cambiosPrecio.map((c) => `${c.nombre} (cotizado ${formatGs(c.cotizado)}, hoy ${formatGs(c.hoy)})`).join(" · ")}. Se cobra lo cotizado.{" "}
                <button type="button" onClick={usarPreciosDeHoy} className="font-semibold underline underline-offset-2 hover:text-amber-950">Usar precios de hoy</button>
              </p>
            ) : null}
            {presu.a.libres.length || presu.a.inactivos.length ? (
              <p className="text-xs text-rose-700">
                No se cargaron (no son productos vendibles del catálogo): {[...presu.a.libres.map((l) => l.descripcion), ...presu.a.inactivos.map((x) => x.nombre)].join(", ")}.
              </p>
            ) : null}
          </div>
        )
      ) : null}

      {!caja ? (
        <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
          {estadoCajas ? (estadoCajas.abiertas.length > 1 ? "Elegí arriba la caja en la que vas a vender." : "Abrí la caja para empezar a cobrar.") : "Cargando la caja…"}
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
            {q.trim().length >= 2 && qDiferida === q && hits.length === 0 && (
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
            {conVencidos.length > 0 && (
              <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
                <p className="text-sm font-semibold text-amber-800">⚠ Hay unidades de lotes vencidos</p>
                <ul className="mt-1 space-y-0.5 text-xs text-amber-900">
                  {conVencidos.map((v) => (
                    <li key={v.id} className="tabular-nums">
                      <strong>{v.nombre}</strong> · {v.vigente > 0 ? `sin vencer quedan ${v.vigente}` : "solo queda stock vencido"} / Solicitado: {v.pedido}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-amber-800">Revisá la fecha antes de entregar. Podés cobrar igual.</p>
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
                            {!sinStockLinea && idsVencidos.has(l.producto.id) && <span className="rounded-full border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">⚠ Vencido</span>}
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

      {/* Cobro: formas de pago (mixto, vuelto) o crédito */}
      {cobroOpen && (
        <CobroModal total={total} cantItems={cantTotal} tipoVenta={tipoVenta} plazoDias={plazoDiasNum} cliente={clienteSel}
          cobrando={cobrando} error={cobroError} onClose={() => { setCobroOpen(false); setCobroError(null); }}
          onConfirmar={(p) => void confirmarCobro(p)} />
      )}

      {/* Ventanas de la caja (abrir, retiro / ingreso, turno, cierre) */}
      {modalCaja === "abrir" && estadoCajas ? (
        <AperturaModal estado={estadoCajas} onClose={() => setModalCaja(null)}
          onAbierta={(id) => { setModalCaja(null); elegirCaja(id); refrescarCajas(); setTimeout(() => inputRef.current?.focus(), 0); }} />
      ) : null}
      {modalCaja === "mov" && caja ? (
        <MovimientoModal cajaId={caja.id} etiqueta={`${etiquetaCaja(caja)} · Turno N° ${caja.numero_caja}`}
          efectivoDisponible={estadoCajas?.sucursales.flatMap((s) => s.cajas).find((c) => c.turno?.id === caja.id)?.turno?.efectivo_esperado ?? null}
          onClose={() => setModalCaja(null)} onHecho={() => { setModalCaja(null); refrescarCajas(); }} />
      ) : null}
      {modalCaja === "ver" && caja ? (
        <TurnoModal turnoId={caja.id} onClose={() => setModalCaja(null)} onCambio={refrescarCajas} onCerrar={() => setModalCaja("cerrar")} />
      ) : null}
      {modalCaja === "cerrar" && caja ? (
        <CierreModal turnoId={caja.id} onClose={() => setModalCaja(null)} onCerrada={refrescarCajas} />
      ) : null}

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
