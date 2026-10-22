"use client";

/**
 * /finanzas — Panel Finanzas (el ítem "Finanzas" del menú abre acá): una tarjeta con foto por
 * módulo de la familia (PanelModulo → TarjetaImagen). Caja y Gastos empresariales abren su propio
 * panel (/caja/panel, /gastos-empresariales/panel); Cobranzas, Conciliación, Pagos y Reportes van
 * directo a su pantalla. Las rutas de las pantallas no cambian. Se muestran solo los módulos de
 * los que el perfil ve alguna pantalla (`pantallas`). Fotos y créditos: public/finanzas/ y
 * docs/creditos-imagenes-demo.md (sección "Panel Finanzas").
 */
import { PanelModulo, hslDeMarca, type TarjetaPanel } from "@/components/ui/PanelModulo";
import { clienteConfig } from "@/cliente.config";
import { hrefsDeModulo } from "@/modules/registry";

const TARJETAS: TarjetaPanel[] = [
  { href: "/caja/panel", pantallas: hrefsDeModulo("caja"), titulo: "Caja", imagen: "/finanzas/caja-teclas-registradora.webp", color: hslDeMarca(clienteConfig.color), posicion: "50% 40%" },
  { href: "/cobranzas", titulo: "Cobranzas", imagen: "/finanzas/cobranzas-agenda-vencimientos.webp", color: "152 34% 22%", posicion: "50% 50%" },
  { href: "/cobranzas/conciliacion", titulo: "Conciliación", imagen: "/finanzas/conciliacion-planilla-laptop.webp", color: "214 40% 24%", posicion: "55% 35%" },
  { href: "/pagos", titulo: "Pagos", imagen: "/finanzas/pagos-tarjeta-terminal.webp", color: "258 28% 30%", posicion: "50% 55%" },
  {
    href: "/gastos-empresariales/panel", pantallas: hrefsDeModulo("gastos-empresariales"), titulo: "Gastos empresariales",
    imagen: "/finanzas/gastos-calculadora-teclas.webp", color: "26 50% 24%", posicion: "50% 50%",
  },
  { href: "/reportes", titulo: "Reportes", imagen: "/finanzas/reportes-graficos-pantalla.webp", color: "196 45% 20%", posicion: "40% 30%" },
];

export default function PanelFinanzasPage() {
  return (
    <PanelModulo
      kicker="Finanzas"
      titulo="Finanzas"
      subtitulo="Ventas y caja, lo que entra y lo que sale de plata, y los números de la empresa."
      tarjetas={TARJETAS}
      vacio="No tenés pantallas de Finanzas habilitadas."
    />
  );
}
