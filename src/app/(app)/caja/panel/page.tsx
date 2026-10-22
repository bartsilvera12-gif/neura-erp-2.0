"use client";

/**
 * /caja/panel — Panel de Caja (la tarjeta "Caja" de /finanzas abre acá): una tarjeta con foto por
 * sub-pantalla (PanelModulo → TarjetaImagen). Las rutas no cambian (Órdenes de venta sigue en
 * /caja). Se muestran solo las que el perfil puede abrir. Fotos y créditos: public/finanzas/ y
 * docs/creditos-imagenes-demo.md (sección "Panel Finanzas").
 */
import { PanelModulo, hslDeMarca, type TarjetaPanel } from "@/components/ui/PanelModulo";
import { clienteConfig } from "@/cliente.config";

const TARJETAS: TarjetaPanel[] = [
  { href: "/caja/nueva", titulo: "Nueva venta", imagen: "/finanzas/nueva-venta-escaner-celular.webp", color: hslDeMarca(clienteConfig.color), posicion: "50% 45%" },
  { href: "/caja/turnos", titulo: "Apertura y cierre", imagen: "/finanzas/apertura-cierre-billetes-mano.webp", color: "152 34% 22%", posicion: "50% 50%" },
  { href: "/caja", titulo: "Órdenes de venta", imagen: "/finanzas/ordenes-venta-ticket-impreso.webp", color: "214 40% 24%", posicion: "55% 40%" },
  { href: "/caja/credito", titulo: "Ventas a crédito", imagen: "/finanzas/credito-libro-cuentas.webp", color: "352 38% 27%", posicion: "50% 40%" },
  { href: "/caja/mesas", titulo: "Pedidos de mesas", imagen: "/finanzas/ordenes-compra-caja-pedido.webp", color: "24 55% 24%", posicion: "50% 45%" },
  { href: "/caja/cocina", titulo: "Cocina", imagen: "/soporte/mis-tickets-lista-pendientes.webp", color: "8 45% 24%", posicion: "50% 45%" },
];

export default function PanelCajaPage() {
  return (
    <PanelModulo
      volver={{ href: "/finanzas", label: "Finanzas" }}
      kicker="Finanzas"
      titulo="Caja"
      subtitulo="Vender, abrir y cerrar las cajas, las ventas de contado y a crédito, y los pedidos de las mesas."
      tarjetas={TARJETAS}
      vacio="No tenés pantallas de Caja habilitadas."
    />
  );
}
