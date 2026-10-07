/**
 * Resolución de íconos por nombre (lucide-react). Cada módulo declara `icon: "wallet"`
 * y acá se traduce al componente. Centralizado para que el sidebar y el dashboard usen
 * el mismo set y agregar un módulo no toque más que su propio manifiesto.
 */
import { LayoutGrid, Users, Wallet, Package, FileText, type LucideIcon } from "lucide-react";

const ICONOS: Record<string, LucideIcon> = {
  wallet: Wallet,
  users: Users,
  package: Package,
  "file-text": FileText,
};

export function iconoModulo(nombre?: string): LucideIcon {
  return (nombre && ICONOS[nombre]) || LayoutGrid;
}
