"use client";

/**
 * /finanzas — Panel Finanzas (el ítem "Finanzas" del menú abre acá): una tarjeta con foto por
 * módulo de la familia (PanelModulo → TarjetaImagen). Caja, Gastos empresariales y Reportes ya no
 * están acá (son ítems propios del menú). Cobranzas, Conciliación y Pagos van
 * directo a su pantalla. Las rutas de las pantallas no cambian. Se muestran solo los módulos de
 * los que el perfil ve alguna pantalla (`pantallas`). Fotos y créditos: public/finanzas/ y
 * docs/creditos-imagenes-demo.md (sección "Panel Finanzas").
 */
import { PanelModulo, type TarjetaPanel } from "@/components/ui/PanelModulo";

const TARJETAS: TarjetaPanel[] = [
  { href: "/cobranzas", titulo: "Cobranzas", imagen: "/finanzas/cobranzas-agenda-vencimientos.webp", color: "152 34% 22%", posicion: "50% 50%" },
  { href: "/cobranzas/conciliacion", titulo: "Conciliación", imagen: "/finanzas/conciliacion-planilla-laptop.webp", color: "214 40% 24%", posicion: "55% 35%" },
  { href: "/pagos", titulo: "Pagos", imagen: "/finanzas/pagos-tarjeta-terminal.webp", color: "258 28% 30%", posicion: "50% 55%" },
];

export default function PanelFinanzasPage() {
  return (
    <PanelModulo
      kicker="Finanzas"
      titulo="Finanzas"
      subtitulo="Lo que entra de plata y cómo se cobra: cobranzas, conciliación y pagos."
      tarjetas={TARJETAS}
      vacio="No tenés pantallas de Finanzas habilitadas."
    />
  );
}
