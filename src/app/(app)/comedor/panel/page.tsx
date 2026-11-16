"use client";

/** /comedor/panel — Panel de Comedor (el ítem del menú abre acá): una tarjeta con foto por pantalla. */
import { PanelModulo, hslDeMarca, type TarjetaPanel } from "@/components/ui/PanelModulo";
import { clienteConfig } from "@/cliente.config";

const TARJETAS: TarjetaPanel[] = [
  { href: "/comedor/funcionarios", titulo: "Funcionarios", imagen: "/comercial/clientes-fichero-contactos.webp", color: hslDeMarca(clienteConfig.color), posicion: "50% 45%" },
  { href: "/comedor/menu", titulo: "Menú semanal", imagen: "/comercial/agenda-planificador-escribiendo.webp", color: "35 60% 24%", posicion: "50% 50%" },
  { href: "/comedor/retiro", titulo: "Retiro", imagen: "/finanzas/nueva-venta-escaner-celular.webp", color: "160 45% 22%", posicion: "50% 50%" },
  { href: "/comedor/cantina", titulo: "Cantina", imagen: "/comercial/presupuestos-calculadora-notas.webp", color: "280 40% 26%", posicion: "50% 50%" },
  { href: "/comedor/liquidacion", titulo: "Liquidación", imagen: "/finanzas/pagos-proveedores-celular-laptop.webp", color: "200 45% 24%", posicion: "50% 50%" },
  { href: "/comedor/configuracion", titulo: "Configuración del comedor", imagen: "/configuracion/empresa-edificios.webp", color: "215 45% 24%", posicion: "50% 50%" },
];

export default function PanelComedorPage() {
  return (
    <PanelModulo
      kicker="Comedor"
      titulo="Comedor"
      subtitulo="Funcionarios y padrón de la empresa, con el subsidio mensual y el consumo del comedor."
      tarjetas={TARJETAS}
      vacio="No tenés pantallas de Comedor habilitadas."
    />
  );
}
