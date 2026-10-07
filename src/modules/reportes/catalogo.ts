import { Lock, ShoppingCart, type LucideIcon } from "lucide-react";

/**
 * Catálogo de reportes: alimenta la pantalla /reportes (una tarjeta por reporte).
 * Para sumar un reporte: agregar una entrada acá y su página en src/app/(app)/reportes/<x>.
 */
export type Reporte = {
  href: string;
  titulo: string;
  subtitulo: string;
  descripcion: string;
  icono: LucideIcon;
};

export const REPORTES: Reporte[] = [
  {
    href: "/reportes/ventas",
    titulo: "Ventas del período",
    subtitulo: "Ventas, ganancia e IVA",
    descripcion: "Cuánto se vendió y se ganó, ticket promedio, IVA a declarar, cobros por medio de pago, ventas por cajero, productos y categorías más vendidos. Excel y PDF.",
    icono: ShoppingCart,
  },
  {
    href: "/reportes/cajas",
    titulo: "Cierres de caja",
    subtitulo: "Arqueo de turnos",
    descripcion: "Turnos de caja por rango de fechas: apertura, cierre, efectivo esperado vs. contado y diferencias. Arqueo de cada turno en PDF.",
    icono: Lock,
  },
];
