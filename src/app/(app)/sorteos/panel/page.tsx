"use client";

/** /sorteos/panel — Panel de Sorteos (el ítem del menú abre acá): una tarjeta con foto por pantalla. */
import { PanelModulo, hslDeMarca, type TarjetaPanel } from "@/components/ui/PanelModulo";
import { clienteConfig } from "@/cliente.config";

const TARJETAS: TarjetaPanel[] = [
  { href: "/sorteos", titulo: "Sorteos", imagen: "/finanzas/ordenes-venta-ticket-impreso.webp", color: hslDeMarca(clienteConfig.color), posicion: "50% 45%" },
  { href: "/sorteos/vender", titulo: "Vender", imagen: "/finanzas/nueva-venta-escaner-celular.webp", color: "160 45% 22%", posicion: "50% 50%" },
  { href: "/sorteos/ventas", titulo: "Compras", imagen: "/finanzas/caja-teclas-registradora.webp", color: "215 45% 24%", posicion: "50% 50%" },
  { href: "/sorteos/revision", titulo: "Por revisar", imagen: "/finanzas/conciliacion-planilla-laptop.webp", color: "35 60% 24%", posicion: "50% 50%" },
  { href: "/sorteos/vendedores", titulo: "Vendedores", imagen: "/configuracion/usuarios-equipo.webp", color: "265 35% 26%", posicion: "50% 40%" },
  { href: "/sorteos/whatsapp", titulo: "WhatsApp", imagen: "/omnicanal/conversaciones-chat-dueno.webp", color: "150 45% 20%", posicion: "50% 45%" },
];

export default function PanelSorteosPage() {
  return (
    <PanelModulo
      kicker="Sorteos"
      titulo="Sorteos"
      subtitulo="Sorteos y combos, ventas, pagos por revisar, vendedores, venta por WhatsApp, cupones para la urna y ganadores."
      tarjetas={TARJETAS}
      vacio="No tenés pantallas de Sorteos habilitadas."
    />
  );
}
