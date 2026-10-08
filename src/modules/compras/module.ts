import type { Modulo } from "@/modules/types";

/** Compras: facturas de compra a proveedores y el maestro de proveedores. */
export const moduloCompras: Modulo = {
  id: "compras",
  label: "Compras",
  href: "/compras",
  icon: "cart",
  familia: "Operaciones",
  roles: ["ADMIN"],
  children: [
    { label: "Compras", href: "/compras" },
    { label: "Nueva compra", href: "/compras/nueva" },
    { label: "Proveedores", href: "/proveedores" },
  ],
};
