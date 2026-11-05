"use client";

/** /inmobiliaria/panel — Panel de Inmobiliaria (el ítem del menú abre acá): una tarjeta con foto por pantalla. */
import { PanelModulo, hslDeMarca, type TarjetaPanel } from "@/components/ui/PanelModulo";
import { clienteConfig } from "@/cliente.config";

const TARJETAS: TarjetaPanel[] = [
  { href: "/inmobiliaria", titulo: "Propiedades", imagen: "/configuracion/empresa-edificios.webp", color: hslDeMarca(clienteConfig.color), posicion: "50% 45%" },
  { href: "/inmobiliaria/alquileres", titulo: "Alquileres", imagen: "/finanzas/credito-libro-cuentas.webp", color: "215 45% 24%", posicion: "50% 50%" },
];

export default function PanelInmobiliariaPage() {
  return (
    <PanelModulo
      kicker="Inmobiliaria"
      titulo="Inmobiliaria"
      subtitulo="Propiedades para vender o alquilar, ventas en cuotas, contratos de alquiler, liquidación a dueños y avisos a los clientes que buscan."
      tarjetas={TARJETAS}
      vacio="No tenés pantallas de Inmobiliaria habilitadas."
    />
  );
}
