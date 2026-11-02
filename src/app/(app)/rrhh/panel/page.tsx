"use client";

/** /rrhh/panel — Panel de RR HH (el ítem del menú abre acá): una tarjeta con foto por pantalla. */
import { PanelModulo, hslDeMarca, type TarjetaPanel } from "@/components/ui/PanelModulo";
import { clienteConfig } from "@/cliente.config";

const TARJETAS: TarjetaPanel[] = [
  { href: "/rrhh", titulo: "Personal", imagen: "/configuracion/usuarios-equipo.webp", color: hslDeMarca(clienteConfig.color), posicion: "50% 40%" },
  { href: "/rrhh/liquidaciones", titulo: "Liquidaciones", imagen: "/configuracion/facturacion-calculadora.webp", color: "26 50% 24%", posicion: "50% 50%" },
];

export default function PanelRrhhPage() {
  return (
    <PanelModulo
      kicker="RR HH"
      titulo="RR HH"
      subtitulo="Datos del personal, ausencias, vacaciones y la liquidación del mes."
      tarjetas={TARJETAS}
      vacio="No tenés pantallas de RR HH habilitadas."
    />
  );
}
