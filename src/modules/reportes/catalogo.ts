import { Boxes, HandCoins, Lock, PackageMinus, ShoppingCart, type LucideIcon } from "lucide-react";

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
    href: "/reportes/deudores",
    titulo: "Deudores",
    subtitulo: "Quién te debe y cuánto",
    descripcion: "Clientes con deuda, lo vencido primero: cuánto debe cada uno, días de atraso, tramos de 30/60/90 días y último pago. Excel y PDF para salir a cobrar.",
    icono: HandCoins,
  },
  {
    href: "/reportes/cajas",
    titulo: "Cierres de caja",
    subtitulo: "Arqueo de turnos",
    descripcion: "Turnos de caja por rango de fechas: apertura, cierre, efectivo esperado vs. contado y diferencias. Arqueo de cada turno en PDF.",
    icono: Lock,
  },
  {
    href: "/reportes/stock-minimo",
    titulo: "Stock mínimo",
    subtitulo: "Productos por reponer",
    descripcion: "Productos cuyo stock quedó por debajo del mínimo definido, con lo vendido en 30 días y el costo de reponer. Lista de reposición en PDF y Excel.",
    icono: PackageMinus,
  },
  {
    href: "/reportes/productos-vendidos",
    titulo: "Productos vendidos",
    subtitulo: "Cuánto se vendió de cada uno",
    descripcion: "Unidades, total, precio promedio, ganancia y margen por producto (resumido) o cada venta con cliente y cajero (detallado). Muestra también lo que no se vendió.",
    icono: Boxes,
  },
];
