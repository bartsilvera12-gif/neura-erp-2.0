"use client";

/**
 * /caja/panel — Panel de Caja (el ítem "Caja" del menú lateral abre acá; es su propia familia,
 * separada de Finanzas): una tarjeta con foto por sub-pantalla (PanelModulo → TarjetaImagen). Las
 * rutas no cambian (Órdenes de venta sigue en /caja). Se muestran solo las que el perfil puede
 * abrir. Fotos y créditos: public/finanzas/ y docs/creditos-imagenes-demo.md (sección "Panel Finanzas").
 */
import { PanelModulo, hslDeMarca, type TarjetaPanel } from "@/components/ui/PanelModulo";
import { clienteConfig } from "@/cliente.config";

const TARJETAS: TarjetaPanel[] = [
  { href: "/caja/nueva", titulo: "Nueva venta", imagen: "/finanzas/nueva-venta-escaner-celular.webp", color: hslDeMarca(clienteConfig.color), posicion: "50% 45%" },
  { href: "/caja/turnos", titulo: "Apertura y cierre", imagen: "/finanzas/apertura-cierre-billetes-mano.webp", color: "152 34% 22%", posicion: "50% 50%" },
  { href: "/caja", titulo: "Órdenes de venta", imagen: "/finanzas/ordenes-venta-ticket-impreso.webp", color: "214 40% 24%", posicion: "55% 40%" },
  // Receta 99: foto prestada (la de crédito: libro de cuentas) hasta tener una propia.
  { href: "/caja/notas-credito", titulo: "Notas de crédito", imagen: "/finanzas/credito-libro-cuentas.webp", color: "346 38% 26%", posicion: "50% 50%" },
  { href: "/caja/mesas", titulo: "Pedidos de mesas", imagen: "/finanzas/ordenes-compra-caja-pedido.webp", color: "24 55% 24%", posicion: "50% 45%" },
  { href: "/caja/cocina", titulo: "Cocina", imagen: "/soporte/mis-tickets-lista-pendientes.webp", color: "8 45% 24%", posicion: "50% 45%" },
  // Receta 77: foto prestada (la de compras: canasto) hasta tener una propia — ver docs/creditos-imagenes-demo.md.
  { href: "/caja/pedidos", titulo: "Pedidos", imagen: "/finanzas/compras-canasto-supermercado.webp", color: "262 32% 26%", posicion: "50% 50%" },
];

export default function PanelCajaPage() {
  return (
    <PanelModulo
      kicker="Caja"
      titulo="Caja"
      subtitulo="Vender, abrir y cerrar las cajas, las ventas de contado y a crédito, los pedidos de mostrador y los de las mesas."
      tarjetas={TARJETAS}
      vacio="No tenés pantallas de Caja habilitadas."
    />
  );
}
