"use client";

/** /gimnasio/panel — Panel de Asistencia (el ítem del menú abre acá): una tarjeta con foto por pantalla. */
import { PanelModulo, hslDeMarca, type TarjetaPanel } from "@/components/ui/PanelModulo";
import { clienteConfig } from "@/cliente.config";

const TARJETAS: TarjetaPanel[] = [
  { href: "/gimnasio", titulo: "Recepción", imagen: "/comercial/clientes-fichero-contactos.webp", color: hslDeMarca(clienteConfig.color), posicion: "50% 45%" },
  { href: "/gimnasio/clases", titulo: "Clases", imagen: "/comercial/agenda-planificador-escribiendo.webp", color: "215 45% 24%", posicion: "50% 50%" },
  { href: "/gimnasio/autoasistencia", titulo: "Que el alumno marque solo", imagen: "/finanzas/nueva-venta-escaner-celular.webp", color: "35 60% 24%", posicion: "50% 50%" },
  { href: "/gimnasio/comisiones", titulo: "Comisiones de profesores", imagen: "/finanzas/pagos-proveedores-celular-laptop.webp", color: "160 45% 22%", posicion: "50% 50%" },
];

export default function PanelGimnasioPage() {
  return (
    <PanelModulo
      kicker="Asistencia"
      titulo="Asistencia"
      subtitulo="Recepción con la asistencia del día, clases con horario y cupo, y la comisión de los profesores."
      tarjetas={TARJETAS}
      vacio="No tenés pantallas de Asistencia habilitadas."
    />
  );
}