import type { Modulo } from "@/modules/types";

/** Manifiesto del módulo Inventario (productos y control de stock). */
export const moduloInventario: Modulo = {
  id: "inventario",
  label: "Inventario",
  href: "/inventario",
  icon: "package",
  familia: "Operaciones",
  roles: ["ADMIN", "CAJERO", "VENDEDOR"],
  children: [
    { label: "Productos", href: "/inventario" },
    { label: "Categorías", href: "/inventario/categorias" },
    { label: "Movimientos", href: "/inventario/movimientos" },
  ],
};
