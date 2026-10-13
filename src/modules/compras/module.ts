import type { Modulo } from "@/modules/types";

/**
 * Compras: facturas de compra a proveedores, órdenes de compra, el maestro de proveedores
 * y los pagos a proveedores (cuentas a pagar de compras y gastos a crédito).
 */
export const moduloCompras: Modulo = {
  id: "compras",
  label: "Compras",
  href: "/compras",
  icon: "cart",
  familia: "Finanzas",
  roles: ["ADMIN"],
  children: [
    { label: "Compras", href: "/compras" },
    { label: "Órdenes de compra", href: "/compras/ordenes" },
    { label: "Proveedores", href: "/proveedores" },
    { label: "Pagos a proveedores", href: "/compras/pagos" },
  ],
};
