"use client";

import { useCallback, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api/client-fetch";
import {
  calcIva,
  precioSegunLista,
  type Cliente,
  type MetodoCobro,
  type Moneda,
  type Producto,
  type TipoIva,
  type TipoPrecio,
} from "@/modules/caja/lib";

/**
 * Estado y reglas del flujo de caja. Portado de distribuidorajm (useCajaVenta),
 * re-plomado al 2.0: sin repartos/camiones, y la confirmación llama al backend
 * transaccional (`POST /api/caja/venta`). Toda la pantalla es presentación; acá
 * vive lo que decide.
 */

export type ItemCarrito = { producto: Producto; cantidad: number; tipoPrecio: TipoPrecio; tierManual: boolean; tipoIva: TipoIva };

/**
 * Escalonado por cantidad (regla del negocio): a partir de 10 unidades cambia a
 * mayorista y a partir de 20 a distribuidor. Se aplica solo al cambiar la cantidad;
 * el selector por ítem permite anularlo a mano hasta el próximo cambio de cantidad.
 */
const UMBRAL_MAYORISTA = 10;
const UMBRAL_DISTRIBUIDOR = 20;
function tierPorCantidad(c: number): TipoPrecio {
  if (c >= UMBRAL_DISTRIBUIDOR) return "distribuidor";
  if (c >= UMBRAL_MAYORISTA) return "mayorista";
  return "minorista";
}

export type VentaCreada = { venta_id: string; numero_control: string; total: number };

export type Comprobante = {
  numero_control: string;
  total: number;
  nombreCliente: string;
  aCredito: boolean;
  metodoPago: MetodoCobro | null;
  fecha: string;
};

export function useCajaVenta() {
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [sinNombre, setSinNombre] = useState(false);
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [moneda, setMoneda] = useState<Moneda>("GS");
  const [metodoPago, setMetodoPago] = useState<MetodoCobro | null>(null);
  const [aCredito, setACredito] = useState(false);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ventaCreada, setVentaCreada] = useState<VentaCreada | null>(null);
  const [comprobante, setComprobante] = useState<Comprobante | null>(null);

  // ── Carrito ──────────────────────────────────────────────────────────────
  const cantidadDe = useCallback(
    (id: string) => carrito.find((i) => i.producto.id === id)?.cantidad ?? 0,
    [carrito],
  );

  const cambiarCantidad = useCallback((producto: Producto, delta: number) => {
    setError(null);
    setCarrito((prev) => {
      const idx = prev.findIndex((i) => i.producto.id === producto.id);
      const actual = idx === -1 ? 0 : prev[idx].cantidad;
      // El tope es el stock: el servidor la rechazaría igual, mejor verlo al tocar.
      const tope = producto.controla_stock ? producto.stock_actual : Infinity;
      const sig = Math.max(0, Math.min(actual + delta, tope));
      if (sig === 0) return prev.filter((i) => i.producto.id !== producto.id);
      if (idx === -1) return [...prev, { producto, cantidad: sig, tipoPrecio: tierPorCantidad(sig), tierManual: false, tipoIva: producto.tipo_iva }];
      const copia = [...prev];
      // Si el cajero fijó el precio a mano, el automático no lo pisa.
      const tp = copia[idx].tierManual ? copia[idx].tipoPrecio : tierPorCantidad(sig);
      copia[idx] = { ...copia[idx], cantidad: sig, tipoPrecio: tp };
      return copia;
    });
  }, []);

  const fijarCantidad = useCallback((producto: Producto, cantidad: number) => {
    setError(null);
    const tope = producto.controla_stock ? producto.stock_actual : Infinity;
    const limpia = Math.max(0, Math.min(Math.floor(cantidad), tope));
    setCarrito((prev) => {
      if (limpia === 0) return prev.filter((i) => i.producto.id !== producto.id);
      const idx = prev.findIndex((i) => i.producto.id === producto.id);
      if (idx === -1) return [...prev, { producto, cantidad: limpia, tipoPrecio: tierPorCantidad(limpia), tierManual: false, tipoIva: producto.tipo_iva }];
      const copia = [...prev];
      const tp = copia[idx].tierManual ? copia[idx].tipoPrecio : tierPorCantidad(limpia);
      copia[idx] = { ...copia[idx], cantidad: limpia, tipoPrecio: tp };
      return copia;
    });
  }, []);

  const quitarItem = useCallback((id: string) => {
    setCarrito((prev) => prev.filter((i) => i.producto.id !== id));
  }, []);

  /** El cajero fija el precio a mano: queda FIJO (el automático ya no lo pisa). */
  const cambiarTipoPrecio = useCallback((id: string, tipoPrecio: TipoPrecio) => {
    setCarrito((prev) => prev.map((i) => (i.producto.id === id ? { ...i, tipoPrecio, tierManual: true } : i)));
  }, []);

  /** Vuelve al precio automático por cantidad para ese producto. */
  const volverAuto = useCallback((id: string) => {
    setCarrito((prev) => prev.map((i) => (i.producto.id === id ? { ...i, tierManual: false, tipoPrecio: tierPorCantidad(i.cantidad) } : i)));
  }, []);

  /** IVA por PRODUCTO: por defecto el del catálogo, editable por línea. */
  const cambiarIva = useCallback((id: string, tipoIva: TipoIva) => {
    setCarrito((prev) => prev.map((i) => (i.producto.id === id ? { ...i, tipoIva } : i)));
  }, []);

  // ── Totales (display; el servidor recalcula desde el catálogo) ─────────────
  const lineas = useMemo(
    () =>
      carrito.map((item) => {
        const precio = precioSegunLista(item.producto, item.tipoPrecio);
        const totalLinea = Math.round(precio * item.cantidad);
        return {
          producto: item.producto,
          cantidad: item.cantidad,
          tipoPrecio: item.tipoPrecio,
          tierManual: item.tierManual,
          tipoIva: item.tipoIva,
          precio,
          montoIva: calcIva(item.tipoIva, totalLinea),
          totalLinea,
        };
      }),
    [carrito],
  );

  const totales = useMemo(() => {
    const total = lineas.reduce((a, l) => a + l.totalLinea, 0);
    const montoIva = lineas.reduce((a, l) => a + l.montoIva, 0);
    return { total, montoIva };
  }, [lineas]);

  // ── Reglas ─────────────────────────────────────────────────────────────────
  const clienteElegido = cliente !== null || sinNombre;
  const creditoDisponible = cliente !== null;

  const motivoNoConfirmar = useMemo<string | null>(() => {
    if (!clienteElegido) return "Elegí el cliente, o tocá «Sin nombre» para vender sin identificarlo.";
    if (carrito.length === 0) return "Agregá al menos un producto.";
    if (aCredito && !creditoDisponible) return "El crédito necesita un cliente identificado.";
    if (!aCredito && metodoPago === null) return "Elegí con qué se cobra.";
    return null;
  }, [clienteElegido, carrito.length, aCredito, creditoDisponible, metodoPago]);

  const puedeConfirmar = motivoNoConfirmar === null;

  // ── Acciones de cliente ──────────────────────────────────────────────────
  const elegirCliente = useCallback((c: Cliente) => {
    setCliente(c);
    setSinNombre(false);
  }, []);
  const elegirSinNombre = useCallback(() => {
    setCliente(null);
    setSinNombre(true);
    setACredito(false);
  }, []);

  const limpiar = useCallback(() => {
    setCliente(null);
    setSinNombre(false);
    setCarrito([]);
    setMoneda("GS");
    setMetodoPago(null);
    setACredito(false);
    setError(null);
  }, []);

  // ── Confirmación ───────────────────────────────────────────────────────────
  const confirmar = useCallback(async () => {
    if (guardando || !puedeConfirmar) return;
    setGuardando(true);
    setError(null);
    try {
      const venta = await apiFetch<VentaCreada>("/api/caja/venta", {
        method: "POST",
        body: JSON.stringify({
          cliente_id: cliente?.id ?? null,
          tipo_venta: aCredito ? "CREDITO" : "CONTADO",
          metodo_pago: aCredito ? "otro" : (metodoPago ?? "efectivo"),
          moneda,
          idempotency_key: crypto.randomUUID(),
          items: carrito.map((i) => ({
            producto_id: i.producto.id,
            cantidad: i.cantidad,
            tipo_precio: i.tipoPrecio,
            tipo_iva: i.tipoIva,
          })),
        }),
      });
      setComprobante({
        numero_control: venta.numero_control,
        total: venta.total,
        nombreCliente: cliente?.nombre ?? "Sin nombre",
        aCredito,
        metodoPago: aCredito ? null : metodoPago,
        fecha: new Date().toISOString(),
      });
      setVentaCreada(venta);
      limpiar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }, [guardando, puedeConfirmar, cliente, aCredito, metodoPago, moneda, carrito, limpiar]);

  const reiniciar = useCallback(() => {
    limpiar();
    setComprobante(null);
    setVentaCreada(null);
  }, [limpiar]);

  return {
    cliente,
    sinNombre,
    carrito,
    lineas,
    totales,
    moneda,
    metodoPago,
    aCredito,
    guardando,
    error,
    ventaCreada,
    comprobante,
    clienteElegido,
    creditoDisponible,
    puedeConfirmar,
    motivoNoConfirmar,
    cantidadDe,
    cambiarCantidad,
    fijarCantidad,
    quitarItem,
    cambiarTipoPrecio,
    volverAuto,
    cambiarIva,
    setMoneda,
    setMetodoPago,
    setACredito,
    setError,
    elegirCliente,
    elegirSinNombre,
    confirmar,
    reiniciar,
  };
}

export type CajaVenta = ReturnType<typeof useCajaVenta>;
