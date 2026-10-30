"use client";

/**
 * /comercial — Panel Comercial (el ítem "Comercial" del menú abre acá): una tarjeta con foto por
 * módulo de la familia (PanelModulo → TarjetaImagen). Ninguno tiene sub-pantallas en el menú
 * (las vistas de CRM / Proyectos son pestañas internas), así que todas las tarjetas van directo a
 * su pantalla; las rutas no cambian. Se muestran solo las que el perfil puede abrir. Fotos y
 * créditos: public/comercial/ y docs/creditos-imagenes-demo.md (sección "Panel Comercial").
 */
import { PanelModulo, hslDeMarca, type TarjetaPanel } from "@/components/ui/PanelModulo";
import { clienteConfig } from "@/cliente.config";

const TARJETAS: TarjetaPanel[] = [
  { href: "/clientes", titulo: "Clientes", imagen: "/comercial/clientes-fichero-contactos.webp", color: hslDeMarca(clienteConfig.color), posicion: "60% 25%" },
  { href: "/crm", titulo: "CRM Funnel", imagen: "/comercial/crm-pizarra-notas-reunion.webp", color: "214 40% 24%", posicion: "40% 30%" },
  { href: "/presupuestos", titulo: "Presupuestos", imagen: "/comercial/presupuestos-calculadora-notas.webp", color: "26 50% 24%", posicion: "35% 72%" },
  { href: "/clientes/gestion", titulo: "Gestión Clientes", imagen: "/comercial/gestion-lista-llamadas-libreta.webp", color: "152 34% 22%", posicion: "70% 40%" },
  { href: "/clientes/suscripciones", titulo: "Planes", imagen: "/comercial/planes-calendario-mensual.webp", color: "258 28% 30%", posicion: "50% 70%" },
  { href: "/clientes/agenda", titulo: "Agenda", imagen: "/comercial/agenda-planificador-escribiendo.webp", color: "196 45% 20%", posicion: "50% 40%" },
  { href: "/proyectos", titulo: "Proyectos", imagen: "/comercial/proyectos-tablero-kanban.webp", color: "352 38% 27%", posicion: "50% 20%" },
];

export default function PanelComercialPage() {
  return (
    <PanelModulo
      kicker="Comercial"
      titulo="Comercial"
      subtitulo="Clientes y prospectos, cotizaciones, planes mensuales y la agenda."
      tarjetas={TARJETAS}
      vacio="No tenés pantallas de Comercial habilitadas."
    />
  );
}
