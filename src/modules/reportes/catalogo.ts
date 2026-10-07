import { Lock, type LucideIcon } from "lucide-react";

/**
 * Catálogo de reportes: alimenta la pantalla /reportes (tarjetas) y el menú lateral.
 * Para sumar un reporte: agregar una entrada acá y su página en src/app/(app)/reportes/<x>.
 */
export type Reporte = {
  href: string;
  /** nombre corto para el menú */
  menu: string;
  titulo: string;
  subtitulo: string;
  descripcion: string;
  icono: LucideIcon;
};

export const REPORTES: Reporte[] = [
  {
    href: "/reportes/cajas",
    menu: "Cierres de caja",
    titulo: "Cierres de caja",
    subtitulo: "Arqueo de turnos",
    descripcion: "Turnos de caja por rango de fechas: apertura, cierre, efectivo esperado vs. contado y diferencias. Arqueo de cada turno en PDF.",
    icono: Lock,
  },
];
